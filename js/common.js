// The Clubhouse — shared by the parent app (index.html) and the player dashboard (kid.html).
//
// Three layers:
//   1. Utilities (Supabase client, dates, escaping, toasts)
//   2. The player model: turns raw data (balance, lineup, ledger rows, stats)
//      into everything the screens show (level, streak, box score, badges…)
//   3. Components: HTML builders for the player card, lineup rows, locker
//      items, box score, trophy case, etc. Both pages render with these, so
//      they always look like one product.

const RR = (() => {
  const cfg = window.RR_CONFIG || {};
  const configured = /^https?:\/\/.+/.test(cfg.SUPABASE_URL || '') &&
    !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) && !/YOUR-/.test(cfg.SUPABASE_KEY || 'YOUR-');

  const client = configured
    ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  // ================================================================ utilities

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
  const addDays = (ymd, n) => { const [Y, M, D] = ymd.split('-').map(Number); return localDay(new Date(Y, M - 1, D + n)); };

  // Midnight at the start of this week (weeks start on Sunday).
  const weekStart = (d = new Date()) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  };
  // This week, Sunday to Saturday, as YYYY-MM-DD.
  const weekDays = () => { const s = localDay(weekStart()); return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(s, i)); };
  // The last 7 days ending today, oldest first.
  const last7 = () => [6, 5, 4, 3, 2, 1, 0].map(i => addDays(localDay(), -i));

  const dayLabel = ymd => {
    if (ymd === localDay()) return 'Today';
    if (ymd === addDays(localDay(), -1)) return 'Yesterday';
    const [Y, M, D] = ymd.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const shortDay = ymd => { const [Y, M, D] = ymd.split('-').map(Number); return new Date(Y, M - 1, D).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3); };
  const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const fmt = n => Number(n || 0).toLocaleString();
  const pct = (have, need) => need > 0 ? Math.max(0, Math.min(100, Math.round(have / need * 100))) : 100;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k) { try { return localStorage.getItem('rr.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('rr.' + k, v); } catch { /* private mode */ } }
  };

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

  // Count a big number up from its current value.
  function countTo(el, to) {
    const from = Number(el.dataset.v ?? to);
    el.dataset.v = to;
    if (from === to || reduceMotion()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 700;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  // A short burst of gold and white particles.
  function burst(n = 40) {
    if (reduceMotion()) return;
    const box = document.createElement('div');
    box.className = 'burst';
    document.body.appendChild(box);
    const colors = ['#f6c90e', '#ffdb4d', '#ffffff', '#c99a00'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.style.background = colors[i % colors.length];
      box.appendChild(s);
      const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 220;
      const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist - 80;
      s.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg) scale(.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${Math.random() * 540}deg) scale(1)`, opacity: 1, offset: .55 },
        { transform: `translate(calc(-50% + ${x * 1.15}px), calc(-50% + ${y + 240}px)) rotate(${Math.random() * 900}deg) scale(.7)`, opacity: 0 }
      ], { duration: 1300 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    }
    setTimeout(() => box.remove(), 2100);
  }

  // ================================================================ icons
  const ICONS = {
    clubhouse: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    lineup: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h6"/>',
    locker: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M8 7h1M15 7h1M8 10h1M15 10h1"/>',
    stats: '<path d="M4 20V11M10 20V5M16 20v-8M21 20H3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8 0 4 3 7 7 7z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M7.5 4.5c1.6 2 2.5 4.6 2.5 7.5s-.9 5.5-2.5 7.5M16.5 4.5c-1.6 2-2.5 4.6-2.5 7.5s.9 5.5 2.5 7.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    gift: '<path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13"/><path d="M12 8c-1.5-3-5-3.5-5-1.5S10 8 12 8zM12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6M21 20c0-2.5-1.5-4.3-4-4.8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  const brandMark = (cls = 'brand-mark') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true">
    <rect x="1" y="1" width="46" height="46" rx="12" fill="#16181c" stroke="#f6c90e" stroke-width="2"/>
    <circle cx="24" cy="24" r="12.5" fill="#f4f5f7"/>
    <path d="M16.5 14c2.8 2.6 4.3 6.1 4.3 10s-1.5 7.4-4.3 10M31.5 14c-2.8 2.6-4.3 6.1-4.3 10s1.5 7.4 4.3 10" stroke="#d6403a" stroke-width="1.7" fill="none" stroke-dasharray="2.2 1.6"/></svg>`;

  const seams = `<svg class="seams" viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="96" fill="none" stroke="#fff" stroke-width="2"/>
    <path d="M40 22c22 20 34 48 34 78s-12 58-34 78M160 22c-22 20-34 48-34 78s12 58 34 78" fill="none" stroke="#d6403a" stroke-width="3" stroke-dasharray="7 6"/></svg>`;

  // ================================================================ journal content
  const MOODS = [
    { key: 'awesome', emoji: '🔥', label: 'Fired up' },
    { key: 'good', emoji: '🙂', label: 'Good' },
    { key: 'okay', emoji: '😐', label: 'Okay' },
    { key: 'sad', emoji: '😔', label: 'Down' },
    { key: 'frustrated', emoji: '😤', label: 'Frustrated' },
    { key: 'worried', emoji: '😟', label: 'Worried' }
  ];
  const mood = key => MOODS.find(m => m.key === key) || { key, emoji: '·', label: key };

  const PROMPTS = [
    'What was the best part of your day?',
    'What made you laugh today?',
    'Who was kind to you today? Who were you kind to?',
    'What is something hard you did today?',
    'If today was a movie, what would it be called?',
    'What is one thing you learned today?',
    'What are you looking forward to tomorrow?',
    'What is something you are proud of today?',
    'Was anything frustrating today? What helped you feel better?',
    'What is one thing you would do differently today?',
    'Who did you play with today? What did you do?',
    'What made you feel happy today?',
    'What is something you are thankful for today?',
    'How did you help someone today?',
    'What is something new you tried today?',
    'What was your favorite part of practice or your last game?',
    'If you had a superpower tomorrow, what would it be and why?',
    'Is there something you want Mom and Dad to know?',
    'Rate your day from 1 to 10. Why that number?',
    'What was the hardest part of your day?',
    'What is a goal you want to work on this week?',
    'Tell us about a good choice you made today.',
    'What would make tomorrow awesome?',
    'Did anything worry you today? Tell us about it.',
    'What was the funniest thing that happened at school?',
    'Who is someone you want to say thank you to? Why?',
    'What did you do today that took courage?',
    'If you were the teacher today, what would you teach?',
    'What helped you feel calm today?',
    'How were you a good teammate or friend today?'
  ];
  // Same question all day, a different one tomorrow.
  const promptFor = ymd => {
    const [Y, M, D] = ymd.split('-').map(Number);
    return PROMPTS[Math.floor(Date.UTC(Y, M - 1, D) / 864e5) % PROMPTS.length];
  };

  // ================================================================ progression
  // Levels come from LIFETIME XP, so redeeming a prize never drops his level.
  const LEVELS = [
    { name: 'Rookie', min: 0 },
    { name: 'Prospect', min: 100 },
    { name: 'Starter', min: 300 },
    { name: 'All-Star', min: 600 },
    { name: 'MVP', min: 1200 },
    { name: 'Hall of Famer', min: 2500 }
  ];
  function levelFor(xp) {
    let i = 0;
    while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].min) i++;
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    return {
      idx: i, num: i + 1, name: cur.name, min: cur.min, next,
      toNext: next ? next.min - xp : 0,
      pct: next ? pct(xp - cur.min, next.min - cur.min) : 100
    };
  }

  const CATEGORIES = { home: 'Home & School', sports: 'On the Field' };
  const catOf = b => b.category === 'sports' ? 'sports' : 'home';

  // Trophy case. Each badge says how close he is.
  const BADGES = [
    { key: 'first', icon: 'ball', name: 'First Pitch', desc: 'Earn your first XP', need: 1, val: m => m.lifetime },
    { key: 'streak3', icon: 'flame', name: 'Hot Streak', desc: '3-day streak', need: 3, val: m => m.bestStreak },
    { key: 'streak7', icon: 'flame', name: 'Iron Man', desc: '7-day streak', need: 7, val: m => m.bestStreak },
    { key: 'tasks10', icon: 'check', name: 'Double Digits', desc: '10 tasks done', need: 10, val: m => m.tasksCompleted },
    { key: 'tasks50', icon: 'target', name: 'Grinder', desc: '50 tasks done', need: 50, val: m => m.tasksCompleted },
    { key: 'field10', icon: 'team', name: 'Team Player', desc: '10 on-field awards', need: 10, val: m => m.sportsCount },
    { key: 'prize1', icon: 'gift', name: 'Closer', desc: 'Redeem a prize', need: 1, val: m => m.redeemedCount },
    { key: 'journal7', icon: 'mic', name: 'Postgame Pro', desc: '7 interviews', need: 7, val: m => m.journalCount }
  ];

  // Longest run of consecutive days in a list of YYYY-MM-DD, and the run
  // ending today (or yesterday, so the streak isn't "lost" before he's had a chance today).
  function streaks(days) {
    const set = new Set(days);
    let cur = 0;
    let d = set.has(localDay()) ? localDay() : addDays(localDay(), -1);
    while (set.has(d)) { cur++; d = addDays(d, -1); }
    let best = 0;
    for (const day of set) {
      if (set.has(addDays(day, -1))) continue;  // not the start of a run
      let n = 0, x = day;
      while (set.has(x)) { n++; x = addDays(x, 1); }
      best = Math.max(best, n);
    }
    return { cur, best: Math.max(best, cur) };
  }

  // Everything the screens need, from one snapshot of data:
  //   { kid_name, avatar_url, jersey_number, position, balance, behaviors,
  //     rewards, recent (ledger rows, newest first), journal, journal_points,
  //     stats (career stats from the database, or null on an older database),
  //     pending ([{behavior_id, day}] or null) }
  function model(s) {
    const today = localDay();
    const recent = s.recent || [];
    const gained = r => r.points > 0 && r.kind !== 'redeem';
    const st = s.stats || null;

    const lifetime = st ? st.lifetime_xp : recent.filter(gained).reduce((a, r) => a + r.points, 0);
    const activeDays = st ? st.active_days : [...new Set(recent.filter(gained).map(r => r.day))];
    const { cur: streak, best: bestStreak } = streaks(activeDays);

    const week = weekDays();
    const wkSet = new Set(week);
    const box = Object.fromEntries(week.map(d => [d, { xp: 0, tasks: 0 }]));
    let todayXP = 0;
    for (const r of recent) {
      if (!gained(r)) continue;
      if (r.day === today) todayXP += r.points;
      if (wkSet.has(r.day)) { box[r.day].xp += r.points; if (r.kind === 'earn') box[r.day].tasks += 1; }
    }
    const weekXP = week.reduce((a, d) => a + box[d].xp, 0);
    const weekTasks = week.reduce((a, d) => a + box[d].tasks, 0);

    const pendingToday = new Set((s.pending || []).filter(p => p.day === today).map(p => p.behavior_id));
    // Home & School first, then On the Field; numbered like a batting order.
    const ordered = ['home', 'sports'].flatMap(c => (s.behaviors || []).filter(b => catOf(b) === c));
    const lineup = ordered.map((b, i) => {
      const n = recent.filter(r => r.kind === 'earn' && r.behavior_id === b.id && r.day === today).length;
      const status = b.once_daily && n > 0 ? 'done' : pendingToday.has(b.id) ? 'pending' : 'open';
      return { ...b, order: i + 1, cat: catOf(b), n, status };
    });
    const doneCount = lineup.filter(b => b.status === 'done' || (!b.once_daily && b.n > 0)).length;

    const rewards = (s.rewards || []).slice().sort((a, b) => a.cost - b.cost);
    const nextPrize = rewards.find(r => r.cost > s.balance) || null;

    const m = {
      name: s.kid_name || 'Jaylen',
      jersey: s.jersey_number || '',
      position: s.position || '',
      avatar: s.avatar_url || '',
      balance: s.balance || 0,
      lifetime, level: levelFor(lifetime),
      streak, bestStreak,
      todayXP, weekXP, weekTasks, week, box,
      tasksCompleted: st ? st.tasks_completed : recent.filter(r => r.kind === 'earn').length,
      redeemedCount: st ? st.redeemed_count : recent.filter(r => r.kind === 'redeem').length,
      sportsCount: st ? st.sports_count : 0,
      journalCount: st ? st.journal_count : (s.journal || []).length,
      lineup, doneCount, rewards, nextPrize,
      highlights: recent.filter(gained).slice(0, 5),
      recent,
      hasStats: !!st,
      canRequest: Array.isArray(s.pending)
    };
    m.badges = BADGES.map(b => ({ ...b, have: Math.min(b.val(m) || 0, b.need), earned: (b.val(m) || 0) >= b.need }));
    return m;
  }

  // ================================================================ components
  const initials = name => esc((name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());

  function playerCard(m) {
    const lv = m.level;
    const kicker = [m.jersey ? '#' + m.jersey : '', m.position].filter(Boolean).join(' · ') || 'The Clubhouse';
    return `<section class="pcard" aria-label="Player card">
      ${seams}
      ${m.jersey ? `<div class="pcard-jersey" aria-hidden="true">${esc(m.jersey)}</div>` : ''}
      <div class="pcard-top">
        <div class="pcard-photo">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : initials(m.name)}</div>
        <div class="pcard-id">
          <div class="pcard-kicker">${esc(kicker)}</div>
          <h1 class="pcard-name">${esc(m.name)}</h1>
          <div class="lvl-badge">${icon('shield')}${esc(lv.name)}</div>
        </div>
      </div>
      <div class="pcard-xp">
        <div><span class="label">XP Balance</span><b><span class="js-bal" data-v="${m.balance}">${fmt(m.balance)}</span><small>XP</small></b></div>
        <div class="life"><span class="label">Lifetime XP</span><b>${fmt(m.lifetime)}</b></div>
      </div>
      <div class="lvl-progress">
        <div class="lvl-row"><span>Level ${lv.num} · <b>${esc(lv.name)}</b></span>
          <span>${lv.next ? `${fmt(lv.toNext)} XP to ${esc(lv.next.name)}` : 'Max level'}</span></div>
        <div class="meter"><i style="width:${lv.pct}%"></i></div>
      </div>
    </section>`;
  }

  const statTile = (label, value, unit = '', ic = '', hot = false) =>
    `<div class="stat${hot ? ' hot' : ''}">${ic ? icon(ic) : ''}<span class="label">${label}</span><b>${value}${unit ? `<small>${unit}</small>` : ''}</b></div>`;

  function statGrid(m, full = false) {
    const tiles = [
      statTile('XP this week', fmt(m.weekXP), 'XP', 'bolt'),
      statTile('Tasks this week', fmt(m.weekTasks), '', 'check'),
      statTile('Current streak', m.streak, m.streak === 1 ? 'day' : 'days', 'flame', m.streak >= 3),
      statTile('Prizes redeemed', fmt(m.redeemedCount), '', 'gift')
    ];
    if (full) tiles.push(statTile('Lifetime XP', fmt(m.lifetime), 'XP', 'star'), statTile('Best streak', m.bestStreak, m.bestStreak === 1 ? 'day' : 'days', 'trophy'));
    return `<div class="stats">${tiles.join('')}</div>`;
  }

  const STATUS = {
    done: `<span class="status done">${icon('check')}Completed</span>`,
    pending: `<span class="status pending">${icon('clock')}Pending Approval</span>`,
    open: '<span class="status open">Available</span>'
  };

  // mode 'parent': the whole row is a button that awards XP.
  // mode 'kid':    an "I did it" button sends it for approval.
  // showCat: print the category (left off inside a section that already names it).
  function lineupRow(b, mode, showCat = false) {
    const canAct = b.status === 'open' && mode === 'kid-can-request';
    const sub = [showCat ? `<span class="${b.cat === 'sports' ? 'field' : ''}">${CATEGORIES[b.cat]}</span>` : '',
      b.once_daily ? 'Once a day' : b.n ? `Earned ×${b.n} today` : 'Any time'].filter(Boolean).join(' · ');
    const no = b.status === 'done' ? icon('check', 'sm') : b.order;
    const inner = `<span class="lu-no">${no}</span>
      <span class="lu-main"><span class="lu-name">${esc(b.name)}</span>
        <span class="lu-meta">${canAct ? '' : STATUS[b.status]}<span class="lu-sub">${sub}</span></span></span>`;
    if (mode === 'parent') {
      return `<button class="lu ${b.status}" data-award="${b.id}" aria-label="Award ${b.points} XP for ${esc(b.name)}">${inner}
        <span class="lu-side"><span class="xp">+${b.points}<small>XP</small></span></span></button>`;
    }
    const act = canAct ? `<button class="lu-act" data-request="${b.id}">I did it</button>` : '';
    return `<div class="lu ${b.status}">${inner}<span class="lu-side"><span class="xp">+${b.points}<small>XP</small></span>${act}</span></div>`;
  }

  function lineupSummary(m) {
    const total = m.lineup.length;
    return `<div class="summary-bar"><div class="meter${total && m.doneCount >= total ? ' full' : ''}"><i style="width:${pct(m.doneCount, total)}%"></i></div>
      <b>${m.doneCount}<small> / ${total}</small></b></div>`;
  }

  function lineupGroups(m, mode) {
    if (!m.lineup.length) return '<div class="panel empty">The lineup is empty.</div>';
    return ['home', 'sports'].map(cat => {
      const items = m.lineup.filter(b => b.cat === cat);
      if (!items.length) return '';
      const done = items.filter(b => b.status === 'done' || (!b.once_daily && b.n > 0)).length;
      return `<div class="group-head"><span>${CATEGORIES[cat]}</span><span>${done}/${items.length}</span></div>
        <div class="lineup">${items.map(b => lineupRow(b, mode)).join('')}</div>`;
    }).join('');
  }

  const shot = (r, cls = 'shot') => `<div class="${cls}">${r && r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy">` : icon('gift')}</div>`;

  // mode 'parent' adds Redeem + edit; 'kid' is view-only.
  function lockerItem(r, balance, mode) {
    const ready = balance >= r.cost;
    const left = ready ? (mode === 'parent' ? 'Ready to redeem' : 'Unlocked · ask a parent') : `${fmt(r.cost - balance)} XP to go`;
    return `<article class="item ${ready ? 'unlocked' : 'locked'}">
      ${shot(r)}
      <span class="lockmark">${icon(ready ? 'unlock' : 'lock')}${ready ? 'Unlocked' : 'Locked'}</span>
      ${mode === 'parent' ? `<button class="edit" data-edit-prize="${r.id}" aria-label="Edit ${esc(r.name)}">${icon('edit', 'sm')}</button>` : ''}
      <div class="body">
        <div class="nm">${esc(r.name)}</div>
        <div class="row"><span class="cost">${fmt(r.cost)}<small>XP</small></span><span class="left">${left}</span></div>
        <div class="meter thin${ready ? ' full' : ''}"><i style="width:${pct(balance, r.cost)}%"></i></div>
        <span class="grow"></span>
        ${mode === 'parent' ? `<button class="btn sm block ${ready ? '' : 'dark'}" data-redeem="${r.id}" ${ready ? '' : 'disabled'}>Redeem</button>` : ''}
      </div></article>`;
  }

  function nextUnlock(m) {
    const r = m.nextPrize;
    if (!r) {
      return `<div class="panel"><span class="label">Next unlock</span><p style="margin:8px 0 0">${m.rewards.length
        ? 'Every prize in the locker is unlocked. Time to cash in.' : 'No prizes in the locker yet.'}</p></div>`;
    }
    return `<div class="panel unlock">
      ${shot(r)}
      <div><span class="label">Next unlock</span>
        <h4>${esc(r.name)}</h4>
        <div class="cost">${fmt(r.cost)}<small>XP</small></div>
        <div class="meter"><i style="width:${pct(m.balance, r.cost)}%"></i></div>
        <p><b>${fmt(r.cost - m.balance)} XP</b> to go</p></div></div>`;
  }

  const rowMark = r => r.kind === 'redeem' ? `<span class="mark redeem">${icon('gift', 'sm')}</span>`
    : r.kind === 'journal' ? `<span class="mark journal">${icon('mic', 'sm')}</span>`
    : r.kind === 'adjust' ? `<span class="mark">${icon('star', 'sm')}</span>`
    : `<span class="mark">${icon('bolt', 'sm')}</span>`;
  const rowDelta = r => `<span class="delta ${r.kind === 'redeem' ? 'redeem' : r.points > 0 ? 'plus' : 'minus'}">${signed(r.points)}</span>`;
  const rowLabel = r => r.kind === 'redeem' ? 'Redeemed: ' + r.reason : r.kind === 'adjust' && r.points > 0 ? 'Bonus: ' + r.reason : r.reason;

  function highlights(m) {
    if (!m.highlights.length) return '<div class="panel empty">Highlights show up here as XP comes in.</div>';
    return `<div class="panel"><ul class="list">${m.highlights.map(r => `<li>${rowMark(r)}
      <span class="grow"><b>${esc(rowLabel(r))}</b><small>${dayLabel(r.day)} · ${timeOf(r.created_at)}</small></span>${rowDelta(r)}</li>`).join('')}</ul></div>`;
  }

  function boxScore(m) {
    const today = localDay();
    const cls = d => d === today ? 'today' : d > today ? 'future' : '';
    const cell = (d, v) => `<td class="${cls(d)}">${d > today ? '–' : v}</td>`;
    return `<div class="panel" style="padding:12px 14px"><table class="box">
      <thead><tr><th></th>${m.week.map(d => `<th class="${cls(d)}">${d === today ? 'Tod' : shortDay(d)}</th>`).join('')}<th class="tot">Tot</th></tr></thead>
      <tbody>
        <tr><td>XP</td>${m.week.map(d => cell(d, m.box[d].xp)).join('')}<td class="tot">${fmt(m.weekXP)}</td></tr>
        <tr><td>Tasks</td>${m.week.map(d => cell(d, m.box[d].tasks)).join('')}<td class="tot">${m.weekTasks}</td></tr>
      </tbody></table></div>`;
  }

  function trophyCase(m) {
    return `<div class="panel"><div class="trophies">${m.badges.map(b => `<div class="trophy ${b.earned ? 'earned' : 'locked'}">
      <div class="medal">${icon(b.earned ? b.icon : 'lock')}</div><b>${esc(b.name)}</b>
      <small>${b.earned ? esc(b.desc) : `${b.have}/${b.need} · ${esc(b.desc)}`}</small></div>`).join('')}</div></div>`;
  }

  function ladder(m) {
    return `<div class="panel ladder">${LEVELS.map((l, i) => `<div class="rung${i <= m.level.idx ? ' reached' : ''}${i === m.level.idx ? ' current' : ''}">
      <span class="dot"></span><b>${esc(l.name)}</b><span>${fmt(l.min)} XP</span></div>`).join('')}</div>`;
  }

  function gameLogRows(rows, opts = {}) {
    if (!rows.length) return '<p class="empty">No games logged yet.</p>';
    let html = '', day = null;
    for (const r of rows) {
      if (r.day !== day) {
        if (day !== null) html += '</ul>';
        day = r.day;
        const net = rows.filter(x => x.day === day && x.points > 0 && x.kind !== 'redeem').reduce((a, x) => a + x.points, 0);
        html += `<div class="day-head"><span>${dayLabel(day)}</span><span>+${net} XP</span></div><ul class="list">`;
      }
      const by = opts.who && r.created_by ? ' · ' + esc(r.created_by.split('@')[0]) : '';
      html += `<li>${rowMark(r)}<span class="grow"><b>${esc(rowLabel(r))}</b><small>${timeOf(r.created_at)}${by}</small></span>${rowDelta(r)}
        ${opts.remove ? `<button class="icon-btn" data-del-row="${r.id}" aria-label="Remove entry">${icon('trash', 'sm')}</button>` : ''}</li>`;
    }
    return html + '</ul>';
  }

  function moodWeek(journal) {
    const byDay = Object.fromEntries((journal || []).map(j => [j.day, j]));
    const today = localDay();
    return `<div class="mood-week">${last7().map(d => `<div class="${d === today ? 'today' : ''}">
      <span class="m">${byDay[d] ? mood(byDay[d].mood).emoji : '–'}</span><span class="d">${d === today ? 'Tod' : shortDay(d)}</span></div>`).join('')}</div>`;
  }

  // ----- Celebration overlay (one at a time, queued)
  const queue = [];
  function celebrate(c) { queue.push(c); if (!$('.overlay')) showNext(); }
  function showNext() {
    const c = queue.shift();
    if (!c) return;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const art = c.image ? `<div class="ov-art shot"><img src="${esc(c.image)}" alt=""></div>`
      : c.medal ? `<div class="ov-art medal-art"><div class="medal">${icon(c.medal)}</div></div>` : '';
    ov.innerHTML = `<div class="ov-card"><div class="ov-kicker">${esc(c.kicker)}</div>${art}
      <div class="ov-title">${esc(c.title)}</div>${c.body ? `<div class="ov-body">${esc(c.body)}</div>` : ''}
      <button class="btn block" data-ok>${esc(c.ok || 'Let’s go')}</button></div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-ok]').addEventListener('click', () => { ov.remove(); showNext(); });
    burst(c.big ? 70 : 34);
  }

  return {
    client, configured, esc, $, $$, localDay, addDays, weekStart, weekDays, last7, dayLabel, shortDay, timeOf, signed, fmt, pct,
    store, toast, countTo, burst, icon, brandMark,
    MOODS, mood, promptFor, LEVELS, levelFor, CATEGORIES, catOf, model,
    playerCard, statGrid, lineupRow, lineupSummary, lineupGroups, lockerItem, nextUnlock, highlights, boxScore, trophyCase, ladder,
    gameLogRows, moodWeek, shot, celebrate
  };
})();
