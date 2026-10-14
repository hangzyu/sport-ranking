const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createStore, normalizePhone, isMobile} = require('../src/sms-otp.js');
const OpenApi = require('@alicloud/openapi-client');
const Dypnsapi = require('@alicloud/dypnsapi20170525');
const {createClient} = require('@supabase/supabase-js');
const {passwordError, hashPassword, verifyPassword} = require('./password.cjs');
require('./load-env.cjs').loadEnv();

const ROOT = path.resolve(__dirname, '..');
const DAY_SECONDS = 24 * 60 * 60;
const SMSBAO_ERRORS = {
  '30': '短信账号或密码不正确。',
  '40': '短信账号不存在。',
  '41': '短信余额不足。',
  '43': '这个手机号发送过于频繁，请稍后再试。',
  '50': '短信内容未通过审核。',
  '51': '手机号不正确。'
};

function loadConfig() {
  const file = process.env.SMS_CONFIG || path.join(__dirname, 'sms.config.json');
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const provider = process.env.SMS_PROVIDER || stored.provider || '';
  let secret = process.env.AUTH_SECRET || stored.authSecret || '';
  if (!secret && fs.existsSync(file)) {
    secret = crypto.randomBytes(32).toString('hex');
    stored.authSecret = secret;
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
  }
  if (!secret) secret = crypto.randomBytes(32).toString('hex');
  return {
    provider,
    sign: process.env.SMS_SIGN || stored.sign || '',
    secret,
    smsbao: {
      user: process.env.SMSBAO_USER || stored.smsbao?.user || '',
      password: process.env.SMSBAO_PASSWORD || stored.smsbao?.password || ''
    },
    aliyun: {
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || stored.aliyun?.accessKeyId || '',
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || stored.aliyun?.accessKeySecret || '',
      signName: process.env.ALIYUN_SIGN_NAME || stored.aliyun?.signName || stored.sign || '',
      templateCode: process.env.ALIYUN_TEMPLATE_CODE || stored.aliyun?.templateCode || '',
      templateParam: process.env.ALIYUN_TEMPLATE_PARAM || stored.aliyun?.templateParam || JSON.stringify({code: '##code##', min: '5'}),
      schemeName: process.env.ALIYUN_SCHEME_NAME || stored.aliyun?.schemeName || ''
    },
    supabase: {
      url: process.env.SUPABASE_URL || stored.supabase?.url || '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || stored.supabase?.serviceRoleKey || ''
    }
  };
}

const pendingOutIds = new Map();
let dypns;

const ALIYUN_TIMEOUT_MESSAGE = '连接阿里云短信服务超时，请检查本机代理或网络环境后重试';

function isNetworkTimeout(error) {
  const name = String(error?.name || '');
  const code = String(error?.code || error?.data?.Code || error?.data?.code || '');
  const message = String(error?.message || error?.data?.Message || error?.data?.message || '');
  return /RequestTimeoutError|ConnectTimeout|ReadTimeout|TimeoutError|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/i.test(name + ' ' + code + ' ' + message)
    || /connect.?timeout|read.?timeout|timed?\s*out|超时/i.test(message);
}

function dypnsClient(config) {
  if (!dypns) {
    dypns = new Dypnsapi.default(new OpenApi.Config({
      accessKeyId: config.aliyun.accessKeyId,
      accessKeySecret: config.aliyun.accessKeySecret,
      endpoint: 'dypnsapi.aliyuncs.com',
      connectTimeout: 10000,
      readTimeout: 10000
    }));
  }
  return dypns;
}

function aliyunReady(config) {
  return config.provider === 'aliyun' && config.aliyun.accessKeyId && config.aliyun.accessKeySecret && config.aliyun.signName && config.aliyun.templateCode;
}

function aliyunMessage(body, fallback) {
  const code = String(body?.code || '');
  const message = String(body?.message || '');
  const detail = code + ' ' + message;
  if (/BUSINESS_LIMIT|FREQUENCY|频繁/.test(detail)) return '验证码已发送，请稍后再获取。';
  if (/MOBILE_NUMBER_ILLEGAL|手机号码/.test(detail)) return '手机号不正确。';
  if (/SMS_SIGNATURE|签名/.test(detail)) return '短信签名未通过审核或未配置。';
  if (/SMS_TEMPLATE|模板/.test(detail)) return '短信模板不正确或未通过审核。';
  return message && message.length <= 120 ? message : fallback;
}

