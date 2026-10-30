// Cursor and image trail on the sign-in page. Everything is drawn from training-data vocabulary; no images loaded.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, fine = matchMedia('(pointer:fine)').matches;
  const cur = document.querySelector('.cur'); if (!cur) return;
  let cx = innerWidth / 2, cy = innerHeight / 2, rx = cx, ry = cy, started = false;
  if (fine && !reduce) {
    addEventListener('pointermove', (e) => { cx = e.clientX; cy = e.clientY; if (!started) { started = true; document.body.classList.add('cursor-on'); rx = cx; ry = cy; }
      const typing = !!e.target.closest('input,select,textarea'); document.body.classList.toggle('cursor-on', !typing); cur.classList.toggle('big', !typing && !!e.target.closest('a,button,label')); }, { passive: true });
    document.addEventListener('mouseleave', () => document.body.classList.remove('cursor-on'));
    (function loop() { rx += (cx - rx) * .22; ry += (cy - ry) * .22; cur.style.transform = `translate(${rx}px,${ry}px)`; cur.querySelector('.dot').style.transform = `translate(${cx - rx}px,${cy - ry}px)`; requestAnimationFrame(loop); })();
  }
  const hero = document.getElementById('hero'), trail = hero && hero.querySelector('.trail'); if (!hero || !trail) return;
  const rnd = (a, b) => a + Math.random() * (b - a), txt = (t) => `<text x="10" y="18" font-family="Archivo,sans-serif" font-size="10" font-weight="700" fill="var(--ink2)">${t}</text>`;
  const designs = [
    () => { let d = 'M0 52', x = 0; while (x < 150) { const w = rnd(26, 40); d += ` L${x + w * .35} 52 L${x + w * .45} ${rnd(20, 34)} L${x + w * .55} ${rnd(70, 84)} L${x + w * .65} 52 L${x + w} 52`; x += w; } return `<path d="${d}" fill="none" stroke="var(--pulse)" stroke-width="2.5" stroke-linejoin="round"/>${txt(Math.round(rnd(112, 168)) + ' bpm')}`; },
    () => { let r = ''; for (let i = 0; i < 7; i++) { const h = rnd(18, 72); r += `<rect x="${12 + i * 19}" y="${90 - h}" width="12" height="${h}" rx="3" fill="${i === 5 ? 'var(--pulse)' : 'var(--ink2)'}" opacity="${i === 5 ? 1 : .55}"/>`; } return r + txt((Math.round(rnd(4, 9)) * 1000).toLocaleString() + ' kg'); },
    () => `<path d="M14 ${rnd(60, 90)} C ${rnd(30, 60)} ${rnd(10, 90)}, ${rnd(60, 90)} ${rnd(10, 90)}, ${rnd(90, 110)} ${rnd(30, 70)} S ${rnd(120, 140)} ${rnd(10, 90)}, 138 ${rnd(20, 80)}" fill="none" stroke="#D9860B" stroke-width="4" stroke-linecap="round"/>${txt(rnd(4, 11).toFixed(1) + ' km')}`,
    () => { const segs = [['#6E46D9', rnd(14, 26)], ['#2456D6', rnd(18, 30)], ['var(--ink2)', rnd(30, 50)], ['#D9860B', rnd(4, 10)]]; let x = 10, r = ''; segs.forEach(([c, w]) => { r += `<rect x="${x}" y="54" width="${w * 1.3}" height="22" rx="4" fill="${c}"/>`; x += w * 1.3 + 3; }); return r + txt(rnd(5.5, 8.2).toFixed(1) + ' h · score ' + Math.round(rnd(62, 92))); },
    () => { const v = rnd(.3, .95), r = 34, c = 2 * Math.PI * r; return `<circle cx="75" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="75" cy="60" r="${r}" fill="none" stroke="${v < .5 ? '#D9860B' : 'var(--pulse)'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v} ${c}" transform="rotate(-90 75 60)"/><text x="75" y="66" text-anchor="middle" font-family="Archivo,sans-serif" font-size="18" font-weight="800" fill="var(--ink)">${Math.round(v * 100)}</text>${txt('readiness')}`; },
    () => { let d = 'M0 60'; for (let x = 0; x <= 150; x += 10) d += ` L${x} ${60 + Math.sin(x / 12) * 16}`; return `<path d="${d}" fill="none" stroke="#2456D6" stroke-width="2.5" stroke-linecap="round"/>${txt('SpO2 ' + rnd(94.5, 98.5).toFixed(1) + '% · ' + rnd(13, 16.5).toFixed(1) + ' br/min')}`; },
  ];
  let di = 0, lastX = null, lastY = null, live = 0;
  const spawn = (x, y) => { if (live > 14) return; const el = document.createElement('div'); el.className = 'frame'; el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.setProperty('--r', rnd(-14, 14).toFixed(1) + 'deg');
    el.innerHTML = `<svg viewBox="0 0 150 104" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="104" fill="var(--panel)"/>${designs[di++ % designs.length]()}</svg>`; trail.append(el); live++; el.addEventListener('animationend', () => { el.remove(); live--; }); };
  if (reduce) return;
  if (fine) hero.addEventListener('pointermove', (e) => { const b = hero.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; const overCopy = !!e.target.closest('.copy'); const g = hero.querySelector('.grid'); g.style.setProperty('--mx', (x / b.width * 100) + '%'); g.style.setProperty('--my', (y / b.height * 100) + '%');
    if (!overCopy && (lastX === null || Math.hypot(x - lastX, y - lastY) > 90)) { spawn(x, y); lastX = x; lastY = y; } }, { passive: true });
  else { const ht = document.querySelector('.hint-text'); if (ht) ht.textContent = 'Your data, drifting through'; let t = 0; const auto = () => { if (hero.offsetParent === null) return setTimeout(auto, 1500); const b = hero.getBoundingClientRect(); spawn(b.width * (.15 + .7 * Math.abs(Math.sin(t * .7))), b.height * (.1 + .55 * Math.abs(Math.cos(t * .9)))); t++; setTimeout(auto, 650); }; setTimeout(auto, 500); }
})();
