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

export function nullify(value) {
  return !value ? null : value
}

export function convertKeysToLowerCamelCase(obj) {
  return Object.keys(obj).reduce((acc, key) => {
    const lowerCamelCaseKey = key
      .replace(/[^A-Za-z]+/g, ' ')
      .split(/\s+|_+|-+/)
      .map((word, index) => index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    acc[lowerCamelCaseKey] = obj[key];
    return acc;
  }, {});
}

// $1.80 base * $0.20 per SKU
export function laborCost(zenventoryOrder) {
  return 1.80 + (zenventoryOrder.length * 0.20)
}