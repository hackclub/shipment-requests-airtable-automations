import { parseString } from 'fast-csv'

import { base64Encode, convertKeysToLowerCamelCase, laborCost } from "./util"

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
    OR(
      OR(
        AND(
          {Warehouse–EasyPost Tracker ID},
          {Warehouse–Delivered At} = BLANK()
        ),
        {Warehouse–Service} = BLANK()
      ),
      {Warehouse–Items Ordered JSON} = BLANK()
    ),
    {Warehouse–Labor Cost} = BLANK()
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

async function getZenventoryOrder(apiKey, apiSecret, orderNumber) {
  let resp = await fetch(`https://app.zenventory.com/rest/customer-orders/${orderNumber}`, {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  return await resp.json()
}

async function getZenventoryOrders(apiKey, apiSecret, reportName, startDate = '2024-01-01', endDate = '2024-12-31') {
  let urlParams = new URLSearchParams({
    csv: true,
    startDate,
    endDate
  })

  let resp = await fetch('https://app.zenventory.com/rest/reports/fulfillment/ful_order_detail?' + urlParams.toString(), {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  let csv = await resp.text()

  return new Promise((resolve, reject) => {
    let orders = {}

    parseString(csv, { headers: true })
      .on('data', row => {
        row = convertKeysToLowerCamelCase(row)

        console.log(row)

        orders[row.co] ||= []

        orders[row.co].push({
          sku: row.sku,
          name: row.description,
          quantity: row.orderedQty
        })
      })
      .on('error', error => reject(error))
      .on('end', rowCount => resolve(orders))
  })
}

async function getZenventoryShipments(apiKey, apiSecret, reportName, startDate = '2024-01-01', endDate = '2024-12-31') {
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
console.log("Exporting orders from Zenventory...")
let orders = await getZenventoryOrders(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)
console.log("Exporting shipments from Zenventory...")
let shipments = await getZenventoryShipments(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

for (let shipment of shipmentRequests) {
  let updates = {}

  console.log("Processing shipment for", shipment.fields['First Name'])

  // then do the full processing for shipments that need info imported from zenventory
  let matchingShipment = shipments.find(s => s.orderNumber == shipment.id)
  let matchingOrder = orders[shipment.id]
  if (!matchingShipment || !matchingOrder) {
    console.log("  No matching Zenventory shipment & order found...")
    continue
  }

  // if the package has shipped, check and update the delivery status
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

  if (!shipment.fields['Warehouse–Service']) updates['Warehouse–Service'] = `${matchingShipment.carrier}${matchingShipment.service ? ` (${matchingShipment.service})` : ''}`
  if (!shipment.fields['Warehouse–Postage Cost']) updates['Warehouse–Postage Cost'] = Number(matchingShipment.shippingHandling)
  if (!shipment.fields['Warehouse–Labor Cost']) updates['Warehouse–Labor Cost'] = laborCost(matchingOrder)
  if (!shipment.fields['Warehouse–Items Ordered JSON']) updates['Warehouse–Items Ordered JSON'] = JSON.stringify(matchingOrder, null, 2)

  if (!shipment.fields['Warehouse–EasyPost Tracker ID'] && !!matchingShipment.trackingNumber) {
    updates['Warehouse–Tracking Number'] = matchingShipment.trackingNumber

    try {
      console.log("  Making tracker")
      let tracker = await easypost.Tracker.create({
        tracking_code: matchingShipment.trackingNumber
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
