import { parseString } from 'fast-csv'

import { base64Encode, convertKeysToLowerCamelCase } from "./util"

import trackingInfo from 'tracking-url'
import Airtable from 'airtable'
import EasyPost from '@easypost/api'

let airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)
let easypost = new EasyPost(process.env.EASYPOST_API_KEY)

async function getAirtableShipmentRequests(airtableBase) {
  return new Promise((resolve, reject) => {
    let shipments = []

    airtableBase('Shipment Requests').select({
      // we are setting Warehouse–Service when we detect a shipment, so if it's
      // blank then we know that the item hasn't shipped yet
      //
      // if easypost tracker id is set, but delivered at is not, then the item
      // is en route and we need to check delivery status
      filterByFormula: `
AND(
  OR(
    AND(
      {Warehouse–EasyPost Tracker ID},
      {Warehouse–Delivered At} = BLANK()
    ),
    {Warehouse–Service} = BLANK()
  ),
  {Send To Warehouse}
)`
    }).eachPage((records, fetchNextPage) => {
      records.forEach(record => shipments.push(record))
      fetchNextPage()
    }, err => {
      if (err) reject(err)

      resolve(shipments)
    })
  })
}

async function getZenventoryOrders(apiKey, apiSecret, startDate = '2024-01-01', endDate = '2024-12-31') {
  let urlParams = new URLSearchParams({
    csv: true,
    startDate,
    endDate
  })

  let resp = await fetch('https://app.zenventory.com/rest/reports/shipment/ship_client?' + urlParams.toString(), {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  let csv = await resp.text()

  let rows = await new Promise((resolve, reject) => {
    let rows = []

    parseString(csv, { headers: true })
      .on('data', row => {
        row = convertKeysToLowerCamelCase(row)

        if (row.trackingNumber) {
          let t = trackingInfo(row.trackingNumber)

          if (t) { // it will be falsy if bad tracking number
            row.trackingUrl = t.url
          }
        }

        rows.push(row)
      })
      .on('error', error => reject(error))
      .on('end', rowCount => resolve(rows))
  })

  return rows
}

console.log("Getting shipment requests...")
let shipmentRequests = await getAirtableShipmentRequests(airtable)
console.log("Exporting shipments from Zenventory...")
let orders = await getZenventoryOrders(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

for (let shipment of shipmentRequests) {
  let updates = {}

  console.log("Processing shipment for", shipment.fields['First Name'])

  // first check if we already have the info on file, and just need to check for easypost delivery
  if (shipment.fields['Warehouse–Service']) {
    let trackerId = shipment.fields['Warehouse–EasyPost Tracker ID']

    if (trackerId && !shipment.fields['Warehouse–Delivered At']) {
      console.log("  EasyPost info on file, but not marked as delivered. Checking status...")
      const tracker = await easypost.Tracker.retrieve(trackerId)

      console.log(`    Tracker status: ${tracker.status}`)

      if (tracker.status == 'delivered') {
        console.log(`      Marking as delivered in Airtable`)
        let deliveryTime = new Date(tracker.tracking_details[tracker.tracking_details.length - 1].datetime)

        updates['Warehouse–Delivered At'] = deliveryTime
      }

    }
  }

  // then do the full processing for shipments that need info imported from zenventory
  let matchingOrder = orders.find(o => o.orderNumber == shipment.id)
  if (!matchingOrder) {
    console.log("  No matching Zenventory shipment found...")
    continue
  }

  if (!shipment.fields['Warehouse–Service']) updates['Warehouse–Service'] = `${matchingOrder.carrier}${matchingOrder.service ? ` (${matchingOrder.service})` : ''}`
  if (!shipment.fields['Warehouse–Postage Cost']) updates['Warehouse–Postage Cost'] = Number(matchingOrder.shippingHandling)

  if (!shipment.fields['Warehouse–EasyPost Tracker ID'] && !!matchingOrder.trackingNumber) {
    updates['Warehouse–Tracking Number'] = matchingOrder.trackingNumber

    try {
      console.log("  Making tracker")
      let tracker = await easypost.Tracker.create({
        tracking_code: matchingOrder.trackingNumber
      })

      console.log(`Created EasyPost tracker`)

      updates['Warehouse–EasyPost Tracker ID'] = tracker.id
      updates['Warehouse–Tracking URL'] = tracker.public_url
    } catch {
      // api error
      console.log("  Error making tracker")
    }
  }

  if (Object.keys(updates).length > 0) {
    console.log("  Pushing updates...", updates)
    await shipment.updateFields(updates)
  } else {
    console.log("  No updates needed")
  }
}
