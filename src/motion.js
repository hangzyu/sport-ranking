/* Pointer light and glass highlight. Skipped when the user prefers reduced motion. */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const light = document.createElement('div');
  light.className = 'cursor-light';
  light.setAttribute('aria-hidden', 'true');
  document.body.append(light);
  const hosts = 'header, .card, .round, .plan-card, .member-row, dialog';
  let x = innerWidth / 2;
  let y = innerHeight / 2;
  let tx = x;
  let ty = y;
  let frame = 0;
  const tick = () => {
    x += (tx - x) * 0.28;
    y += (ty - y) * 0.28;
    light.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    frame = Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5 ? requestAnimationFrame(tick) : 0;
  };
  addEventListener('pointermove', event => {
    tx = event.clientX;
    ty = event.clientY;
    light.classList.add('is-on');
    const host = event.target.closest?.(hosts);
    if (host) {
      const rect = host.getBoundingClientRect();
      host.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      host.style.setProperty('--my', `${event.clientY - rect.top}px`);
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }, {passive: true});
  document.documentElement.addEventListener('pointerleave', () => light.classList.remove('is-on'));
})();
