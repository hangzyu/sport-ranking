const crypto = require('node:crypto');
const {promisify} = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 32;

function passwordError(password) {
  const value = String(password ?? '');
  if (value.length < 8) return '密码至少 8 位。';
  if (value.length > 64) return '密码不能超过 64 位。';
  return '';
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = Buffer.from(await scrypt(String(password), salt, KEY_LENGTH));
  return 'scrypt$' + salt.toString('base64url') + '$' + key.toString('base64url');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = Buffer.from(await scrypt(String(password ?? ''), salt, KEY_LENGTH));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {passwordError, hashPassword, verifyPassword};
