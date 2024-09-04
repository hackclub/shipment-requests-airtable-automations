import Airtable from 'airtable'

import { base64Encode, nullify } from './util'

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

console.log("Loading Airtable inventory...")
let airtableInventory = await getAirtableInventory(airtable)

for (let record of airtableInventory) {
  let zenRecord = zenventoryInventory.find(z => z.item.sku == record.fields['SKU'])
  let unitCost = unitCosts[zenRecord.item.sku] ? unitCosts[zenRecord.item.sku].unitCost : null

  await record.updateFields({
    'In Stock': nullify(zenRecord.sellable),
    'Inbound': nullify(zenRecord.inbound),
    'Unit Cost': nullify(unitCost)
  })

  console.log(`Updated ${record.fields['SKU']}`)
}
