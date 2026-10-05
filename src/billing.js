/* Entitlements for the published service table. Purchases are stored on this device. */
(function (root) {
  const KEY = 'ranking-billing';
  const MONTH = 30 * 86400000;
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }
  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  function monthlyActive(data) {
    data = data || load();
    return data.plan === 'monthly' && +data.monthlyExpiresAt > Date.now();
  }
  function daysLeft(data) {
    data = data || load();
    if (!monthlyActive(data)) return 0;
    return Math.max(1, Math.ceil((data.monthlyExpiresAt - Date.now()) / 86400000));
  }
  function eventPass(eventId, data) {
    data = data || load();
    return !!(eventId && data.eventPasses && data.eventPasses[eventId]);
  }
  function finalRound(matches) {
    return Math.max(0, ...(matches || []).map(match => +match[4] || 0));
  }
  function priorReady(matches) {
    const last = finalRound(matches);
    const prior = (matches || []).filter(match => +match[4] < last);
    if (!prior.length) return {ok: false, reason: '请先安排并确认末轮之前的各轮赛果，再开通单次服务。'};
    if (!prior.every(match => match[5])) return {ok: false, reason: '支付前须确认此前各轮赛果。'};
    return {ok: true};
  }
  function historyLocked(group, eventId) {
    return !!(group && group.singleUnlock) && !monthlyActive() && !eventPass(eventId);
  }
  function analysisUnlocked(group, eventId) {
    return monthlyActive() || eventPass(eventId) || !!(group && group.singleUnlock);
  }
  function independentCount(events) {
    return (events || []).filter(event => !event.pass).reduce((total, event) => total + (event.groups || 1), 0);
  }
  function canCreateEvent(events) {
    const used = independentCount(events);
    return monthlyActive() ? used < 3 : used < 1;
  }
  function canAddGroup(eventId) {
    return eventPass(eventId);
  }
  function purchaseMonthly() {
    const data = load();
    const start = Math.max(Date.now(), monthlyActive(data) ? +data.monthlyExpiresAt : Date.now());
    data.plan = 'monthly';
    data.monthlyExpiresAt = start + MONTH;
    save(data);
    return data;
  }
  function purchaseEvent(eventId, name) {
    const data = load();
    data.eventPasses = data.eventPasses || {};
    data.eventPasses[eventId] = {at: Date.now(), name: name || ''};
    save(data);
    return data;
  }
  root.RankingBilling = {load, save, monthlyActive, daysLeft, eventPass, finalRound, priorReady, historyLocked, analysisUnlocked, independentCount, canCreateEvent, canAddGroup, purchaseMonthly, purchaseEvent};
})(typeof window === 'undefined' ? globalThis : window);
