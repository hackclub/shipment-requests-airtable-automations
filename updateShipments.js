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
      filterByFormula: 'AND(OR(AND({Warehouse–EasyPost Tracker ID}, {Warehouse–Delivered At} = BLANK()), {Warehouse–Service} = BLANK()), {Send To Warehouse})'
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

let shipmentRequests = await getAirtableShipmentRequests(airtable)
let orders = await getZenventoryOrders(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

console.log(orders[99])

for (let shipment of shipmentRequests) {
  let matchingOrder = orders.find(o => o.orderNumber == shipment.id)
  if (!matchingOrder) continue

  let updates = {}

  updates['Warehouse–Service'] = `${matchingOrder.carrier}${matchingOrder.service ? ` (${matchingOrder.service})` : ''}`
  updates['Warehouse–Postage Cost'] = Number(matchingOrder.shippingHandling)

  if (!shipment.fields['Warehouse–EasyPost Tracker ID'] && !!matchingOrder.trackingNumber) {
    updates['Warehouse–Tracking Number'] = matchingOrder.trackingNumber

    try {
      let tracker = await easypost.Tracker.create({
        tracking_code: matchingOrder.trackingNumber
      })

      console.log(`Created EasyPost tracker`)

      updates['Warehouse–EasyPost Tracker ID'] = tracker.id
      updates['Warehouse–Tracking URL'] = tracker.public_url
    } catch { // api error
      continue
    }
  }

  await shipment.updateFields(updates)
}
