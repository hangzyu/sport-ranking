/* One-time passwords for phone login. Stores only a hash, and enforces expiry, cooldown and send caps. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RankingSmsOtp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CODE_TTL = 5 * 60 * 1000;
  const COOLDOWN = 60 * 1000;
  const MAX_ATTEMPTS = 5;
  const MAX_SENDS = 8;
  const DAY = 24 * 60 * 60 * 1000;

  function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.replace(/^86(?=1[3-9]\d{9}$)/, '');
  }

  function isMobile(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
  }

  function normalizeCode(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function maskPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!isMobile(normalized)) return normalized;
    return normalized.slice(0, 3) + '****' + normalized.slice(7);
  }

  function randomCode() {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(100000 + (bytes[0] % 900000));
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function same(left, right) {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return diff === 0;
  }

  function createStore(options) {
    options = options || {};
    const now = options.now || (() => Date.now());
    const nextCode = options.randomCode || randomCode;
    const digest = options.digest || sha256;
    const records = new Map();

    function record(phone) {
      let current = records.get(phone);
      if (!current) {
        current = {sends: [], hash: '', salt: '', expiresAt: 0, cooldownUntil: 0, attempts: 0};
        records.set(phone, current);
      }
      const time = now();
      current.sends = current.sends.filter(at => time - at < DAY);
      return current;
    }

    async function request(raw) {
      const phone = normalizePhone(raw);
      if (!isMobile(phone)) return {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'};
      const current = record(phone);
      const time = now();
      if (current.sends.length >= MAX_SENDS) return {ok: false, error: 'daily_limit', message: '该手机号今天的验证码次数已用完，请明天再试。'};
      if (time < current.cooldownUntil) {
        return {ok: false, error: 'cooldown', message: '验证码已发送，请稍后再获取。', retryAfter: Math.max(1, Math.ceil((current.cooldownUntil - time) / 1000))};
      }
      const code = nextCode();
      current.salt = randomSalt();
      current.hash = await digest(current.salt + ':' + code);
      current.expiresAt = time + CODE_TTL;
      current.cooldownUntil = time + COOLDOWN;
      current.attempts = 0;
      current.sends.push(time);
      return {ok: true, phone, code, retryAfter: COOLDOWN / 1000, expiresIn: CODE_TTL / 1000};
    }

    function release(raw) {
      const phone = normalizePhone(raw);
      const current = records.get(phone);
      if (!current) return;
      current.sends.pop();
      current.cooldownUntil = 0;
      current.hash = '';
      current.expiresAt = 0;
      current.attempts = 0;
    }

    async function check(rawPhone, rawCode) {
      const phone = normalizePhone(rawPhone);
      const code = normalizeCode(rawCode);
      if (!isMobile(phone)) return {ok: false, error: 'invalid_phone', message: '请输入有效的 11 位手机号。'};
      if (!/^\d{6}$/.test(code)) return {ok: false, error: 'invalid_code', message: '请输入 6 位验证码。'};
      const current = records.get(phone);
      if (!current || !current.hash) return {ok: false, error: 'missing', message: '请先获取验证码。'};
      const time = now();
      if (time >= current.expiresAt) {
        current.hash = '';
        return {ok: false, error: 'expired', message: '验证码已过期，请重新获取。'};
      }
      const expected = await digest(current.salt + ':' + code);
      if (!same(current.hash, expected)) {
        current.attempts += 1;
        if (current.attempts >= MAX_ATTEMPTS) {
          current.hash = '';
          return {ok: false, error: 'locked', message: '验证码错误次数过多，请重新获取。'};
        }
        const attemptsLeft = MAX_ATTEMPTS - current.attempts;
        return {ok: false, error: 'mismatch', message: '验证码不正确，还可尝试 ' + attemptsLeft + ' 次。', attemptsLeft};
      }
      current.hash = '';
      current.expiresAt = 0;
      current.attempts = 0;
      return {ok: true, phone};
    }

    return {request, release, check};
  }

  return {createStore, normalizePhone, normalizeCode, isMobile, maskPhone, CODE_TTL, COOLDOWN, MAX_ATTEMPTS, MAX_SENDS};
});
