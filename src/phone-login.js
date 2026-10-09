/* Phone login. A code is accepted only after the SMS service has issued and checked it. */
(function (root) {
  const SEND = 'api/auth/sms/send';
  const VERIFY = 'api/auth/sms/verify';
  const PASSWORD_LOGIN = 'api/auth/password/login';
  const PASSWORD_SAVE = 'api/auth/password';
  const PURCHASES = {single: true, monthly: true, event: true, custom: true};
  const cooldowns = new Map();
  let timer = 0;
  let sending = false;
  let verifying = false;
  let loginMode = 'sms';
  let options = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  }

  function endpoint(path) {
    const configured = localStorage.getItem('ranking-auth-api') || '';
    if (!configured) return new URL(path, document.baseURI).href;
    return configured.replace(/\/$/, '') + '/' + path;
  }

  function setHint(text, kind) {
    const hint = byId('loginHint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.classList.toggle('is-error', kind === 'error');
    hint.classList.toggle('is-ok', kind === 'ok');
  }

  function paintSendButton() {
    const button = byId('sendLoginCode');
    if (!button) return;
    const phone = normalizePhone(byId('loginPhone')?.value);
    const left = Math.ceil(((cooldowns.get(phone) || 0) - Date.now()) / 1000);
    if (sending) {
      button.disabled = true;
      button.textContent = '发送中…';
      return;
    }
    if (left > 0) {
      button.disabled = true;
      button.textContent = left + '秒后重发';
      return;
    }
    button.disabled = false;
    button.textContent = '获取验证码';
  }

  function startTick() {
    paintSendButton();
    if (!timer) timer = setInterval(paintSendButton, 1000);
  }

  function stopTick() {
    clearInterval(timer);
    timer = 0;
  }

  function rememberCooldown(phone, retryAfter) {
    if (!retryAfter) return;
    cooldowns.set(phone, Date.now() + retryAfter * 1000);
  }

  async function post(path, body, token) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    let response;
    try {
      response = await fetch(endpoint(path), {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
    } catch {
      return {ok: false, message: '网络异常，请稍后再试。'};
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return {ok: false, message: response.status === 404 ? '验证码服务暂时无法连接，请稍后再试。' : '验证码服务暂时不可用，请稍后再试。'};
    }
    return data;
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').replace(/^86(?=1[3-9]\d{9}$)/, '');
  }

  function signOut() {
    localStorage.removeItem('ranking-user');
    sessionStorage.removeItem('ranking-after-login');
    renderLogin();
    byId('loginDialog')?.close();
    options.onSessionChange?.();
  }

  function renderLogin() {
    const user = root.currentUser?.() || null;
    const entry = byId('accountEntry');
    if (entry) entry.textContent = user ? '账户 · ' + user.phone : '登录';
    const buying = (sessionStorage.getItem('ranking-after-login') || '').startsWith('buy:');
    const intro = buying ? '登录后即可继续购买。首次验证手机号后将自动创建账户。' : '首次验证手机号后将自动创建账户。';
    const content = byId('loginContent');
    if (!content) return;
    if (user) {
      const currentField = user.hasPassword ? '<input class="field" id="currentPassword" type="password" autocomplete="current-password" placeholder="当前密码">' : '';
      content.innerHTML = '<h2>账户中心</h2><div class="account-panel"><strong>' + escapeHtml(user.phone) + '</strong><p>已登录</p><p>当前权益：' + escapeHtml(options.planLabel?.() || '') + '</p><p>本机赛事：' + escapeHtml(options.eventLabel?.() || '') + '</p><p>' + (user.hasPassword ? '已设置登录密码，可直接用手机号和密码登录。' : '尚未设置密码。设置后可直接用手机号和密码登录。') + '</p></div><form class="password-form" id="passwordForm"><h3>登录密码</h3>' + currentField + '<input class="field" id="accountPassword" type="password" autocomplete="new-password" maxlength="64" placeholder="新密码，至少 8 位"><input class="field" id="accountPasswordAgain" type="password" autocomplete="new-password" maxlength="64" placeholder="再输入一次新密码"><p class="login-hint" id="passwordHint" aria-live="polite"></p><button class="login-submit" id="savePassword" type="submit">' + (user.hasPassword ? '修改密码' : '设置密码') + '</button></form><div class="account-actions"><button id="logoutAccount" type="button">退出登录</button></div>';
      const logout = byId('logoutAccount');
      if (logout) logout.onclick = signOut;
      byId('passwordForm').onsubmit = savePassword;
      return;
    }
    content.innerHTML = '<h2>登录</h2><p class="login-intro">' + intro + '</p><div class="login-modes" role="tablist"><button type="button" id="loginModeSms" class="' + (loginMode === 'sms' ? 'is-current' : 'secondary') + '">短信验证码</button><button type="button" id="loginModePassword" class="' + (loginMode === 'password' ? 'is-current' : 'secondary') + '">密码登录</button></div>' + (loginMode === 'password'
      ? '<form class="login-form" id="loginForm"><input class="field" id="loginPhone" name="phone" inputmode="tel" autocomplete="username" maxlength="11" placeholder="请输入 11 位手机号"><input class="field" id="loginPassword" name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="请输入密码"><p class="login-hint" id="loginHint" aria-live="polite">还没有密码时，请先用短信验证码登录，再在账户里设置。</p><button class="login-submit" id="loginSubmit" type="submit">登录</button></form>'
      : '<form class="login-form" id="loginForm"><input class="field" id="loginPhone" name="phone" inputmode="tel" autocomplete="tel" maxlength="11" placeholder="请输入 11 位手机号"><div class="login-code-row"><input class="field" id="loginCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="输入验证码"><button class="secondary" id="sendLoginCode" type="button">获取验证码</button></div><p class="login-hint" id="loginHint" aria-live="polite"></p><button class="login-submit" id="loginSubmit" type="submit">登录 / 注册</button></form>');
    byId('loginModeSms').onclick = () => {
      loginMode = 'sms';
      renderLogin();
      startTick();
      byId('loginPhone')?.focus();
    };
    byId('loginModePassword').onclick = () => {
      loginMode = 'password';
      renderLogin();
      byId('loginPassword')?.focus();
    };
    byId('loginPhone').addEventListener('input', () => {
      byId('loginPhone').value = byId('loginPhone').value.replace(/\D/g, '').slice(0, 11);
      if (loginMode === 'sms') paintSendButton();
    });
    if (loginMode === 'password') {
      byId('loginForm').onsubmit = loginWithPassword;
      return;
    }
    byId('loginCode').addEventListener('input', () => {
      byId('loginCode').value = byId('loginCode').value.replace(/\D/g, '').slice(0, 6);
    });
    byId('sendLoginCode').onclick = sendCode;
    byId('loginForm').onsubmit = verifyCode;
    paintSendButton();
  }

  function saveSession(data) {
    localStorage.setItem('ranking-user', JSON.stringify({
      id: data.user.id || '',
      phone: data.user.phone,
      plan: options.plan?.() || 'trial',
      loggedInAt: data.user.loggedInAt,
      verified: true,
      hasPassword: Boolean(data.user.hasPassword),
      token: data.token || ''
    }));
  }

  function finishLogin(data) {
    saveSession(data);
    const pending = sessionStorage.getItem('ranking-after-login') || '';
    sessionStorage.removeItem('ranking-after-login');
    renderLogin();
    byId('loginDialog')?.close();
    stopTick();
    options.onLogin?.();
    if (pending.startsWith('buy:')) {
      const kind = pending.slice(4);
      if (PURCHASES[kind]) options.continuePurchase?.(kind);
    }
  }

  async function sendCode() {
    if (sending) return;
    const phone = normalizePhone(byId('loginPhone').value);
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setHint('请输入有效的 11 位手机号。', 'error');
      byId('loginPhone').focus();
      return;
    }
    sending = true;
    paintSendButton();
    setHint('正在发送验证码…', '');
    const data = await post(SEND, {phone});
    sending = false;
    rememberCooldown(phone, data.retryAfter);
    paintSendButton();
    if (!data.ok) {
      setHint(data.message || '验证码发送失败，请稍后再试。', 'error');
      return;
    }
    setHint(data.message || '验证码已发送，5 分钟内有效。', 'ok');
    byId('loginCode')?.focus();
  }

  async function verifyCode(event) {
    event.preventDefault();
    if (verifying) return;
    const phone = normalizePhone(byId('loginPhone').value);
    const code = String(byId('loginCode').value || '').replace(/\D/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setHint('请输入有效的 11 位手机号。', 'error');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setHint('请输入 6 位验证码。', 'error');
      return;
    }
    verifying = true;
    const submit = byId('loginSubmit');
    if (submit) {
      submit.disabled = true;
      submit.textContent = '正在验证…';
    }
    const data = await post(VERIFY, {phone, code});
    verifying = false;
    if (!data.ok || !data.user?.phone) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = '登录 / 注册';
      }
      setHint(data.message || '验证码不正确。', 'error');
      return;
    }
    finishLogin(data);
  }

  async function loginWithPassword(event) {
    event.preventDefault();
    if (verifying) return;
    const phone = normalizePhone(byId('loginPhone').value);
    const password = String(byId('loginPassword').value || '');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setHint('请输入有效的 11 位手机号。', 'error');
      return;
    }
    if (password.length < 8) {
      setHint('密码至少 8 位。', 'error');
      return;
    }
    verifying = true;
    const submit = byId('loginSubmit');
    if (submit) {
      submit.disabled = true;
      submit.textContent = '正在登录…';
    }
    const data = await post(PASSWORD_LOGIN, {phone, password});
    verifying = false;
    if (!data.ok || !data.user?.phone) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = '登录';
      }
      setHint(data.message || '手机号或密码不正确。', 'error');
      return;
    }
    finishLogin(data);
  }

  async function savePassword(event) {
    event.preventDefault();
    const hint = byId('passwordHint');
    const show = (text, kind) => {
      if (!hint) return;
      hint.textContent = text || '';
      hint.classList.toggle('is-error', kind === 'error');
      hint.classList.toggle('is-ok', kind === 'ok');
    };
    const password = String(byId('accountPassword').value || '');
    const again = String(byId('accountPasswordAgain').value || '');
    const currentPassword = String(byId('currentPassword')?.value || '');
    if (password.length < 8) {
      show('密码至少 8 位。', 'error');
      return;
    }
    if (password !== again) {
      show('两次输入的密码不一致。', 'error');
      return;
    }
    const user = root.currentUser?.();
    if (!user?.token) {
      show('请先登录。', 'error');
      return;
    }
    const button = byId('savePassword');
    if (button) button.disabled = true;
    const data = await post(PASSWORD_SAVE, {password, currentPassword}, user.token);
    if (button) button.disabled = false;
    if (!data.ok) {
      show(data.message || '无法保存密码。', 'error');
      return;
    }
    const stored = root.currentUser() || user;
    stored.hasPassword = true;
    localStorage.setItem('ranking-user', JSON.stringify(stored));
    renderLogin();
    const nextHint = byId('passwordHint');
    if (nextHint) {
      nextHint.textContent = '密码已保存，下次可用手机号和密码登录。';
      nextHint.classList.add('is-ok');
    }
  }

  function mount(next) {
    options = next || {};
    const actions = document.querySelector('.header-actions');
    if (!actions || byId('accountEntry')) return;
    actions.insertAdjacentHTML('afterbegin', '<button class="secondary account-entry" id="accountEntry" type="button">登录</button>');
    document.body.insertAdjacentHTML('beforeend', '<dialog class="method-dialog login-dialog" id="loginDialog"><div class="dialog-content"><button class="dialog-close" id="closeLoginDialog" type="button" aria-label="关闭">×</button><div id="loginContent"></div></div></dialog>');
    byId('accountEntry').onclick = () => {
      renderLogin();
      byId('loginDialog').showModal();
      startTick();
      if (!root.currentUser?.()) byId('loginPhone')?.focus();
    };
    byId('closeLoginDialog').onclick = () => {
      sessionStorage.removeItem('ranking-after-login');
      byId('loginDialog').close();
      stopTick();
    };
    byId('loginDialog').addEventListener('close', stopTick);
    byId('loginDialog').addEventListener('cancel', () => sessionStorage.removeItem('ranking-after-login'));
    renderLogin();
  }

  root.PhoneLogin = {mount, normalizePhone, logout: signOut};
})(typeof window === 'undefined' ? globalThis : window);