function thrownBody(error) {
  return {code: error.code || error.data?.Code || error.data?.code || '', message: error.message || error.data?.Message || error.data?.message || ''};
}

function logAliyunError(label, error) {
  console.error(label, {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    statusCode: error?.statusCode,
    data: error?.data,
    stack: error?.stack
  });
}

async function sendDypnsCode(config, phone) {
  const outId = crypto.randomUUID();
  const request = new Dypnsapi.SendSmsVerifyCodeRequest({
    phoneNumber: phone,
    countryCode: '86',
    signName: '恒创联众',
    templateCode: '100001',
    templateParam: JSON.stringify({code: '##code##', min: '5'}),
    schemeName: config.aliyun.schemeName || undefined,
    codeLength: 6,
    codeType: 1,
    validTime: 300,
    interval: 60,
    duplicatePolicy: 1,
    returnVerifyCode: false,
    outId
  });
  let body;
  let failed = false;
  try {
    const response = await dypnsClient(config).sendSmsVerifyCode(request);
    body = response.body || {};
  } catch (error) {
    failed = true;
    logAliyunError('SendSmsVerifyCode 请求失败', error);
    if (isNetworkTimeout(error)) {
      return {status: 504, body: {ok: false, error: 'timeout', message: ALIYUN_TIMEOUT_MESSAGE}};
    }
    body = thrownBody(error);
  }
  if (body.code !== 'OK') {
    if (!failed) console.error('SendSmsVerifyCode 返回异常', body);
    if (isNetworkTimeout(body)) {
      return {status: 504, body: {ok: false, error: 'timeout', message: ALIYUN_TIMEOUT_MESSAGE}};
    }
    const limited = /BUSINESS_LIMIT|FREQUENCY|频繁/.test(String(body.code) + String(body.message));
    return {status: limited ? 429 : 502, body: {ok: false, error: limited ? 'cooldown' : 'sms_failed', message: aliyunMessage(body, '短信发送失败，请稍后再试。'), retryAfter: limited ? 60 : undefined}};
  }
  pendingOutIds.set(phone, outId);
  return {status: 200, body: {ok: true, message: '验证码已发送，5 分钟内有效。', retryAfter: 60, expiresIn: 300}};
}

async function checkDypnsCode(config, phone, code) {
  const request = new Dypnsapi.CheckSmsVerifyCodeRequest({
    phoneNumber: phone,
    countryCode: '86',
    verifyCode: code,
    schemeName: config.aliyun.schemeName || undefined,
    outId: pendingOutIds.get(phone)
  });
  let body;
  let failed = false;
  try {
    const response = await dypnsClient(config).checkSmsVerifyCode(request);
    body = response.body || {};
  } catch (error) {
    failed = true;
    logAliyunError('CheckSmsVerifyCode 请求失败', error);
    if (isNetworkTimeout(error)) {
      return {ok: false, error: 'timeout', message: ALIYUN_TIMEOUT_MESSAGE};
    }
    body = thrownBody(error);
  }
  if (body.code && body.code !== 'OK' && !failed) console.error('CheckSmsVerifyCode 返回异常', body);
  if (body.code === 'OK' && body.model?.verifyResult === 'PASS') {
    pendingOutIds.delete(phone);
    return {ok: true, phone};
  }
  if (isNetworkTimeout(body)) {
    return {ok: false, error: 'timeout', message: ALIYUN_TIMEOUT_MESSAGE};
  }
  return {ok: false, error: 'mismatch', message: body.code && body.code !== 'OK' ? aliyunMessage(body, '验证码不正确或已过期。') : '验证码不正确或已过期。'};
}

function supabaseClient(config) {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false}
  });
}

function publicProfile(row, loggedInAt) {
  return {
    id: row.id,
    phone: row.phone,
    loggedInAt: row.last_login_at || loggedInAt,
    createdAt: row.created_at || '',
    hasPassword: Boolean(row.password_hash)
  };
}

