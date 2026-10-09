const assert = require('node:assert/strict');
const {hashPassword, verifyPassword, passwordError} = require('../server/password.cjs');
const {createAuth, createServer, signSession} = require('../server/sms-auth.cjs');

(async () => {
  assert.equal(passwordError('short'), '密码至少 8 位。');
  const hash = await hashPassword('correct-password');
  assert.equal(await verifyPassword('correct-password', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(hash.includes('correct-password'), false);

  const users = new Map([['13800138000', {id: 'user-1', phone: '13800138000', passwordHash: hash, hasPassword: true}]]);
  const auth = createAuth({
    secret: 'test-secret',
    loginPassword: async (phone, password) => {
      const user = users.get(phone);
      if (!user) return {ok: false, status: 400, error: 'mismatch', message: '手机号或密码不正确。'};
      if (!user.hasPassword) return {ok: false, status: 400, error: 'no_password', message: '这个手机号还没有密码。请先用短信验证码登录，再在账户里设置密码。'};
      if (!await verifyPassword(password, user.passwordHash)) return {ok: false, status: 400, error: 'mismatch', message: '手机号或密码不正确。'};
      return {ok: true, user: {id: user.id, phone: user.phone, loggedInAt: '2026-10-08T10:00:00.000Z', hasPassword: true}};
    }
  });
  assert.equal((await auth.login({phone: '13800138000', password: 'short', ip: 'a'})).body.message, '密码至少 8 位。');
  assert.equal((await auth.login({phone: '13800138000', password: 'wrong-password', ip: 'a'})).body.error, 'mismatch');
  const loggedIn = await auth.login({phone: '13800138000', password: 'correct-password', ip: 'a'});
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.user.phone, '13800138000');
  assert.equal(loggedIn.body.user.hasPassword, true);

  users.set('13900139000', {id: 'user-2', phone: '13900139000', hasPassword: false});
  assert.equal((await auth.login({phone: '13900139000', password: 'correct-password', ip: 'b'})).body.error, 'no_password');

  const server = createServer(auth, {
    secret: 'test-secret',
    resolveUser: async session => ({id: session.uid, phone: session.phone}),
    setPassword: async (user, body) => {
      if (body.password !== 'new-password') throw Object.assign(new Error('unexpected'), {status: 400});
      return {ok: true, hasPassword: true, userId: user.id};
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const token = signSession('13800138000', 'test-secret', Date.now() + 60_000, 'user-1');
    const denied = await fetch('http://127.0.0.1:' + port + '/api/auth/password', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(denied.status, 401);
    const saved = await fetch('http://127.0.0.1:' + port + '/api/auth/password', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify({password: 'new-password'})
    });
    assert.equal((await saved.json()).userId, 'user-1');
  } finally {
    server.close();
  }
  console.log('Passed password hashing, login and password update.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
