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

async function getZenventoryInventory(apiKey, apiSecret, currentPage = 1, inventory = []) {
  const pageSize = 100

  let urlParams = new URLSearchParams({
    perPage: pageSize,
    page: currentPage
  })

  let resp = await fetch('https://app.zenventory.com/rest/inventory?' + urlParams.toString(), {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  let page = await resp.json()

  if (page.meta.totalPages != currentPage) {
    return getZenventoryInventory(apiKey, apiSecret, currentPage + 1, inventory.concat(page.inventory))
  }

  return inventory.concat(page.inventory)
}

console.log("Loading Zenventory inventory...")
let zenventoryInventory = await getZenventoryInventory(process.env.ZENVENTORY_API_KEY, process.env.ZENVENTORY_API_SECRET)

console.log("Loading Airtable inventory...")
let airtableInventory = await getAirtableInventory(airtable)

for (let record of airtableInventory) {
  let zenRecord = zenventoryInventory.find(z => z.item.sku == record.fields['SKU'])

  await record.updateFields({
    'In Stock': nullify(zenRecord.sellable),
    'Inbound': nullify(zenRecord.inbound),
  })

  console.log(`Updated ${record.fields['SKU']}`)
}