async function settleLogin(config, phone) {
  const supabase = supabaseClient(config);
  const loggedInAt = new Date().toISOString();
  const existing = await supabase.from('users').select('id, phone, created_at, last_login_at, password_hash').eq('phone', phone).maybeSingle();
  if (existing.error) throw new Error('无法读取用户资料。');
  if (!existing.data) {
    const created = await supabase.from('users').insert({phone, last_login_at: loggedInAt}).select('id, phone, created_at, last_login_at, password_hash').single();
    if (created.error) throw new Error('无法创建用户。');
    return publicProfile(created.data, loggedInAt);
  }
  const updated = await supabase.from('users').update({last_login_at: loggedInAt}).eq('id', existing.data.id).select('id, phone, created_at, last_login_at, password_hash').single();
  if (updated.error) throw new Error('无法更新登录时间。');
  return publicProfile(updated.data, loggedInAt);
}

async function loginWithPassword(config, phone, password) {
  const supabase = supabaseClient(config);
  const found = await supabase.from('users').select('id, phone, created_at, password_hash').eq('phone', phone).maybeSingle();
  if (found.error) {
    console.error('密码登录失败', found.error);
    throw new Error('暂时无法登录，请稍后再试。');
  }
  if (!found.data) return {ok: false, status: 400, error: 'mismatch', message: '手机号或密码不正确。'};
  if (!found.data.password_hash) return {ok: false, status: 400, error: 'no_password', message: '这个手机号还没有密码。请先用短信验证码登录，再在账户里设置密码。'};
  if (!await verifyPassword(password, found.data.password_hash)) return {ok: false, status: 400, error: 'mismatch', message: '手机号或密码不正确。'};
  const loggedInAt = new Date().toISOString();
  const updated = await supabase.from('users').update({last_login_at: loggedInAt}).eq('id', found.data.id);
  if (updated.error) console.error('更新登录时间失败', updated.error);
  return {ok: true, user: {id: found.data.id, phone: found.data.phone, loggedInAt, createdAt: found.data.created_at || '', hasPassword: true}};
}

async function saveUserPassword(config, userId, body) {
  const problem = passwordError(body?.password);
  if (problem) {
    const error = new Error(problem);
    error.status = 400;
    throw error;
  }
  const supabase = supabaseClient(config);
  const found = await supabase.from('users').select('id, password_hash').eq('id', userId).maybeSingle();
  if (found.error || !found.data) {
    if (found.error) console.error('读取密码失败', found.error);
    throw new Error('无法读取账户。');
  }
  if (found.data.password_hash && !await verifyPassword(body.currentPassword, found.data.password_hash)) {
    const error = new Error('当前密码不正确。');
    error.status = 400;
    throw error;
  }
  const saved = await supabase.from('users').update({password_hash: await hashPassword(body.password)}).eq('id', userId);
  if (saved.error) {
    console.error('保存密码失败', saved.error);
    throw new Error('无法保存密码。');
  }
  return {ok: true, hasPassword: true};
}

async function registerWithPassword(config, phone, password) {
  const problem = passwordError(password);
  if (problem) return {ok: false, status: 400, error: 'invalid_password', message: problem};
  const supabase = supabaseClient(config);
  const loggedInAt = new Date().toISOString();
  const hash = await hashPassword(password);
  const existing = await supabase.from('users').select('id, phone, created_at, password_hash').eq('phone', phone).maybeSingle();
  if (existing.error) {
    console.error('注册读取用户失败', existing.error);
    return {ok: false, status: 502, error: 'user_failed', message: '暂时无法注册，请稍后再试。'};
  }
  if (existing.data?.password_hash) {
    return {ok: false, status: 400, error: 'exists', message: '该手机号已注册，请直接登录。'};
  }
  if (existing.data) {
    const updated = await supabase.from('users').update({password_hash: hash, last_login_at: loggedInAt}).eq('id', existing.data.id).select('id, phone, created_at, last_login_at, password_hash').single();
    if (updated.error) {
      console.error('注册更新用户失败', updated.error);
      return {ok: false, status: 502, error: 'user_failed', message: '暂时无法注册，请稍后再试。'};
    }
    return {ok: true, user: publicProfile(updated.data, loggedInAt)};
  }
  const created = await supabase.from('users').insert({phone, password_hash: hash, last_login_at: loggedInAt}).select('id, phone, created_at, last_login_at, password_hash').single();
  if (created.error) {
    console.error('注册创建用户失败', created.error);
    return {ok: false, status: 502, error: 'user_failed', message: '暂时无法注册，请稍后再试。'};
  }
  return {ok: true, user: publicProfile(created.data, loggedInAt)};
}

