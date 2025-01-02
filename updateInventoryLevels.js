import Airtable from 'airtable'

import { base64Encode, laborCost, median, nullify } from './util'
import { getZenventoryInventory, getZenventoryOrders, getZenventoryPurchaseOrders, getZenventoryShipments } from './zenventory'

require('dotenv').config()

let airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID)

async function getAirtableInventory(airtableBase) {
  return new Promise((resolve, reject) => {
    let inventory = []

    airtableBase('Warehouse SKUs').select().eachPage((records, fetchNextPage) => {
      records.forEach(record => inventory.push(record))
      fetchNextPage()
    }, err => {
      if (err) reject(err)

      resolve(inventory)
    })
  })
}


function calculateUnitCosts(zenventoryPurchaseorders) {
  let items = zenventoryPurchaseOrders.map(po => po.items).flat()

  let unitCosts = {}

  items.forEach(i => {
    unitCosts[i.sku] ||= {
      description: i.description,
      totalOrdered: 0,
      totalCost: 0,
      unitCost: 0,
    }

    unitCosts[i.sku].totalOrdered += i.quantity
    unitCosts[i.sku].totalCost += i.quantity * i.unitCost
    unitCosts[i.sku].unitCost = unitCosts[i.sku].totalCost / unitCosts[i.sku].totalOrdered
  })

  return unitCosts
}

console.log("Loading Zenventory inventory...")
let zenventoryInventory = await getZenventoryInventory(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

console.log("Loading Zenventory purchase orders for unit cost calculations...")
let zenventoryPurchaseOrders = await getZenventoryPurchaseOrders(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)
let unitCosts = calculateUnitCosts(zenventoryPurchaseOrders)

console.log("Loading Zenventory shipments & orders for median postage cost calculations...")
let zenventoryShipments = await getZenventoryShipments(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)
let zenventoryOrders = await getZenventoryOrders(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

let enrichedShipments = zenventoryShipments.map(s => {
  s['orderItems'] = zenventoryOrders[s.orderNumber]

  if (!s['orderItems']) {
    return null
  }

  return s
}).filter(s => s)

console.log("Loading Airtable inventory...")
let airtableInventory = await getAirtableInventory(airtable)

for (let record of airtableInventory) {
    try {
        let zenRecord = zenventoryInventory.find(z => z.item.sku == record.fields['SKU'])
        let unitCost = unitCosts[zenRecord.item.sku] ? unitCosts[zenRecord.item.sku].unitCost : null

        let shipments = enrichedShipments.filter(s => s.orderItems.find(i => i.sku == record.fields['SKU']))

        let usaShipments = shipments.filter(s => s.country == 'US')
        let nonUsaShipments = shipments.filter(s => s.country != 'US')

        let medianUsaCost = median(usaShipments.map(s => parseFloat(s.shippingHandling) + laborCost(s.orderItems)))
        let medianNonUsaCost = median(nonUsaShipments.map(s => parseFloat(s.shippingHandling) + laborCost(s.orderItems)))

        await record.updateFields({
            'In Stock': nullify(zenRecord.sellable),
            'Inbound': nullify(zenRecord.inbound),
            'Unit Cost': record.fields['Unit Cost Override'] || nullify(unitCost),
            'Median USA Postage + Labor': nullify(medianUsaCost),
            'Median Global Postage + Labor': nullify(medianNonUsaCost),
            'USA Shipments': nullify(usaShipments.length),
            'Global Shipments': nullify(nonUsaShipments.length)
        })
    } catch (e) {
        console.error(`${e} while updating ${record.id}!`)
        continue
    }
    console.log(`Updated ${record.fields['SKU']}`)
}
