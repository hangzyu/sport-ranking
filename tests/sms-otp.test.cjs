const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createStore, normalizePhone, isMobile, maskPhone} = require('../src/sms-otp.js');

assert.equal(normalizePhone(' 138 0013 8000 '), '13800138000');
assert.equal(normalizePhone('+86 138-0013-8000'), '13800138000');
assert.equal(isMobile('13800138000'), true);
assert.equal(isMobile('12800138000'), false);
assert.equal(isMobile('1380013800'), false);
assert.equal(maskPhone('13800138000'), '138****8000');

(async () => {
  let now = 1_700_000_000_000;
  const store = createStore({now: () => now, randomCode: () => '654321'});
  const phone = '13800138000';

  assert.equal((await store.request('12345')).error, 'invalid_phone');
  const issued = await store.request(phone);
  assert.equal(issued.ok, true);
  assert.equal(issued.code, '654321');
  assert.equal((await store.request(phone)).error, 'cooldown');

  assert.equal((await store.check(phone, '000000')).error, 'mismatch');
  assert.match((await store.check(phone, '12')).message, /6 位/);
  assert.equal((await store.check(phone, '654321')).ok, true);
  assert.equal((await store.check(phone, '654321')).error, 'missing');

  now += 60 * 1000;
  await store.request(phone);
  now += 5 * 60 * 1000;
  assert.equal((await store.check(phone, '654321')).error, 'expired');

  now += 60 * 1000;
  await store.request(phone);
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await store.check(phone, '111111')).error, 'mismatch');
  assert.equal((await store.check(phone, '111111')).error, 'locked');
  assert.equal((await store.check(phone, '654321')).error, 'missing');

  now += 60 * 1000;
  await store.request(phone);
  store.release(phone);
  const again = await store.request(phone);
  assert.equal(again.ok, true);
  assert.equal((await store.check(phone, '654321')).ok, true);

  const capped = createStore({now: () => now, randomCode: () => '654321'});
  for (let send = 0; send < 8; send += 1) {
    assert.equal((await capped.request('13700137000')).ok, true);
    now += 61 * 1000;
  }
  assert.equal((await capped.request('13700137000')).error, 'daily_limit');
  now += 24 * 60 * 60 * 1000;
  assert.equal((await capped.request('13700137000')).ok, true);

  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(html.includes('演示环境不发送真实短信'), false);
  assert.equal(html.includes('PhoneLogin.mount'), true);
  assert.equal(fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8').includes('./src/phone-login.js'), true);
  console.log('Passed phone normalization, code expiry, attempt lock, resend limits and login wiring.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
