import { laborCost } from "./util"

import Airtable from 'airtable'
import { getZenventoryOrders, getZenventoryShipments } from './zenventory'

let airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)

async function getAirtableShipmentRequests(airtableBase) {
  return new Promise((resolve, reject) => {
    let shipments = []

    airtableBase('Shipment Requests').select({
      // we are setting Warehouse–Service when we detect a shipment, so if it's
      // blank then we know that the item hasn't shipped yet
      filterByFormula: `
AND(
  OR(
    OR(
      {Warehouse–Service} = BLANK(),
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

  if (!shipment.fields['Warehouse–Service']) updates['Warehouse–Service'] = `${matchingShipment.carrier}${matchingShipment.service ? ` (${matchingShipment.service})` : ''}`
  if (!shipment.fields['Warehouse–Postage Cost']) updates['Warehouse–Postage Cost'] = Number(matchingShipment.shippingHandling)
  if (!shipment.fields['Warehouse–Labor Cost']) updates['Warehouse–Labor Cost'] = laborCost(matchingOrder)
  if (!shipment.fields['Warehouse–Items Ordered JSON']) updates['Warehouse–Items Ordered JSON'] = JSON.stringify(matchingOrder, null, 2)

  if (!shipment.fields['Warehouse–Tracking URL'] && !!matchingShipment.trackingNumber) {
    if (!shipment.fields['Warehouse–Tracking Number']) updates['Warehouse–Tracking Number'] = matchingShipment.trackingNumber

    updates['Warehouse–Tracking URL'] = 'https://parcelsapp.com/en/tracking/' + matchingShipment.trackingNumber
  }

  if (Object.keys(updates).length > 0) {
    console.log("  Pushing updates...", updates)
    await shipment.updateFields(updates)
  } else {
    console.log("  No updates needed")
  }
}
