import { parseString } from 'fast-csv'
import trackingInfo from 'tracking-url'
import { base64Encode, convertKeysToLowerCamelCase } from './util'

export async function getZenventoryShipments(apiKey, apiSecret, reportName, startDate = '2024-01-01', endDate = '2024-12-31') {
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

export async function getZenventoryOrder(apiKey, apiSecret, orderNumber) {
  let resp = await fetch(`https://app.zenventory.com/rest/customer-orders/${orderNumber}`, {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  return await resp.json()
}

export async function getZenventoryOrders(apiKey, apiSecret, reportName, startDate = '2024-01-01', endDate = '2024-12-31') {
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

export async function getZenventoryInventory(apiKey, apiSecret, currentPage = 1, inventory = []) {
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

export async function getZenventoryPurchaseOrders(apiKey, apiSecret, currentPage = 1, purchaseOrders = []) {
  const pageSize = 100

  let urlParams = new URLSearchParams({
    perPage: pageSize,
    page: currentPage
  })

  let resp = await fetch('https://app.zenventory.com/rest/purchase-orders?' + urlParams.toString(), {
    headers: {
      'Authorization': `Basic ${base64Encode(apiKey + ':' + apiSecret)}`
    }
  })

  let page = await resp.json()

  if (page.meta.totalPages != currentPage) {
    return getZenventoryPurchaseOrders(apiKey, apiSecret, currentPage + 1, purchaseOrders.concat(page.purchaseOrders))
  }

  return purchaseOrders.concat(page.purchaseOrders)
}