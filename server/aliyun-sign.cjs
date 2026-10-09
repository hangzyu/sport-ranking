const crypto = require('node:crypto');

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%7E/gi, '~');
}

function canonicalQuery(params) {
  return Object.keys(params).sort().map(key => percentEncode(key) + '=' + percentEncode(params[key])).join('&');
}

function stringToSign(method, params) {
  return method.toUpperCase() + '&' + percentEncode('/') + '&' + percentEncode(canonicalQuery(params));
}

function signature(method, params, accessKeySecret) {
  return crypto.createHmac('sha1', accessKeySecret + '&').update(stringToSign(method, params)).digest('base64');
}

module.exports = {percentEncode, canonicalQuery, stringToSign, signature};
