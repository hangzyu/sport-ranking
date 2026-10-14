/* Slim single-row header: ghost links, flat tools, primary publish, capsule account. */
(function (root) {
  function byId(id) {
    return document.getElementById(id);
  }

  function mount() {
    const actions = document.querySelector('.header-actions');
    if (!actions || actions.dataset.headerBarMounted === '1') return;
    actions.dataset.headerBarMounted = '1';

    if (!byId('membershipEntry')) {
      const entry = document.createElement('button');
      entry.className = 'nav-ghost';
      entry.id = 'membershipEntry';
      entry.type = 'button';
      entry.dataset.view = 'membership';
      entry.textContent = '会员中心';
      actions.append(entry);
    }

    byId('eventManager')?.classList.add('nav-ghost');
    byId('eventManager')?.classList.remove('secondary');
    byId('membershipEntry')?.classList.add('nav-ghost');
    byId('membershipEntry')?.classList.remove('secondary');
    byId('accountEntry')?.classList.add('account-capsule');
    byId('accountEntry')?.classList.remove('secondary');
    byId('publish')?.classList.add('nav-primary');
    byId('publish')?.classList.remove('secondary');

    ['installRanking', 'save', 'exportEvent', 'importEvent'].forEach(id => {
      const el = byId(id);
      if (!el) return;
      el.classList.add('nav-tool');
      el.classList.remove('secondary');
    });

    byId('moreMenu')?.remove();
    byId('moreActions')?.remove();
    byId('morePanel')?.remove();
    byId('publicPreview')?.remove();

    const saveStatus = byId('localSaveStatus');
    if (saveStatus) {
      saveStatus.hidden = true;
      saveStatus.classList.add('sr-only');
      document.body.append(saveStatus);
    }

    [
      'statusBadge',
      'eventManager',
      'membershipEntry',
      'installRanking',
      'save',
      'exportEvent',
      'importEvent',
      'publish',
      'accountEntry',
      'importEventFile'
    ].forEach(id => {
      const el = byId(id);
      if (el) actions.append(el);
    });
  }

  root.HeaderBar = {mount};
})(typeof window === 'undefined' ? globalThis : window);
