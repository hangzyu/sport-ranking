/* Group schedule list: underline scores, status dots, and score-entry keyboard flow. */
(function (root) {
  const ESCAPE = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
  let pending = null;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ESCAPE[char]);
  }

  function field(match, slot) {
    return document.querySelector('[data-match="' + match + '"][data-slot="' + slot + '"]');
  }

  function queueFocus(match, slot, select) {
    pending = {match: String(match), slot, select: !!select};
  }

  function clearFocus() {
    pending = null;
  }

  function restoreFocus() {
    const target = pending;
    pending = null;
    if (!target) return;
    const input = field(target.match, target.slot);
    if (!input || input.disabled) return;
    input.focus();
    if (target.select) {
      try { input.select(); } catch { /* number inputs can reject a selection range */ }
      return;
    }
    const end = input.value.length;
    try { input.setSelectionRange(end, end); } catch { /* keep the caret where the browser left it */ }
  }

  function nextOpen(index) {
    const homes = [...document.querySelectorAll('[data-slot="home"]')];
    const start = homes.findIndex(input => input.dataset.match === String(index));
    for (let i = start + 1; i < homes.length; i++) {
      if (!homes[i].disabled) return homes[i].dataset.match;
    }
    return null;
  }

  function stateOf(match, ready) {
    if (match[5]) return {name: 'done', label: '已确认'};
    if (ready || match[2] !== '' || match[3] !== '') return {name: 'live', label: '进行中'};
    return {name: 'idle', label: '未录入'};
  }

  function options(teams, selected) {
    return teams.map(team => '<option' + (team === selected ? ' selected' : '') + '>' + escapeHtml(team) + '</option>').join('');
  }

  function fixture(match, index, teams, locked, penalty, ready) {
    const complete = ready(match);
    const status = stateOf(match, complete);
    const lock = locked ? ' disabled' : '';
    return '<article class="fixture" data-fixture="' + index + '">'
      + '<div class="fixture-main">'
      + '<select class="team-select" data-match="' + index + '" data-side="0"' + lock + '>' + options(teams, match[0]) + '</select>'
      + '<div class="score-boxes">'
      + '<span class="score-caption">比分</span>'
      + '<input class="score-input" inputmode="numeric" aria-label="' + escapeHtml(match[0]) + '比分" data-match="' + index + '" data-score="2" data-slot="home" type="number" min="0" value="' + escapeHtml(match[2]) + '">'
      + '<input class="score-input" inputmode="numeric" aria-label="' + escapeHtml(match[1]) + '比分" data-match="' + index + '" data-score="3" data-slot="away" type="number" min="0" value="' + escapeHtml(match[3]) + '">'
      + '</div>'
      + '<select class="team-select away" data-match="' + index + '" data-side="1"' + lock + '>' + options(teams, match[1]) + '</select>'
      + '</div>'
      + penalty(match, index)
      + '<div class="fixture-footer">'
      + '<span class="match-status" data-state="' + status.name + '" role="img" aria-label="' + status.label + '"><i class="status-dot"></i></span>'
      + '<button class="confirm-result" data-confirm="' + index + '" type="button"' + (complete ? '' : ' disabled') + '>' + (match[5] ? '已确认' : '确认赛果') + '</button>'
      + '</div></article>';
  }

  function markup({matches, teams, locked, penalty, ready}) {
    const rounds = {};
    matches.forEach((match, index) => ((rounds[match[4]] ??= []).push([match, index])));
    return Object.entries(rounds).map(([round, rows]) => {
      return '<section class="round"><div class="round-title">小组赛第 ' + escapeHtml(round) + ' 轮</div>'
        + rows.map(([match, index]) => fixture(match, index, teams, locked, penalty, ready)).join('')
        + '</section>';
    }).join('');
  }

  function bindKeyboard({matchAt, ready, confirm}) {
    document.querySelectorAll('[data-score]').forEach(input => {
      input.addEventListener('keydown', event => {
        const index = input.dataset.match;
        const slot = input.dataset.slot;
        if (event.key === 'Tab' && !event.shiftKey && slot === 'home') {
          const away = field(index, 'away');
          if (away && !away.disabled) {
            event.preventDefault();
            away.focus();
          }
          return;
        }
        if (event.key === 'Tab' && event.shiftKey && slot === 'away') {
          const home = field(index, 'home');
          if (home && !home.disabled) {
            event.preventDefault();
            home.focus();
          }
          return;
        }
        if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
        event.preventDefault();
        const match = matchAt(+index);
        if (!match || !ready(match)) {
          if (!match || String(match[2]) === '') field(index, 'home')?.focus();
          else if (String(match[3]) === '') field(index, 'away')?.focus();
          else document.querySelector('[data-penalty="' + index + '"]')?.focus();
          return;
        }
        const next = nextOpen(index);
        if (next != null) queueFocus(next, 'home', true);
        else clearFocus();
        if (!confirm(+index)) clearFocus();
      });
    });
  }

  root.FixtureBoard = {markup, bindKeyboard, queueFocus, clearFocus, restoreFocus, field};
})(typeof window === 'undefined' ? globalThis : window);
