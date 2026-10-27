// Helpers shared by the parent app (index.html) and Jaylen's dashboard (kid.html).

const RR = (() => {
  const cfg = window.RR_CONFIG || {};
  const configured = /^https?:\/\/.+/.test(cfg.SUPABASE_URL || '') &&
    !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) && !/YOUR-/.test(cfg.SUPABASE_KEY || 'YOUR-');

  const client = configured
    ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  // Escape text before putting it into innerHTML.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // The family's calendar date (this phone's time zone) as YYYY-MM-DD.
  const localDay = (d = new Date()) => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };

  // Midnight at the start of this week (weeks start on Sunday).
  const weekStart = (d = new Date()) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  };

  // The last 7 days ending today, oldest first, as YYYY-MM-DD.
  const last7 = () => {
    const out = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(localDay(d)); }
    return out;
  };

  const dayLabel = ymd => {
    if (ymd === localDay()) return 'Today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (ymd === localDay(y)) return 'Yesterday';
    const [Y, M, D] = ymd.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const shortDay = ymd => { const [Y, M, D] = ymd.split('-').map(Number); return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3); };
  const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

  // Stats from ledger rows: points earned today / this week, and daily totals.
  function stats(rows) {
    const today = localDay();
    const wk = weekStart().getTime();
    const days = last7();
    const perDay = Object.fromEntries(days.map(d => [d, 0]));
    let todayPts = 0, weekPts = 0, weekLost = 0, weekRedeemed = 0;
    for (const r of rows) {
      const inWeek = new Date(r.created_at).getTime() >= wk;
      const gained = r.points > 0;
      if (gained && r.day === today) todayPts += r.points;
      if (gained && r.day in perDay) perDay[r.day] += r.points;
      if (inWeek) {
        if (gained) weekPts += r.points;
        else if (r.kind === 'redeem') weekRedeemed += 1;
        else weekLost += -r.points;
      }
    }
    return { todayPts, weekPts, weekLost, weekRedeemed, perDay, days };
  }

  // The cheapest prize he can't afford yet (or null if he can afford them all).
  function nextPrize(rewards, balance) {
    return rewards.filter(r => r.cost > balance).sort((a, b) => a.cost - b.cost)[0] || null;
  }

  function pct(balance, cost) { return Math.max(0, Math.min(100, Math.round(balance / cost * 100))); }

  // ----- Toasts -----
  function toast(msg, opts = {}) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast' + (opts.warn ? ' warn' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="msg"></span>';
    el.querySelector('.msg').textContent = msg;
    if (opts.action) {
      const b = document.createElement('button');
      b.textContent = opts.action.label;
      b.onclick = () => { el.remove(); opts.action.run(); };
      el.appendChild(b);
    }
    box.appendChild(el);
    setTimeout(() => el.remove(), opts.ms || (opts.action ? 7000 : 3200));
  }

  // ----- Confetti burst -----
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function confetti(items = ['⭐', '🚀', '✨', '🌟', '💫', '🪐'], n = 36) {
    if (reduceMotion()) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    document.body.appendChild(box);
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.textContent = items[i % items.length];
      box.appendChild(s);
      const ang = Math.random() * Math.PI * 2;
      const dist = 140 + Math.random() * 260;
      const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist - 120;
      s.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1.1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: .6 },
        { transform: `translate(calc(-50% + ${x * 1.1}px), calc(-50% + ${y + 260}px)) scale(.8) rotate(${Math.random() * 720}deg)`, opacity: 0 }
      ], { duration: 1400 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    }
    setTimeout(() => box.remove(), 2200);
  }

  function starfield() {
    const box = document.createElement('div');
    box.className = 'stars';
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i');
      const size = Math.random() < .15 ? 3 : 2;
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-delay:${(Math.random() * 3).toFixed(2)}s`;
      box.appendChild(s);
    }
    document.body.prepend(box);
  }

  // Count a number up from its current value (for big point displays).
  function countTo(el, to) {
    const from = Number(el.dataset.v ?? to);
    el.dataset.v = to;
    if (from === to || reduceMotion()) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 700;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  return { client, configured, esc, $, $$, localDay, weekStart, last7, dayLabel, shortDay, timeOf, signed, stats, nextPrize, pct, toast, confetti, starfield, countTo };
})();
