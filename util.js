// base64 encode
export function base64Encode(str) {
  return Buffer.from(str).toString('base64');
}

// return the date n days ago
export function daysAgo(n) {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return date
}