function smsbaoPassword(password) {
  return /^[a-f0-9]{32}$/i.test(password) ? password.toLowerCase() : crypto.createHash('md5').update(password).digest('hex');
}

function messageText(sign, code) {
  return '【' + sign + '】您的验证码是' + code + '，5分钟内有效，请勿泄露。';
}

async function sendSmsbao(config, phone, code) {
  const query = new URLSearchParams({
    u: config.smsbao.user,
    p: smsbaoPassword(config.smsbao.password),
    m: phone,
    c: messageText(config.sign, code)
  });
  const response = await fetch('https://api.smsbao.com/sms?' + query.toString(), {signal: AbortSignal.timeout(10000)});
  const status = (await response.text()).trim().split(/\s+/)[0];
  if (status !== '0') {
    const error = new Error(SMSBAO_ERRORS[status] || '短信发送失败，请稍后再试。');
    error.providerStatus = status;
    throw error;
  }
}

async function sendOutbox(phone, code) {
  const file = process.env.SMS_OUTBOX || path.join(os.tmpdir(), 'ranking-sms-outbox.json');
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  list.push({phone, code, at: new Date().toISOString()});
  fs.writeFileSync(file, JSON.stringify(list));
}

function createDeliver(config = loadConfig()) {
  if (config.provider === 'outbox') return (phone, code) => sendOutbox(phone, code);
  if (config.provider === 'smsbao' && config.smsbao.user && config.smsbao.password && config.sign) {
    return (phone, code) => sendSmsbao(config, phone, code);
  }
  return null;
}

function signSession(phone, secret, expiresAt, userId) {
  const payload = Buffer.from(JSON.stringify({phone, uid: userId || '', exp: expiresAt})).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function readSession(token, secret, now = Date.now()) {
  if (!token || !secret || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data?.phone || typeof data.exp !== 'number' || data.exp < now) return null;
  return {phone: data.phone, uid: data.uid || '', exp: data.exp};
}

function presentTournament(row) {
  if (!row) return null;
  return {id: row.id, title: row.title || '我的足球赛', updatedAt: row.updated_at, data: row.data || null};
}

async function userFromSession(config, session) {
  const supabase = supabaseClient(config);
  if (session.uid) {
    const byId = await supabase.from('users').select('id, phone').eq('id', session.uid).maybeSingle();
    if (byId.error) {
      console.error('确认登录用户失败', byId.error);
      throw new Error('无法确认登录用户。');
    }
    if (byId.data) return byId.data;
  }
  const byPhone = await supabase.from('users').select('id, phone').eq('phone', session.phone).maybeSingle();
  if (byPhone.error) {
    console.error('确认登录用户失败', byPhone.error);
    throw new Error('无法确认登录用户。');
  }
  return byPhone.data || null;
}

async function loadUserTournament(config, userId) {
  const supabase = supabaseClient(config);
  const existing = await supabase.from('tournaments').select('id, title, data, updated_at').eq('user_id', userId).order('updated_at', {ascending: false}).limit(1);
  if (existing.error) {
    console.error('读取赛事失败', existing.error);
    throw new Error('无法读取赛事。');
  }
  return presentTournament(existing.data?.[0]);
}

async function saveUserTournament(config, userId, body) {
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error('赛事数据格式不正确。');
    error.status = 400;
    throw error;
  }
  const title = String(body.title || data.name || '我的足球赛').trim().slice(0, 80) || '我的足球赛';
  const updatedAt = new Date().toISOString();
  const supabase = supabaseClient(config);
  const existing = await supabase.from('tournaments').select('id').eq('user_id', userId).order('updated_at', {ascending: false}).limit(1);
  if (existing.error) {
    console.error('读取赛事失败', existing.error);
    throw new Error('无法读取赛事。');
  }
  const row = existing.data?.[0];
  const saved = row
    ? await supabase.from('tournaments').update({title, data, updated_at: updatedAt}).eq('id', row.id).select('id, title, data, updated_at').single()
    : await supabase.from('tournaments').insert({user_id: userId, title, data, updated_at: updatedAt}).select('id, title, data, updated_at').single();
  if (saved.error) {
    console.error('保存赛事失败', saved.error);
    throw new Error('无法保存赛事。');
  }
  return presentTournament(saved.data);
}

