// X1 Simulator Bridge product page: small progressive enhancements only.
// Everything on the page works without this file.
'use strict';

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  const menuBtn = $('.menu-btn');
  const menu = $('#mobile-menu');
  if (menuBtn && menu) {
    const set = (open) => {
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    menuBtn.addEventListener('click', () => set(menu.hidden));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  // Tabs: "How it works" mode and the quick-start panels
  const tabs = (group, onPick) => {
    const buttons = $$('button[role="tab"]', group);
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      onPick(b);
    }));
    group.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      next.click();
    });
  };
  const how = $('.how');
  if (how) tabs($('.seg', how), (b) => { how.dataset.mode = b.dataset.how; });
  const qs = $('.qs');
  if (qs) tabs($('.seg', qs), (b) => $$('.qs-panel', qs).forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.qs; }));

  // Copy buttons
  $$('.copy').forEach((btn) => btn.addEventListener('click', async () => {
    const text = btn.parentElement.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
  }));

  // Coin ticker: a second copy of the row makes the loop seamless
  const track = $('.ticker-track');
  const row = track && $('.ticker-row', track);
  if (row && !REDUCED) {
    const rows = document.createElement('div');
    rows.className = 'ticker-rows';
    const copy = row.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    row.replaceWith(rows);
    rows.append(row, copy);
    track.classList.add('marquee');
  }

  // Hero scene: SMIL packets stop for people who prefer less motion
  const scene = $('.scene');
  if (scene && REDUCED && scene.pauseAnimations) scene.pauseAnimations();

  // Reveal on scroll, only for what starts below the fold (no flash, no hidden content without JS)
  if (!REDUCED && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.remove('pre');
      io.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    const fold = window.innerHeight;
    $$('.reveal').forEach((el, i) => {
      if (el.getBoundingClientRect().top < fold) return;
      el.classList.add('pre');
      el.style.setProperty('transition-delay', `${(i % 3) * 70}ms`);
      io.observe(el);
    });
  }

  // Count up the proof numbers once they are visible
  if (!REDUCED && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const end = Number(e.target.dataset.count);
      const t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 1100);
        e.target.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), { threshold: 0.6 });
    $$('[data-count]').forEach((el) => io.observe(el));
  }

  // Highlight the section in view in the nav
  const links = $$('.nav-links a');
  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }), { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  }
})();
