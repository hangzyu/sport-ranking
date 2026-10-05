/* Top bar: one solid primary action, secondary actions as ghosts, backups in a menu. */
(function (root) {
  function byId(id) {
    return document.getElementById(id);
  }

  function mount() {
    const actions = document.querySelector('.header-actions');
    if (!actions || byId('moreActions')) return;
    if (!byId('membershipEntry')) {
      const entry = document.createElement('button');
      entry.className = 'secondary';
      entry.id = 'membershipEntry';
      entry.type = 'button';
      entry.dataset.view = 'membership';
      entry.textContent = '会员中心';
      actions.append(entry);
    }
    byId('publish')?.classList.remove('secondary');
    ['save', 'exportEvent', 'importEvent', 'installRanking', 'eventManager', 'accountEntry', 'membershipEntry', 'publicPreview'].forEach(id => {
      byId(id)?.classList.add('secondary');
    });
    actions.insertAdjacentHTML('beforeend', '<div class="more-menu" id="moreMenu"><button class="secondary" id="moreActions" type="button" aria-haspopup="menu" aria-expanded="false">更多操作</button><div class="more-panel" id="morePanel" role="menu" hidden></div></div>');
    const panel = byId('morePanel');
    const more = byId('moreActions');
    ['save', 'exportEvent', 'importEvent'].forEach(id => {
      const el = byId(id);
      if (el) panel.append(el);
    });
    ['statusBadge', 'installRanking', 'eventManager', 'accountEntry', 'membershipEntry', 'publicPreview', 'localSaveStatus', 'moreMenu', 'publish', 'importEventFile'].forEach(id => {
      const el = byId(id);
      if (el) actions.append(el);
    });
    const close = () => {
      panel.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    };
    more.onclick = event => {
      event.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    };
    panel.addEventListener('click', event => {
      if (event.target.closest('button')) close();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#moreMenu')) close();
    });
  }

  root.HeaderBar = {mount};
})(typeof window === 'undefined' ? globalThis : window);
