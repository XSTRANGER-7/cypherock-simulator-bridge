// X1 Simulator Bridge product page: small progressive enhancements only.
// Everything on the page works without this file.
'use strict';

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IO = 'IntersectionObserver' in window;
  const onView = (els, fn, opts = { threshold: 0.35 }) => {
    if (!IO) return els.forEach(fn);
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      fn(e.target);
    }), opts);
    els.forEach((el) => io.observe(el));
  };

  // Copy button on the run-it terminal
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

  if (REDUCED) return;

  // The 64-byte frames light up byte by byte when they come into view
  $$('.bytes').forEach((grid) => $$('i', grid).forEach((cell, n) => cell.style.setProperty('--n', String(n))));
  onView($$('.bytes'), (grid) => grid.classList.add('scan'));

  // Reveal on scroll, only for what starts below the fold (no flash, nothing hidden without JS)
  if (IO) {
    const fold = window.innerHeight;
    const later = $$('.reveal').filter((el) => el.getBoundingClientRect().top >= fold);
    later.forEach((el) => el.classList.add('pre'));
    onView(later, (el) => el.classList.remove('pre'), { rootMargin: '0px 0px -8% 0px' });
  }

  // Count up the proof numbers
  onView($$('[data-count]'), (el) => {
    const end = Number(el.dataset.count);
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.6 });

  // Highlight the section in view in the nav
  const links = $$('.nav-links a');
  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if (IO && sections.length) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }), { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  }
})();
