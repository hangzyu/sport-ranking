const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createStore} = require('../src/sms-otp.js');
const {createAuth, createServer, smsbaoPassword, messageText, signSession, readSession} = require('../server/sms-auth.cjs');
const {stringToSign, signature} = require('../server/aliyun-sign.cjs');

const documented = 'GET&%2F&AccessKeyId%3Dtestid%26Action%3DDescribeRegions%26Format%3DXML%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3D3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf%26SignatureVersion%3D1.0%26Timestamp%3D2016-02-23T12%253A46%253A24Z%26Version%3D2014-05-26';
const params = {
  Format: 'XML',
  AccessKeyId: 'testid',
  Action: 'DescribeRegions',
  SignatureMethod: 'HMAC-SHA1',
  SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
  SignatureVersion: '1.0',
  Version: '2014-05-26',
  Timestamp: '2016-02-23T12:46:24Z'
};
assert.equal(stringToSign('GET', params), documented);
assert.equal(signature('GET', params, 'testsecret'), crypto.createHmac('sha1', 'testsecret&').update(documented).digest('base64'));
assert.equal(smsbaoPassword('password'), crypto.createHash('md5').update('password').digest('hex'));
assert.equal(smsbaoPassword('ABCDEF0123456789ABCDEF0123456789'), 'abcdef0123456789abcdef0123456789');
assert.equal(messageText('Ranking', '123456'), '【Ranking】您的验证码是123456，5分钟内有效，请勿泄露。');

(async () => {
  let now = 1_700_000_000_000;
  const sent = [];
  const auth = createAuth({
    store: createStore({now: () => now, randomCode: () => '654321'}),
    deliver: async (phone, code) => sent.push({phone, code}),
    secret: 'test-secret',
    now: () => now
  });
  const missing = createAuth({store: createStore({now: () => now}), deliver: null, now: () => now});
  assert.equal((await missing.send({phone: '13800138000', ip: 'a'})).body.error, 'unconfigured');

  const send = await auth.send({phone: '138 0013 8000', ip: 'a'});
  assert.equal(send.status, 200);
  assert.equal(JSON.stringify(send.body).includes('654321'), false);
  assert.deepEqual(sent, [{phone: '13800138000', code: '654321'}]);
  assert.equal((await auth.send({phone: '13800138000', ip: 'a'})).body.error, 'cooldown');

  const wrong = await auth.verify({phone: '13800138000', code: '000000', ip: 'b'});
  assert.equal(wrong.body.error, 'mismatch');
  const right = await auth.verify({phone: '13800138000', code: '654321', ip: 'b'});
  assert.equal(right.body.user.phone, '13800138000');
  assert.equal(typeof right.body.token, 'string');
  assert.equal((await auth.verify({phone: '13800138000', code: '654321', ip: 'b'})).body.error, 'missing');

  let failSend = true;
  const failing = createAuth({
    store: createStore({now: () => now, randomCode: () => '111111'}),
    deliver: async () => { if (failSend) throw new Error('短信余额不足。'); },
    now: () => now
  });
  now += 61 * 1000;
  const failed = await failing.send({phone: '13900139000', ip: 'c'});
  assert.equal(failed.status, 502);
  assert.equal(failed.body.message, '短信余额不足。');
  failSend = false;
  assert.equal((await failing.send({phone: '13900139000', ip: 'c'})).status, 200);

  const remote = createAuth({
    store: createStore({now: () => now}),
    sendSms: async () => ({status: 200, body: {ok: true, message: '验证码已发送，5 分钟内有效。', retryAfter: 60}}),
    checkSms: async (phone, code) => code === '246810' ? {ok: true, phone} : {ok: false, error: 'mismatch', message: '验证码不正确或已过期。'},
    settleUser: async phone => ({id: 'user-1', phone, created_at: '2026-10-08T00:00:00.000Z', last_login_at: '2026-10-08T09:00:00.000Z'}),
    secret: 'test-secret',
    now: () => now
  });
  assert.equal((await remote.send({phone: '13600136000', ip: 'e'})).status, 200);
  assert.equal((await remote.verify({phone: '13600136000', code: '000000', ip: 'e'})).body.error, 'mismatch');
  const loggedIn = await remote.verify({phone: '13600136000', code: '246810', ip: 'e'});
  assert.equal(loggedIn.body.user.id, 'user-1');
  assert.equal(loggedIn.body.user.phone, '13600136000');
  assert.equal(typeof loggedIn.body.token, 'string');
  assert.equal(readSession(loggedIn.body.token, 'test-secret', now).uid, 'user-1');
  assert.equal(readSession(signSession('13800138000', 'test-secret', now - 1, 'user-1'), 'test-secret', now), null);

  const stored = new Map();
  const liveToken = signSession('13600136000', 'test-secret', Date.now() + 60_000, 'user-1');
  const server = createServer(remote, {
    secret: 'test-secret',
    resolveUser: async session => ({id: session.uid, phone: session.phone}),
    getTournament: async user => stored.get(user.id) || null,
    saveTournament: async (user, body) => {
      const row = {id: 't1', title: body.title, updatedAt: '2026-10-08T10:00:00.000Z', data: body.data};
      stored.set(user.id, row);
      return row;
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    async function call(method, token, body) {
      const response = await fetch('http://127.0.0.1:' + port + '/api/tournament', {
        method,
        headers: {Authorization: token ? 'Bearer ' + token : '', 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined
      });
      return {status: response.status, body: await response.json()};
    }
    assert.equal((await call('GET')).status, 401);
    assert.equal((await call('GET', liveToken)).body.tournament, null);
    const saved = await call('POST', liveToken, {title: '杯赛', data: {version: 1, activeEventId: 'event-1', events: [{id: 'event-1', name: '杯赛'}]}});
    assert.equal(saved.status, 200);
    assert.equal(saved.body.tournament.title, '杯赛');
    assert.equal((await call('GET', liveToken)).body.tournament.data.version, 1);
    const rejected = await call('POST', liveToken, {title: '杯赛', data: []});
    assert.equal(rejected.status, 400);
  } finally {
    server.close();
  }
  console.log('Passed SMS dispatch, hidden codes, Aliyun signing and failed-send rollback.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
