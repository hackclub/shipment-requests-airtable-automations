import { daysAgo } from "./util"

let EasyPostClient = require("@easypost/api")

require('dotenv').config()

// const client = new EasyPostClient(process.env.EASYPOST_API_KEY)

// const tracker = await client.Tgkg7l, fjuuuggvs; dudsesracker.create({
//   tracking_code: '',
// });

let urlParams = {
  csv: true,
  startDate: daysAgo(7),
  endDate: new Date(),
}

let resp = await fetch('https://app.zenventory.com/rest/reports/shipment/ship_detail?' + new URLSearchParams(urlParams).toString(), {



  console.log(tracker)