function createAuth(options) {
  const store = options.store;
  const deliver = options.deliver;
  const secret = options.secret || crypto.randomBytes(32).toString('hex');
  const now = options.now || (() => Date.now());
  const hits = new Map();

  function allow(ip, limit) {
    const time = now();
    const recent = (hits.get(ip) || []).filter(at => time - at < 10 * 60 * 1000);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(time);
    hits.set(ip, recent);
    return true;
  }

  async function send({phone, ip}) {
    if (!allow(ip || 'local', 30)) return {status: 429, body: {ok: false, error: 'ip_limit', message: '发送过于频繁，请稍后再试。'}};
    if (options.sendSms) {
      const normalized = normalizePhone(phone);
      if (!isMobile(normalized)) return {status: 400, body: {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'}};
      return options.sendSms(normalized);
    }
    if (!deliver) return {status: 503, body: {ok: false, error: 'unconfigured', message: '短信通道尚未配置，暂时无法发送验证码。'}};
    const issued = await store.request(phone);
    if (!issued.ok) return {status: issued.error === 'invalid_phone' ? 400 : 429, body: {ok: false, error: issued.error, message: issued.message, retryAfter: issued.retryAfter}};
    try {
      await deliver(issued.phone, issued.code);
    } catch (error) {
      store.release(issued.phone);
      return {status: 502, body: {ok: false, error: 'sms_failed', message: error.message || '短信发送失败，请稍后再试。'}};
    }
    return {status: 200, body: {ok: true, message: '验证码已发送，5 分钟内有效。', retryAfter: issued.retryAfter, expiresIn: issued.expiresIn}};
  }

  async function verify({phone, code, ip}) {
    if (!allow(ip || 'local', 60)) return {status: 429, body: {ok: false, error: 'ip_limit', message: '尝试过于频繁，请稍后再试。'}};
    if (options.checkSms) {
      const normalized = normalizePhone(phone);
      if (!isMobile(normalized)) return {status: 400, body: {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'}};
      const checked = await options.checkSms(normalized, String(code || '').replace(/\D/g, ''));
      if (!checked.ok) {
        const timeout = checked.error === 'timeout';
        return {status: timeout ? 504 : 400, body: {ok: false, error: checked.error, message: checked.message}};
      }
      let profile;
      try {
        profile = options.settleUser ? await options.settleUser(checked.phone) : null;
      } catch (error) {
        return {status: 502, body: {ok: false, error: 'user_failed', message: error.message || '登录状态保存失败，请稍后再试。'}};
      }
      const loggedInAt = profile?.loggedInAt || profile?.last_login_at || new Date(now()).toISOString();
      return {status: 200, body: {ok: true, token: signSession(checked.phone, secret, now() + 30 * DAY_SECONDS * 1000, profile?.id || ''), user: {id: profile?.id || '', phone: checked.phone, loggedInAt, createdAt: profile?.createdAt || profile?.created_at || '', hasPassword: Boolean(profile?.hasPassword)}}};
    }
    const result = await store.check(phone, code);
    if (!result.ok) return {status: 400, body: {ok: false, error: result.error, message: result.message, attemptsLeft: result.attemptsLeft}};
    const loggedInAt = new Date(now()).toISOString();
    return {status: 200, body: {ok: true, token: signSession(result.phone, secret, now() + 30 * DAY_SECONDS * 1000), user: {phone: result.phone, loggedInAt}}};
  }

  async function login({phone, password, ip}) {
    if (!allow(ip || 'local', 20)) return {status: 429, body: {ok: false, error: 'ip_limit', message: '尝试过于频繁，请稍后再试。'}};
    const normalized = normalizePhone(phone);
    if (!isMobile(normalized)) return {status: 400, body: {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'}};
    const problem = passwordError(password);
    if (problem) return {status: 400, body: {ok: false, error: 'invalid_password', message: problem}};
    if (!options.loginPassword) return {status: 503, body: {ok: false, error: 'unconfigured', message: '密码登录尚未配置。'}};
    let result;
    try {
      result = await options.loginPassword(normalized, String(password));
    } catch (error) {
      console.error('密码登录失败', error);
      return {status: 502, body: {ok: false, error: 'login_failed', message: '暂时无法登录，请稍后再试。'}};
    }
    if (!result.ok) return {status: result.status || 400, body: {ok: false, error: result.error, message: result.message || '手机号或密码不正确。'}};
    const loggedInAt = result.user.loggedInAt || new Date(now()).toISOString();
    return {status: 200, body: {ok: true, token: signSession(result.user.phone, secret, now() + 30 * DAY_SECONDS * 1000, result.user.id), user: {...result.user, loggedInAt, hasPassword: true}}};
  }

  async function register({phone, password, code, ip}) {
    if (!allow(ip || 'local', 20)) return {status: 429, body: {ok: false, error: 'ip_limit', message: '尝试过于频繁，请稍后再试。'}};
    const normalized = normalizePhone(phone);
    if (!isMobile(normalized)) return {status: 400, body: {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'}};
    const problem = passwordError(password);
    if (problem) return {status: 400, body: {ok: false, error: 'invalid_password', message: problem}};
    const otp = String(code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(otp)) return {status: 400, body: {ok: false, error: 'invalid_code', message: '请输入 6 位验证码。'}};
    if (!options.registerUser) return {status: 503, body: {ok: false, error: 'unconfigured', message: '注册尚未配置。'}};
    if (options.checkSms) {
      const checked = await options.checkSms(normalized, otp);
      if (!checked.ok) {
        const timeout = checked.error === 'timeout';
        return {status: timeout ? 504 : 400, body: {ok: false, error: checked.error, message: checked.message}};
      }
    } else {
      const result = await store.check(normalized, otp);
      if (!result.ok) return {status: 400, body: {ok: false, error: result.error, message: result.message, attemptsLeft: result.attemptsLeft}};
    }
    let result;
    try {
      result = await options.registerUser(normalized, String(password));
    } catch (error) {
      console.error('注册失败', error);
      return {status: 502, body: {ok: false, error: 'user_failed', message: '暂时无法注册，请稍后再试。'}};
    }
    if (!result.ok) return {status: result.status || 400, body: {ok: false, error: result.error, message: result.message || '注册失败，请稍后再试。'}};
    const loggedInAt = result.user.loggedInAt || new Date(now()).toISOString();
    return {status: 200, body: {ok: true, token: signSession(result.user.phone, secret, now() + 30 * DAY_SECONDS * 1000, result.user.id), user: {...result.user, loggedInAt, hasPassword: true}}};
  }

  return {send, verify, login, register};
}

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'};

function staticFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.split('/').some(part => part === '..' || part.startsWith('.')) || relative.startsWith('server/') || relative.startsWith('node_modules/')) return null;
  const file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return {file, type: TYPES[path.extname(file)] || 'application/octet-stream'};
}

function headers(extra) {
  return Object.assign({
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  }, extra);
}

function bearerToken(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function sendJson(response, status, body) {
  response.writeHead(status, headers({'Content-Type': 'application/json; charset=utf-8'})).end(JSON.stringify(body));
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('请求内容过大。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求格式不正确。');
    error.status = 400;
    throw error;
  }
}

function createServer(auth, options = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/tournament')) {
      response.writeHead(204, headers()).end();
      return;
    }
    if (url.pathname === '/api/tournament' && (request.method === 'GET' || request.method === 'POST')) {
      const session = readSession(bearerToken(request), options.secret || '');
      if (!session) {
        sendJson(response, 401, {ok: false, message: '请先登录。'});
        return;
      }
      try {
        const user = options.resolveUser ? await options.resolveUser(session) : await userFromSession(options.config, session);
        if (!user?.id) {
          sendJson(response, 401, {ok: false, message: '请先登录。'});
          return;
        }
        if (request.method === 'GET') {
          const tournament = options.getTournament ? await options.getTournament(user) : await loadUserTournament(options.config, user.id);
          sendJson(response, 200, {ok: true, tournament});
          return;
        }
        const body = await readBody(request, 1024 * 1024);
        if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
          sendJson(response, 400, {ok: false, message: '赛事数据格式不正确。'});
          return;
        }
        const tournament = options.saveTournament ? await options.saveTournament(user, body) : await saveUserTournament(options.config, user.id, body);
        sendJson(response, 200, {ok: true, tournament});
      } catch (error) {
        console.error('赛事接口失败', error);
        sendJson(response, error.status || 502, {ok: false, message: error.status ? error.message : '赛事同步失败，请稍后再试。'});
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/register') {
      let body = {};
      try {
        body = await readBody(request, 2048);
      } catch (error) {
        sendJson(response, error.status || 400, {ok: false, message: error.status === 413 ? '请求内容过大。' : '请求格式不正确。'});
        return;
      }
      const result = await auth.register({phone: body.phone, password: body.password, code: body.code, ip: request.socket.remoteAddress || 'local'});
      sendJson(response, result.status, result.body);
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/api/auth/password/login' || url.pathname === '/api/auth/password')) {
      let body = {};
      try {
        body = await readBody(request, 2048);
      } catch (error) {
        sendJson(response, error.status || 400, {ok: false, message: error.status === 413 ? '请求内容过大。' : '请求格式不正确。'});
        return;
      }
      if (url.pathname.endsWith('/login')) {
        const result = await auth.login({phone: body.phone, password: body.password, ip: request.socket.remoteAddress || 'local'});
        sendJson(response, result.status, result.body);
        return;
      }
      const session = readSession(bearerToken(request), options.secret || '');
      if (!session) {
        sendJson(response, 401, {ok: false, message: '请先登录。'});
        return;
      }
      try {
        const user = options.resolveUser ? await options.resolveUser(session) : await userFromSession(options.config, session);
        if (!user?.id) {
          sendJson(response, 401, {ok: false, message: '请先登录。'});
          return;
        }
        if (!options.setPassword) {
          sendJson(response, 503, {ok: false, message: '密码设置尚未配置。'});
          return;
        }
        const saved = await options.setPassword(user, body);
        sendJson(response, 200, saved);
      } catch (error) {
        console.error('保存密码失败', error);
        sendJson(response, error.status || 502, {ok: false, message: error.status ? error.message : '无法保存密码，请稍后再试。'});
      }
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/api/auth/sms/send' || url.pathname === '/api/auth/sms/verify')) {
      let body = {};
      try {
        body = await readBody(request, 2048);
      } catch (error) {
        sendJson(response, error.status || 400, {ok: false, message: error.status === 413 ? '请求内容过大。' : '请求格式不正确。'});
        return;
      }
      const ip = request.socket.remoteAddress || 'local';
      const result = url.pathname.endsWith('/send')
        ? await auth.send({phone: body.phone, ip})
        : await auth.verify({phone: body.phone, code: body.code, ip});
      sendJson(response, result.status, result.body);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, headers()).end();
      return;
    }
    const asset = staticFile(url.pathname);
    if (!asset) {
      response.writeHead(404, headers({'Content-Type': 'text/plain; charset=utf-8'})).end('Not found');
      return;
    }
    response.writeHead(200, {'Content-Type': asset.type, 'Cache-Control': 'no-cache'});
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(asset.file).pipe(response);
  });
}

function listen(port = Number(process.env.PORT) || 8787, host = process.env.HOST || '127.0.0.1') {
  const config = loadConfig();
  const ready = aliyunReady(config);
  const auth = createAuth({
    store: createStore(),
    deliver: ready ? null : createDeliver(config),
    sendSms: ready ? phone => sendDypnsCode(config, phone) : null,
    checkSms: ready ? (phone, code) => checkDypnsCode(config, phone, code) : null,
    settleUser: ready ? phone => settleLogin(config, phone) : null,
    loginPassword: (phone, password) => loginWithPassword(config, phone, password),
    registerUser: (phone, password) => registerWithPassword(config, phone, password),
    secret: config.secret
  });
  const server = createServer(auth, {
    config,
    secret: config.secret,
    setPassword: (user, body) => saveUserPassword(config, user.id, body)
  });
  server.listen(port, host);
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  listen(port, host).on('listening', () => {
    console.log('Ranking 已启动：http://' + host + ':' + port + '/');
    console.log(aliyunReady(loadConfig()) ? '阿里云号码认证短信已启用。' : '短信通道尚未配置。');
  });
}

module.exports = {createAuth, createDeliver, createServer, loadConfig, smsbaoPassword, messageText, listen, signSession, readSession};
