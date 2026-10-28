// The Clubhouse — the parent app (index.html).
//
// Everything lives in Supabase (see supabase/setup.sql). Both parents read and
// write the same tables; a realtime subscription reloads this phone whenever
// the other phone (or Jaylen's dashboard) changes something.

(() => {
  const { client: db, esc, $, $$, localDay, toast, burst, icon, fmt, store } = RR;

  const HISTORY_DAYS = 35;   // loaded up front; older entries via "Load older"
  const REPEAT_WARN_MS = 90 * 1000;
  const QUICK_REPLIES = ['Proud of you.', 'Love you, buddy.', 'Thanks for telling us.', 'Let’s talk about it tonight.', 'That’s the effort we want to see.'];
  const BONUS_REASONS = ['Extra effort', 'Great attitude', 'Above and beyond', 'Helped a teammate', 'Clutch moment'];

  const state = {
    user: null,
    settings: null,
    behaviors: [],
    rewards: [],
    ledger: [],          // newest first
    redeemed: [],
    journal: [],         // newest day first
    requests: [],        // "I did it" check-ins from his dashboard
    stats: null,         // career stats (lifetime XP etc.)
    activity: [],        // what Jaylen did (check-ins, interviews), newest first
    activityMissing: false,
    notif: null,         // my email setting + email status
    journalMissing: false,
    clubMissing: false,  // true until supabase/add-clubhouse.sql has been run
    balance: 0,
    tab: 'clubhouse',
    prevTab: 'clubhouse',
    filter: 'all',
    logLimit: 15,       // game log rows shown; "Show more" raises it
    olderDone: false
  };

  // ---------------------------------------------------------------- chrome
  $$('.js-mark').forEach(el => { el.outerHTML = RR.brandMark(el.closest('.topbar') ? 'brand-mark' : 'hero-mark'); });
  const label = (sel, ic, text) => { const el = $(sel); if (el) el.innerHTML = icon(ic) + `<span>${text}</span>`; };
  label('#nav-clubhouse', 'clubhouse', 'Clubhouse');
  label('#nav-lineup', 'lineup', 'Lineup');
  label('#nav-locker', 'locker', 'Prize Locker');
  label('#nav-stats', 'stats', 'Stats');
  $('#nav-stats').insertAdjacentHTML('beforeend', '<i class="dot" id="stats-dot" hidden></i>');
  $('#btn-manage').innerHTML = icon('gear');
  label('#btn-bonus', 'plus', 'Bonus XP');
  label('[data-manage="lineup"]', 'edit', 'Edit lineup');
  label('#btn-add-prize', 'plus', 'Add prize');
  label('#btn-add-behavior', 'plus', 'Add to lineup');
  const avatarInput = $('#avatar-file');
  label('#avatar-pick', 'camera', 'Player photo');
  $('#avatar-pick').prepend(avatarInput);
  label('#copy-kid-link', 'copy', 'Copy');
  label('#open-kid-link', 'eye', 'Open');
  label('#new-kid-link', 'refresh', 'New link');
  label('#change-pw', 'key', 'Change password');
  label('#signout', 'logout', 'Sign out');
  $('#manage-back').innerHTML = icon('back', 'sm') + 'Back';

  // ---------------------------------------------------------------- screens
  function show(id) {
    $$('body > section.screen, #screen-app').forEach(el => { el.hidden = el.id !== id; });
  }

  if (!RR.configured) { show('screen-config'); return; }

  // ---------------------------------------------------------------- auth
  let started = false;
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { show('screen-reset'); return; }
    // Run outside the auth callback (supabase-js recommends not awaiting in it).
    setTimeout(() => onSession(session), 0);
  });

  async function onSession(session) {
    if ($('#screen-reset').hidden === false) return;
    if (!session) { started = false; state.user = null; show('screen-login'); return; }
    if (started && state.user && state.user.id === session.user.id) return;
    state.user = session.user;
    const { data: ok, error } = await db.rpc('is_parent');
    if (error) { show('screen-login'); $('#login-err').textContent = friendly(error); return; }
    if (!ok) { $('#denied-email').textContent = session.user.email; show('screen-denied'); return; }
    started = true;
    show('screen-app');
    $('#who').textContent = 'Signed in as ' + session.user.email;
    await loadAll();
    subscribe();
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    $('#login-err').textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false; btn.textContent = 'Parent sign in';
    if (error) $('#login-err').textContent = /invalid/i.test(error.message) ? 'That email or password is not right.' : error.message;
  });

  $('#forgot').addEventListener('click', async () => {
    const email = $('#login-form').email.value.trim();
    if (!email) { $('#login-err').textContent = 'Type your email above first, then tap "Forgot password?".'; return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $('#login-err').textContent = '';
    toast(error ? error.message : 'Check your email for a reset link.', { warn: !!error, ms: 6000 });
  });

  $('#reset-form').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: e.target.password.value });
    if (error) { $('#reset-err').textContent = error.message; return; }
    toast('Password saved');
    $('#screen-reset').hidden = true;
    const { data } = await db.auth.getSession();
    onSession(data.session);
  });

  document.addEventListener('click', async e => {
    if (!e.target.closest('[data-signout]')) return;
    await db.auth.signOut();
    location.reload();
  });

  $('#change-pw').addEventListener('click', () => {
    const s = sheet(`<h3>Change password</h3>
      <label class="field"><span class="label">New password (8+ characters)</span><input class="input" type="password" name="pw" minlength="8" autocomplete="new-password"></label>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>`);
    s.on('[data-save]', async () => {
      const pw = s.el.querySelector('[name=pw]').value;
      if (pw.length < 8) { s.err('Use at least 8 characters.'); return; }
      const { error } = await db.auth.updateUser({ password: pw });
      if (error) { s.err(error.message); return; }
      s.close(); toast('Password changed');
    });
  });

  // ---------------------------------------------------------------- data
  function friendly(error) {
    const m = (error && error.message) || String(error);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No internet connection. Try again in a moment.';
    return m;
  }

  async function loadAll() {
    const since = new Date(); since.setDate(since.getDate() - HISTORY_DAYS);
    const [s, b, r, l, bal, red, jr, ps, rq, ac, nt] = await Promise.all([
      db.from('settings').select('*').eq('id', 1).maybeSingle(),
      db.from('behaviors').select('*').order('sort').order('created_at'),
      db.from('rewards').select('*').order('cost').order('sort'),
      db.from('ledger').select('*').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(1000),
      db.rpc('balance'),
      db.from('ledger').select('*').eq('kind', 'redeem').order('created_at', { ascending: false }).limit(50),
      db.from('journal').select('*').order('day', { ascending: false }).limit(60),
      db.rpc('player_stats'),
      db.from('lineup_requests').select('*').order('created_at'),
      db.from('activity').select('*').order('created_at', { ascending: false }).limit(40),
      db.rpc('my_notifications')
    ]);
    const err = [s, b, r, l, bal, red].find(x => x.error);
    if (err) { toast(friendly(err.error), { warn: true }); return; }
    state.settings = s.data;
    state.behaviors = b.data;
    state.rewards = r.data;
    // Keep any older pages already loaded with "Load older".
    const recentIds = new Set(l.data.map(x => x.id));
    const cutoff = since.getTime();
    const older = state.ledger.filter(x => !recentIds.has(x.id) && new Date(x.created_at).getTime() < cutoff);
    state.ledger = l.data.concat(older);
    state.redeemed = red.data;
    state.balance = bal.data;
    // Optional pieces: an older database without them still works.
    state.journalMissing = !!jr.error;
    state.journal = jr.error ? [] : jr.data;
    state.clubMissing = !!(ps.error || rq.error);
    state.stats = ps.error ? null : ps.data;
    state.requests = rq.error ? [] : rq.data;
    state.activityMissing = !!ac.error;
    state.activity = ac.error ? [] : ac.data;
    state.notif = nt.error ? null : nt.data;
    render();
  }

  let reloadTimer = null;
  const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 250); };

  let channel = null;
  function subscribe() {
    if (channel) return;
    channel = db.channel('family');
    ['ledger', 'behaviors', 'rewards', 'settings', 'journal', 'lineup_requests', 'activity'].forEach(table =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon));
    // Something Jaylen just did: pop it up right away.
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, ({ new: a }) => alertActivity(a));
    channel.subscribe(status => {
      const live = status === 'SUBSCRIBED';
      $('#sync').classList.toggle('off', !live);
      $('#sync').textContent = live ? 'Live' : 'Reconnecting';
      if (live) reloadSoon();
    });
  }

  // Phones pause pages in the background: refresh when it comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && started) loadAll(); });
  window.addEventListener('online', () => { if (started) loadAll(); });

  // ---------------------------------------------------------------- model
  const kidName = () => (state.settings && state.settings.kid_name) || 'Jaylen';
  const todayRequests = () => state.requests.filter(q => q.day === localDay());

  function model() {
    return RR.model({
      ...(state.settings || {}),
      balance: state.balance,
      behaviors: state.behaviors,
      rewards: state.rewards,
      recent: state.ledger,
      journal: state.journal,
      stats: state.stats,
      pending: state.clubMissing ? null : state.requests
    });
  }

  // ---------------------------------------------------------------- render
  let shownBalance = null;
  function render() {
    renderBell();
    const m = model();
    renderClubhouse(m); renderLineup(m); renderLocker(m); renderStats(m); renderManage();
    shownBalance = m.balance;
  }

  function renderClubhouse(m) {
    $('#c-card').innerHTML = RR.baseballCard(m);
    $('#c-xp').innerHTML = RR.xpHero(m);
    const bal = $('#c-xp .js-bal');
    if (shownBalance !== null && shownBalance !== m.balance) { bal.dataset.v = shownBalance; RR.countTo(bal, m.balance); }
    $('#c-bar').innerHTML = RR.xpBar(m);

    // Dugout: check-ins waiting for approval, a new postgame interview, the next prize.
    const cards = [];
    const reqs = todayRequests().map(q => ({ q, b: state.behaviors.find(x => x.id === q.behavior_id) })).filter(x => x.b);
    if (reqs.length) {
      const total = reqs.reduce((a, x) => a + x.b.points, 0);
      cards.push(RR.dcard({ color: 'yellow wide', kicker: 'Pending approval', ic: 'clock',
        title: `${reqs.length} check-in${reqs.length === 1 ? '' : 's'}`,
        body: `+${total} XP waiting<div class="dlist">${reqs.map(({ q, b }) => `<div class="drow">
            <div><b>${esc(b.name)}</b><small>${RR.timeOf(q.created_at)} · +${b.points} XP</small></div>
            <button class="rbtn ok" data-approve="${b.id}" aria-label="Approve ${esc(b.name)}">${icon('check')}</button>
            <button class="rbtn" data-decline="${q.id}" aria-label="Decline ${esc(b.name)}">${icon('x')}</button></div>`).join('')}</div>`,
        acts: reqs.length > 1 ? `<button class="btn sm ink block" data-approve-all>Approve all · +${total} XP</button>` : '' }));
    }
    if (journalUnread()) {
      const j = state.journal[0], md = RR.mood(j.mood);
      cards.push(RR.dcard({ color: 'lav', kicker: 'Postgame interview', ic: 'mic', title: `Feeling ${md.label.toLowerCase()} ${md.emoji}`,
        body: esc(j.body ? (j.body.length > 90 ? j.body.slice(0, 90) + '…' : j.body) : 'Just a mood today.'), attrs: 'data-open-journal' }));
    }
    cards.push(RR.ondeckCard(m));
    cards.push(RR.dcard({ kicker: 'Quick add', ic: 'plus', title: 'Bonus XP', body: 'Reward extra effort with a reason.', attrs: 'data-bonus' }));
    const live = todayRequests().length + (journalUnread() ? 1 : 0);
    $('#c-dugout').innerHTML = `<div class="dug-head"><h2>Dugout</h2><span class="count">${live}<small>new</small></span></div>
      <div class="dugout">${cards.join('')}</div>`;

    // Tabbed card: today's lineup (tap to award), scoreboard, highlights.
    const open = m.lineup.filter(b => b.status !== 'done').sort((a, b) => (b.status === 'pending') - (a.status === 'pending'));
    const lineupPane = `<div class="pane-head">${RR.diamond(m)}<button class="btn sm dark" data-go="lineup">All ${m.lineup.length}</button></div>` +
      (open.length ? RR.tiles(open.slice(0, 6), 'parent', true) : '<p class="empty">Every daily item is done. Great day.</p>');
    $('#c-tabs').innerHTML = RR.tabcard('club', [
      { key: 'lineup', label: 'Today’s Lineup', html: lineupPane },
      { key: 'score', label: 'Scoreboard', html: RR.scoreboard(m) + '<div style="margin-top:12px">' + RR.statGrid(m) + '</div>' },
      { key: 'high', label: 'Highlights', html: RR.highlights(m) }
    ]);
  }

  function renderLineup(m) {
    $('#l-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · Tap to award XP';
    $('#l-summary').innerHTML = `<div class="pane-head" style="margin:0">${RR.diamond(m)}
      <div style="text-align:right"><span class="label">Today</span><b class="num" style="font-size:28px;color:var(--gold)">+${fmt(m.todayXP)}</b></div></div>`;
    const cat = c => m.lineup.filter(b => b.cat === c);
    $('#l-groups').innerHTML = RR.tabcard('lineup', [
      { key: 'home', label: `Home & School · ${cat('home').length}`, html: RR.tiles(cat('home'), 'parent') },
      { key: 'sports', label: `On the Field · ${cat('sports').length}`, html: RR.tiles(cat('sports'), 'parent') }
    ]);
  }

  function renderLocker(m) {
    $('#p-bal').textContent = fmt(m.balance);
    $('#p-ondeck').innerHTML = RR.ondeck(m);
    $('#prize-list').innerHTML = m.rewards.length ? m.rewards.map(r => RR.lockerItem(r, m.balance, 'parent')).join('')
      : '<div class="panel empty" style="grid-column:1/-1">The locker is empty. Add a prize.</div>';
    $('#redeemed').innerHTML = state.redeemed.length ? state.redeemed.map(r => `<li><span class="mark redeem">${icon('gift', 'sm')}</span>
        <span class="grow"><b>${esc(r.reason)}</b><small>${RR.dayLabel(r.day)} · ${RR.timeOf(r.created_at)}${who(r)}</small></span>
        <span class="delta redeem">${RR.signed(r.points)}</span></li>`).join('')
      : '<li class="empty" style="display:block">Nothing redeemed yet.</li>';
  }

  const who = r => r.created_by ? ' · ' + esc(r.created_by.split('@')[0]) : '';

  function renderStats(m) {
    $('#s-box').innerHTML = RR.scoreboard(m);
    $('#s-stats').innerHTML = RR.statGrid(m, true);
    $('#s-trophies').innerHTML = RR.trophyCase(m);
    $('#s-ladder').innerHTML = RR.basepath(m);
    renderJournal();
    renderHistory();
  }

  // ---------------------------------------------------------------- awarding
  const busy = new Set();
  // quiet: used by "Approve all" (no repeat check, no toast). Returns the XP awarded.
  async function award(id, row, quiet = false) {
    const b = state.behaviors.find(x => x.id === id);
    if (!b || busy.has(id)) return 0;
    const today = localDay();
    const earns = state.ledger.filter(r => r.kind === 'earn' && r.behavior_id === id && r.day === today);
    const clearRequest = () => {
      const req = todayRequests().find(q => q.behavior_id === b.id);
      if (req) { db.from('lineup_requests').delete().eq('id', req.id).then(() => {}); state.requests = state.requests.filter(q => q !== req); }
    };
    if (b.once_daily && earns.length) {
      clearRequest(); render();
      if (!quiet) toast(`${b.name}: already completed today.`);
      return 0;
    }
    if (!quiet && !b.once_daily && earns.length && Date.now() - new Date(earns[0].created_at).getTime() < REPEAT_WARN_MS) {
      if (!await confirmSheet('Award again?', `“${b.name}” was awarded a moment ago. Give another +${b.points} XP?`, 'Award again')) return 0;
    }
    busy.add(id);
    if (row) { row.classList.remove('pop'); void row.offsetWidth; row.classList.add('pop'); }
    const before = model();
    const { data, error } = await db.from('ledger').insert({
      day: today, kind: 'earn', points: b.points, reason: b.name, emoji: b.emoji,
      behavior_id: b.id, once_daily: b.once_daily
    }).select().single();
    busy.delete(id);
    if (error) {
      if (error.code === '23505') { clearRequest(); if (!quiet) toast(`${b.name}: already completed today (maybe the other parent just did it).`); }
      else toast(friendly(error), { warn: true });
      loadAll();
      return 0;
    }
    clearRequest();   // a check-in for this item is now settled
    state.ledger.unshift(data);
    state.balance += b.points;
    if (state.stats) state.stats = { ...state.stats, lifetime_xp: state.stats.lifetime_xp + b.points, tasks_completed: state.stats.tasks_completed + 1 };
    render();
    if (!quiet) announce(before, model(), `+${b.points} XP · ${b.name}`, () => undo(data));
    return b.points;
  }

  async function approveAll(btn) {
    const ids = todayRequests().map(q => q.behavior_id);
    if (!ids.length) return;
    btn.disabled = true;
    const before = model();
    let xp = 0;
    for (const id of ids) xp += await award(id, null, true);
    const after = model();
    if (after.level.idx > before.level.idx) burst(60);
    toast(`Approved ${ids.length} check-in${ids.length === 1 ? '' : 's'} · +${xp} XP` + (after.level.idx > before.level.idx ? ` · Level up: ${after.level.name}` : ''));
    loadAll();
  }

  // Toast for an award, plus level-ups and prizes that just unlocked.
  function announce(before, after, msg, undoFn) {
    const unlocked = after.rewards.filter(r => r.cost > before.balance && r.cost <= after.balance);
    const levelUp = after.level.idx > before.level.idx;
    if (levelUp) msg += ` · Level up: ${after.level.name}`;
    else if (unlocked.length) msg += ` · ${unlocked[0].name} unlocked`;
    if (levelUp || unlocked.length) burst(levelUp ? 60 : 36);
    toast(msg, { action: { label: 'Undo', run: undoFn } });
  }

  async function undo(row) {
    const { error } = await db.from('ledger').delete().eq('id', row.id);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('Undone');
    state.ledger = state.ledger.filter(x => x.id !== row.id);
    loadAll();
  }

  async function decline(reqId) {
    const { error } = await db.from('lineup_requests').delete().eq('id', reqId);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('Check-in declined');
    loadAll();
  }

  // Bonus XP (the app only ever adds XP; prizes are the only thing that spends it)
  $('#btn-bonus').addEventListener('click', () => {
    const s = sheet(`<h3>Bonus XP</h3>
      <label class="field"><span class="label">How much XP?</span>
        <div class="stepper"><button type="button" data-step="-1">−</button><input class="input" name="amt" type="number" inputmode="numeric" min="1" value="2"><button type="button" data-step="1">+</button></div></label>
      <label class="field"><span class="label">Reason</span><input class="input" name="reason" maxlength="80" placeholder="What did he do?"></label>
      <div class="chips">${BONUS_REASONS.map(r => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Add XP</button></div>`);
    stepper(s.el);
    s.el.querySelectorAll('[data-reason]').forEach(c => c.addEventListener('click', () => {
      s.el.querySelector('[name=reason]').value = c.dataset.reason;
      s.el.querySelectorAll('[data-reason]').forEach(x => x.classList.toggle('on', x === c));
    }));
    s.on('[data-save]', async btn => {
      const amt = parseInt(s.el.querySelector('[name=amt]').value, 10);
      const reason = s.el.querySelector('[name=reason]').value.trim();
      if (!(amt > 0)) { s.err('Enter an amount of XP.'); return; }
      if (!reason) { s.err('Add a short reason so you both know why.'); return; }
      btn.disabled = true;
      const before = model();
      const { data, error } = await db.from('ledger').insert({ day: localDay(), kind: 'adjust', points: amt, reason, emoji: '⭐' }).select().single();
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      s.close();
      state.ledger.unshift(data);
      state.balance += amt;
      if (state.stats) state.stats = { ...state.stats, lifetime_xp: state.stats.lifetime_xp + amt };
      render();
      announce(before, model(), `+${amt} XP · ${reason}`, () => undo(data));
      loadAll();
    });
  });

  // ---------------------------------------------------------------- prize locker
  async function redeem(id, btn) {
    const r = state.rewards.find(x => x.id === id);
    if (!await confirmSheet(`Redeem ${r.name}?`, `This spends ${fmt(r.cost)} XP from ${kidName()}’s balance (${fmt(state.balance)} → ${fmt(state.balance - r.cost)}). His level and lifetime XP don’t change.`, 'Redeem')) return;
    btn.disabled = true;
    const { error } = await db.rpc('redeem_reward', { p_reward_id: r.id, p_day: localDay() });
    if (error) { toast(friendly(error), { warn: true }); loadAll(); return; }
    burst(50);
    toast(`${r.name} redeemed · −${fmt(r.cost)} XP`);
    loadAll();
  }

  $('#btn-add-prize').addEventListener('click', () => prizeSheet(null));

  function prizeSheet(r) {
    const isNew = !r;
    r = r || { name: '', emoji: '🎁', cost: 30, image_url: null };
    let imageUrl = r.image_url;
    const s = sheet(`<h3>${isNew ? 'New prize' : 'Edit prize'}</h3>
      <label class="field"><span class="label">Prize name</span><input class="input" name="name" maxlength="60" value="${esc(r.name)}" placeholder="e.g. Regular NeeDoh"></label>
      <label class="field"><span class="label">XP cost</span>
        <div class="stepper"><button type="button" data-step="-5">−</button><input class="input" name="cost" type="number" inputmode="numeric" min="1" value="${r.cost}"><button type="button" data-step="5">+</button></div></label>
      <div class="field"><span class="label">Product photo</span>
        <div class="photo-pick" style="margin-top:6px"><div class="thumb" id="thumb"></div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="btn sm dark">${icon('camera')}<span>Choose photo</span><input type="file" accept="image/*" hidden id="photo"></label>
            <button type="button" class="btn sm ghost" id="rm-photo">Remove photo</button>
          </div></div></div>
      <p class="err"></p>
      <div class="btns">${isNew ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn red" data-del>Delete</button>'}<button class="btn" data-save>Save</button></div>`);
    stepper(s.el);
    const paint = () => {
      s.el.querySelector('#thumb').outerHTML = `<div class="thumb shot" id="thumb">${imageUrl ? `<img src="${esc(imageUrl)}" alt="">` : icon('gift')}</div>`;
      s.el.querySelector('#rm-photo').hidden = !imageUrl;
    };
    paint();
    s.el.querySelector('#rm-photo').addEventListener('click', () => { imageUrl = null; paint(); });
    s.el.querySelector('#photo').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      s.err('');
      s.el.querySelector('#thumb').innerHTML = '<span class="muted" style="font-size:12px">Uploading…</span>';
      try { imageUrl = await uploadImage(file); } catch (err) { s.err('Could not upload that picture: ' + friendly(err)); }
      paint();
    });
    s.on('[data-save]', async btn => {
      const name = s.el.querySelector('[name=name]').value.trim();
      const cost = parseInt(s.el.querySelector('[name=cost]').value, 10);
      if (!name) { s.err('Give the prize a name.'); return; }
      if (!(cost > 0)) { s.err('Cost must be at least 1 XP.'); return; }
      btn.disabled = true;
      const row = { name, cost, emoji: r.emoji || '🎁', image_url: imageUrl };
      const { error } = isNew ? await db.from('rewards').insert(row) : await db.from('rewards').update(row).eq('id', r.id);
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      if (!isNew && r.image_url && r.image_url !== imageUrl) removeImage(r.image_url);
      s.close(); toast(isNew ? 'Prize added to the locker' : 'Prize saved'); loadAll();
    });
    s.on('[data-del]', async () => {
      if (!await confirmSheet(`Delete ${r.name}?`, 'It leaves the Prize Locker. Past redemptions stay in the log.', 'Delete', 'red')) return;
      const { error } = await db.from('rewards').delete().eq('id', r.id);
      if (error) { toast(friendly(error), { warn: true }); return; }
      if (r.image_url) removeImage(r.image_url);
      s.close(); toast('Prize deleted'); loadAll();
    });
  }

  // Shrink the photo on the phone (phone photos are huge), then upload it.
  async function uploadImage(file) {
    const blob = await resize(file, 800).catch(() => file);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'img').toLowerCase();
    const path = `${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await db.storage.from('reward-images').upload(path, blob, { contentType: blob.type || file.type, upsert: false });
    if (error) throw error;
    return db.storage.from('reward-images').getPublicUrl(path).data.publicUrl;
  }

  function resize(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error('resize failed')), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }

  function removeImage(url) {
    const marker = '/reward-images/';
    const i = url.indexOf(marker);
    if (i > -1) db.storage.from('reward-images').remove([decodeURIComponent(url.slice(i + marker.length))]);
  }

  // ---------------------------------------------------------------- game log
  function renderHistory() {
    const rows = state.ledger.filter(r => state.filter === 'all' || r.kind === state.filter || (state.filter === 'earn' && r.kind === 'journal'));
    $('#history').innerHTML = RR.gameLogRows(rows.slice(0, state.logLimit), { who: true, remove: true });
    $('#load-older').hidden = state.olderDone && rows.length <= state.logLimit;
    $('#load-older').textContent = 'Show more';
  }

  $('#filters').addEventListener('click', e => {
    const c = e.target.closest('[data-f]');
    if (!c) return;
    state.filter = c.dataset.f;
    state.logLimit = 15;
    $$('#filters .chip').forEach(x => x.classList.toggle('on', x === c));
    renderHistory();
  });

  async function removeRow(id) {
    const r = state.ledger.find(x => x.id === id);
    const msg = r.kind === 'redeem'
      ? `This gives back ${-r.points} XP (use it if the prize was redeemed by mistake).`
      : `Only for fixing a mistake: removes this entry and its ${Math.abs(r.points)} XP.`;
    if (!await confirmSheet(`Remove “${r.reason}”?`, msg, 'Remove', 'red')) return;
    const { error } = await db.from('ledger').delete().eq('id', r.id);
    if (error) { toast(friendly(error), { warn: true }); return; }
    state.ledger = state.ledger.filter(x => x.id !== r.id);
    toast('Removed'); loadAll();
  }

  $('#load-older').addEventListener('click', async () => {
    // Show more of what's loaded first; fetch older games once it runs out.
    const shown = state.logLimit;
    state.logLimit += 30;
    if (state.ledger.length > shown || state.olderDone) { renderHistory(); return; }
    const oldest = state.ledger[state.ledger.length - 1];
    let q = db.from('ledger').select('*').order('created_at', { ascending: false }).limit(100);
    if (oldest) q = q.lt('created_at', oldest.created_at);
    const { data, error } = await q;
    if (error) { toast(friendly(error), { warn: true }); return; }
    state.ledger = state.ledger.concat(data);
    if (data.length < 100) state.olderDone = true;
    renderHistory();
    if (!data.length) toast('That’s everything. No older games.');
  });

  // ---------------------------------------------------------------- postgame interviews
  const newestJournal = () => state.journal.reduce((m, j) => j.updated_at > m ? j.updated_at : m, '');
  const journalUnread = () => !!state.journal.length && newestJournal() > (store.get('journalSeen') || '');
  const markJournalSeen = () => { if (state.journal.length) store.set('journalSeen', newestJournal()); };

  function renderJournal() {
    if (state.tab === 'stats' && RR.ui.tabs.log === 'postgame') markJournalSeen();
    $('#stats-dot').hidden = !journalUnread();
    if (state.journalMissing) {
      $('#s-moods').innerHTML = '<p class="muted" style="margin:0">Run <code>supabase/add-journal.sql</code> in Supabase to turn on postgame interviews.</p>';
      $('#journal-list').innerHTML = '';
      return;
    }
    $('#s-moods').innerHTML = '<span class="label" style="margin-bottom:8px">Mood · last 7 days</span>' + RR.moodWeek(state.journal);
    $('#journal-list').innerHTML = state.journal.length ? state.journal.slice(0, 14).map(j => {
      const m = RR.mood(j.mood);
      return `<article class="panel entry">
        <div class="pg-head"><span class="m">${m.emoji}</span><div><b>Feeling ${esc(m.label.toLowerCase())}</b><small>${RR.dayLabel(j.day)} · ${RR.timeOf(j.updated_at)}</small></div></div>
        ${j.prompt ? `<p class="pg-prompt">Q: ${esc(j.prompt)}</p>` : ''}
        ${j.body ? `<div class="pg-text">${esc(j.body)}</div>` : '<p class="muted" style="margin:10px 0">No answer written, just a mood.</p>'}
        ${j.parent_reply ? `<div class="pg-reply"><span class="label">${esc((j.replied_by || 'You').split('@')[0])} replied</span><p>${esc(j.parent_reply)}</p></div>` : ''}
        <button class="btn sm ${j.parent_reply ? 'dark' : ''}" data-reply="${j.id}">${icon(j.parent_reply ? 'edit' : 'message')}${j.parent_reply ? 'Edit reply' : 'Reply'}</button>
      </article>`;
    }).join('') : `<div class="panel empty">When ${esc(kidName())} answers his postgame question, it shows up here.</div>`;
  }

  function replySheet(id) {
    const j = state.journal.find(x => x.id === id);
    const s = sheet(`<h3>Reply to ${esc(kidName())}</h3>
      <p class="muted" style="margin-top:0">He’ll see it on his dashboard.</p>
      <label class="field"><textarea class="input" name="reply" rows="3" maxlength="500" placeholder="Your message">${esc(j.parent_reply || '')}</textarea></label>
      <div class="chips">${QUICK_REPLIES.map(r => `<button type="button" class="chip" data-quick="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Send</button></div>`);
    const box = s.el.querySelector('[name=reply]');
    s.el.querySelectorAll('[data-quick]').forEach(c => c.addEventListener('click', () => {
      box.value = box.value.trim() ? box.value.trim() + ' ' + c.dataset.quick : c.dataset.quick;
    }));
    s.on('[data-save]', async btn => {
      const reply = box.value.trim();
      btn.disabled = true;
      const { error } = await db.from('journal').update({ parent_reply: reply || null, replied_by: reply ? state.user.email : null }).eq('id', j.id);
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      s.close(); toast(reply ? 'Reply sent' : 'Reply removed'); loadAll();
    });
  }

  // ---------------------------------------------------------------- front office
  function kidLink() {
    return new URL('kid.html#' + state.settings.kid_token, location.href).href;
  }

  // ---------------------------------------------------------------- notifications
  const seenAt = () => store.get('notifSeen') || '';
  const unread = () => state.activity.filter(a => a.created_at > seenAt());

  function renderBell() {
    const btn = $('#btn-bell');
    btn.hidden = state.activityMissing;
    const n = unread().length;
    btn.innerHTML = icon('bell') + (n ? `<i class="badge">${n > 9 ? '9+' : n}</i>` : '');
    btn.setAttribute('aria-label', n ? `Notifications: ${n} new` : 'Notifications');
  }

  function openNotifications() {
    const fresh = new Set(unread().map(a => a.id));
    if (state.activity.length) store.set('notifSeen', state.activity[0].created_at);
    renderBell();
    sheet(`<h3>Notifications</h3>
      ${state.activity.length ? `<ul class="list notif-list">${state.activity.map(a => `<li class="${fresh.has(a.id) ? 'new' : ''}">
          <span class="mark ${a.kind === 'journal' ? 'journal' : ''}">${icon(a.kind === 'journal' ? 'mic' : 'clock', 'sm')}</span>
          <span class="grow"><b>${esc(a.title)}</b><small>${esc(a.body)}</small><small class="when">${RR.dayLabel(RR.localDay(new Date(a.created_at)))} · ${RR.timeOf(a.created_at)}</small></span></li>`).join('')}</ul>`
        : `<p class="empty">Nothing yet. When ${esc(kidName())} checks in a lineup item or answers his postgame interview, it shows up here.</p>`}
      <div class="btns"><button class="btn ghost" data-close>Close</button>${todayRequests().length ? `<button class="btn" data-close data-go-approve>Review check-ins</button>` : ''}</div>`)
      .on('[data-go-approve]', () => goTab('clubhouse'));
  }

  // A new activity row arrived live from the database.
  function alertActivity(a) {
    toast(a.title, { action: { label: a.kind === 'journal' ? 'Read' : 'Review', run: () => {
      if (a.kind === 'journal') { goTab('stats'); $('#postgame [data-pane=postgame]').click(); $('#postgame').scrollIntoView(); }
      else goTab('clubhouse');
    } } });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(a.title, { body: a.body, icon: 'icons/icon-192.png', tag: a.id }); } catch { /* not supported here */ }
    }
  }

  function renderNotifyPanel() {
    const box = $('#notify-panel');
    if (state.activityMissing || !state.notif) {
      box.innerHTML = '<p class="muted" style="margin:0;font-size:13.5px">Run <code>supabase/add-notifications.sql</code> in Supabase to turn on notifications (see the README).</p>';
      return;
    }
    const n = state.notif, last = n.last;
    let status;
    if (!n.configured) status = `${icon('mail', 'sm')}<span>Email isn’t set up yet. It needs a free Resend key added in Supabase (README → <b>Email notifications</b>).</span>`;
    else if (last && last.status >= 200 && last.status < 300) status = `${icon('check', 'sm')}<span>Email is on. Last ${last.kind === 'test' ? 'test ' : ''}email sent ${RR.dayLabel(RR.localDay(new Date(last.at))).toLowerCase()} at ${RR.timeOf(last.at)}.</span>`;
    else if (last && (last.error || last.status)) status = `${icon('x', 'sm')}<span class="bad">Last email failed: ${esc(last.error || 'status ' + last.status)}</span>`;
    else status = `${icon('check', 'sm')}<span>Email is set up.</span>`;
    const deviceBtn = 'Notification' in window && Notification.permission !== 'granted'
      ? `<button class="btn sm ghost" data-device-alerts>${icon('bell')}Pop-ups on this device</button>` : '';
    box.innerHTML = `<p class="muted" style="margin:0 0 12px;font-size:13.5px">You’ll hear about it when ${esc(kidName())} checks in a lineup item or answers his postgame interview: the bell up top, a pop-up while the app is open, and email.</p>
      <label class="toggle"><span><b>Email me</b><small>${esc(state.user.email)} · several taps in a row arrive as one email</small></span>
        <span class="switch"><input type="checkbox" id="notify-email" ${n.notify_email ? 'checked' : ''}><i></i></span></label>
      <div class="notify-status">${status}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn sm dark" data-test-email ${n.configured ? '' : 'disabled'}>${icon('mail')}Send me a test email</button>${deviceBtn}</div>`;
  }

  $('#notify-panel').addEventListener('change', async e => {
    if (e.target.id !== 'notify-email') return;
    const on = e.target.checked;
    const { error } = await db.rpc('set_notify_email', { p_on: on });
    if (error) { toast(friendly(error), { warn: true }); e.target.checked = !on; return; }
    toast(on ? 'Emails on for you' : 'Emails off for you');
    loadAll();
  });

  $('#notify-panel').addEventListener('click', async e => {
    const t = e.target.closest('[data-test-email],[data-device-alerts]');
    if (!t) return;
    if ('deviceAlerts' in t.dataset) {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Pop-ups on for this device while the app is open' : 'Pop-ups weren’t allowed on this device');
      renderNotifyPanel();
      return;
    }
    t.disabled = true;
    const { error } = await db.rpc('send_test_email');
    if (error) { toast(friendly(error), { warn: true }); t.disabled = false; return; }
    toast(`Test email sent to ${state.user.email}. Check your inbox (and spam).`, { ms: 5000 });
    setTimeout(loadAll, 5000);   // then show whether it went through
  });

  function renderManage() {
    const m = model();
    $('#behavior-admin').innerHTML = m.lineup.map((b, i) => {
      const first = i === 0 || m.lineup[i - 1].cat !== b.cat;
      return (first ? `<li class="day-head" style="border:0;padding-bottom:0">${RR.CATEGORIES[b.cat]}</li>` : '') + `<li>
        <span class="lu-no" style="width:30px;height:30px;font-size:15px">${b.order}</span>
        <span class="grow"><b>${esc(b.name)}</b><small>+${b.points} XP · ${b.once_daily ? 'Once a day' : 'Any time'}</small></span>
        <button class="icon-btn" data-move="${b.id}" aria-label="Move up" ${first ? 'disabled' : ''}>${icon('up', 'sm')}</button>
        <button class="icon-btn" data-edit-b="${b.id}" aria-label="Edit">${icon('edit', 'sm')}</button></li>`;
    }).join('') || '<li class="empty" style="display:block">The lineup is empty.</li>';
    if (!state.settings) return;
    const st = state.settings;
    $('#avatar-thumb').innerHTML = st.avatar_url ? `<img src="${esc(st.avatar_url)}" alt="">` : icon('camera');
    $('#avatar-remove').hidden = !st.avatar_url;
    const keep = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = v == null ? '' : v; };
    keep('#kid-name', st.kid_name);
    keep('#kid-jersey', st.jersey_number);
    keep('#kid-position', st.position);
    $('#kid-jersey').disabled = $('#kid-position').disabled = !('jersey_number' in st);
    $('#journal-points-row').hidden = !('journal_points' in st);
    keep('#journal-points', st.journal_points);
    $('#kid-link').textContent = kidLink();
    $('#open-kid-link').href = kidLink();
    renderNotifyPanel();
    $('#upgrade-note').innerHTML = state.clubMissing
      ? `<div class="alert amber" style="margin-top:0">${icon('bolt')}<span class="grow"><b>One-time database upgrade</b>
          <small>Run <code>supabase/add-clubhouse.sql</code> in Supabase’s SQL Editor to turn on jersey numbers, lifetime XP levels and check-in approvals.</small></span></div>` : '';
  }

  $('#save-card').addEventListener('click', async () => {
    const name = $('#kid-name').value.trim();
    if (!name) { toast('Add a player name.'); return; }
    const row = { kid_name: name };
    if ('jersey_number' in state.settings) {
      const jersey = $('#kid-jersey').value.trim();
      if (jersey && !/^[0-9]{1,2}$/.test(jersey)) { toast('Jersey number: 0 to 99.'); return; }
      row.jersey_number = jersey || null;
      row.position = $('#kid-position').value.trim().toUpperCase() || null;
    }
    const { error } = await db.from('settings').update(row).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('Player card saved'); loadAll();
  });

  async function moveUp(id) {
    // Move up within its own section, then renumber everything section by section.
    const m = model();
    const list = m.lineup.slice();
    const i = list.findIndex(b => b.id === id);
    if (i < 1 || list[i - 1].cat !== list[i].cat) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    state.behaviors = list.map(({ order, cat, n, status, ...b }) => b);
    render();
    const results = await Promise.all(list.map((b, k) => b.sort === k + 1 ? null : db.from('behaviors').update({ sort: k + 1 }).eq('id', b.id)));
    if (results.some(r => r && r.error)) toast('Could not save the new order', { warn: true });
    loadAll();
  }

  $('#btn-add-behavior').addEventListener('click', () => behaviorSheet(null));

  function behaviorSheet(b) {
    const isNew = !b;
    b = b || { name: '', emoji: '⭐', points: 3, once_daily: true, category: 'home' };
    let category = RR.catOf(b);
    const s = sheet(`<h3>${isNew ? 'Add to lineup' : 'Edit lineup item'}</h3>
      <label class="field"><span class="label">Activity</span><input class="input" name="name" maxlength="60" value="${esc(b.name)}" placeholder="e.g. Morning routine"></label>
      <label class="field"><span class="label">XP value</span>
        <div class="stepper"><button type="button" data-step="-1">−</button><input class="input" name="points" type="number" inputmode="numeric" min="1" value="${b.points}"><button type="button" data-step="1">+</button></div></label>
      <div class="field"><span class="label" style="margin-bottom:6px">Category</span>
        <div class="chips">${Object.entries(RR.CATEGORIES).map(([k, v]) => `<button type="button" class="chip" data-cat="${k}">${v}</button>`).join('')}</div></div>
      <label class="toggle"><span><b>Once a day</b><small>Blocks a second award on the same day</small></span>
        <span class="switch"><input type="checkbox" name="once" ${b.once_daily ? 'checked' : ''}><i></i></span></label>
      <p class="err"></p>
      <div class="btns">${isNew ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn red" data-del>Delete</button>'}<button class="btn" data-save>Save</button></div>`);
    stepper(s.el);
    const paintCat = () => s.el.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x.dataset.cat === category));
    s.el.querySelectorAll('[data-cat]').forEach(x => x.addEventListener('click', () => { category = x.dataset.cat; paintCat(); }));
    paintCat();
    s.on('[data-save]', async btn => {
      const name = s.el.querySelector('[name=name]').value.trim();
      const points = parseInt(s.el.querySelector('[name=points]').value, 10);
      const once_daily = s.el.querySelector('[name=once]').checked;
      if (!name) { s.err('Give it a name.'); return; }
      if (!(points > 0)) { s.err('XP must be at least 1.'); return; }
      btn.disabled = true;
      const row = { name, points, once_daily, category, emoji: b.emoji || '⭐' };
      if (isNew) row.sort = Math.max(0, ...state.behaviors.map(x => x.sort)) + 1;
      const { error } = isNew ? await db.from('behaviors').insert(row) : await db.from('behaviors').update(row).eq('id', b.id);
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      s.close(); toast(isNew ? 'Added to the lineup' : 'Saved'); loadAll();
    });
    s.on('[data-del]', async () => {
      if (!await confirmSheet(`Delete “${b.name}”?`, 'XP he already earned for it stays in his balance and history.', 'Delete', 'red')) return;
      const { error } = await db.from('behaviors').delete().eq('id', b.id);
      if (error) { toast(friendly(error), { warn: true }); return; }
      s.close(); toast('Removed from the lineup'); loadAll();
    });
  }

  // Player photo: upload, save on the settings row, then tidy up the old file.
  $('#avatar-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('#avatar-thumb').innerHTML = '<span class="muted" style="font-size:12px">Uploading…</span>';
    try {
      const url = await uploadImage(file);
      await saveAvatar(url);
    } catch (err) {
      toast('Could not upload that photo: ' + friendly(err), { warn: true });
      renderManage();
    }
  });

  $('#avatar-remove').addEventListener('click', async () => {
    if (!await confirmSheet('Remove the player photo?', 'His initials show instead.', 'Remove', 'red')) return;
    saveAvatar(null);
  });

  async function saveAvatar(url) {
    const old = state.settings.avatar_url;
    const { error } = await db.from('settings').update({ avatar_url: url }).eq('id', 1);
    if (error) {
      if (url) removeImage(url);
      toast(/avatar_url/.test(error.message) ? 'Run supabase/add-avatar.sql in Supabase first (see README).' : friendly(error), { warn: true });
      renderManage();
      return;
    }
    if (old && old !== url) removeImage(old);
    toast(url ? 'Player photo saved' : 'Photo removed');
    loadAll();
  }

  stepper($('#journal-points-row'), 0);
  $('#save-journal-points').addEventListener('click', async () => {
    const n = parseInt($('#journal-points').value, 10);
    if (!(n >= 0 && n <= 50)) { toast('Pick 0 to 50 XP.'); return; }
    const { error } = await db.from('settings').update({ journal_points: n }).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast(n ? `+${n} XP for each postgame interview` : 'Postgame XP turned off'); loadAll();
  });

  $('#copy-kid-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(kidLink()); toast('Link copied'); }
    catch { toast('Press and hold the link to copy it.'); }
  });

  $('#new-kid-link').addEventListener('click', async () => {
    if (!await confirmSheet('Make a new link?', 'The old player dashboard link stops working. You’ll need to open the new link on his device.', 'Make new link')) return;
    const { error } = await db.from('settings').update({ kid_token: crypto.randomUUID() }).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('New link ready'); loadAll();
  });

  // ---------------------------------------------------------------- navigation + taps
  function goTab(name) {
    if (name !== 'manage') state.prevTab = name;
    state.tab = name;
    $$('.nav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === name));
    $$('[data-tab]').forEach(sec => { sec.hidden = sec.dataset.tab !== name; });
    window.scrollTo({ top: 0 });
    if (name === 'stats') renderJournal();
  }

  $('#btn-manage').addEventListener('click', () => goTab('manage'));
  $('#btn-bell').addEventListener('click', openNotifications);
  RR.wireUI($('#screen-app'));
  // Opening the Postgame pane counts as reading his latest interview.
  $('#postgame').addEventListener('click', e => { if (e.target.closest('[data-pane=postgame]')) { markJournalSeen(); render(); } });

  // One listener for every tappable thing inside the app.
  $('#screen-app').addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-manage],[data-award],[data-approve-all],[data-approve],[data-decline],[data-redeem],[data-edit-prize],[data-del-row],[data-reply],[data-open-journal],[data-bonus],[data-edit-b],[data-move]');
    if (!t) return;
    const d = t.dataset;
    if (t.id === 'manage-back') { goTab(state.prevTab); return; }
    if (d.go) goTab(d.go);
    else if (d.manage) { goTab('manage'); $('#manage-lineup').scrollIntoView(); }
    else if (d.award) award(d.award, t);
    else if ('approveAll' in d) approveAll(t);
    else if (d.approve) award(d.approve, null);
    else if (d.decline) decline(d.decline);
    else if (d.redeem) redeem(d.redeem, t);
    else if (d.editPrize) prizeSheet(state.rewards.find(r => r.id === d.editPrize));
    else if (d.delRow) removeRow(d.delRow);
    else if (d.reply) replySheet(d.reply);
    else if ('openJournal' in d) { goTab('stats'); $('#postgame [data-pane=postgame]').click(); $('#postgame').scrollIntoView(); }
    else if ('bonus' in d) $('#btn-bonus').click();
    else if (d.editB) behaviorSheet(state.behaviors.find(b => b.id === d.editB));
    else if (d.move) moveUp(d.move);
  });

  // ---------------------------------------------------------------- sheets
  function sheet(html) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    document.body.appendChild(bg);
    document.body.style.overflow = 'hidden';
    const el = bg.firstElementChild;
    const api = {
      el,
      close() { bg.remove(); if (!$('.sheet-bg')) document.body.style.overflow = ''; api.onclose && api.onclose(); },
      err(m) { const p = el.querySelector('.err'); if (p) p.textContent = m; },
      on(sel, fn) { const x = el.querySelector(sel); if (x) x.addEventListener('click', () => fn(x)); }
    };
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) api.close(); });
    const first = el.querySelector('input:not([type=file]):not([type=checkbox])');
    if (first && !first.value && matchMedia('(hover: hover)').matches) first.focus();
    return api;
  }

  function confirmSheet(title, body, yes, color = '') {
    return new Promise(resolve => {
      let answered = false;
      const s = sheet(`<h3>${esc(title)}</h3><p class="muted" style="margin-top:0">${esc(body)}</p>
        <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn ${color}" data-yes>${esc(yes)}</button></div>`);
      s.onclose = () => { if (!answered) resolve(false); };
      s.on('[data-yes]', () => { answered = true; s.close(); resolve(true); });
    });
  }

  function stepper(root, min = 1) {
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const input = b.parentElement.querySelector('input');
      input.value = Math.max(min, (parseInt(input.value, 10) || 0) + parseInt(b.dataset.step, 10));
    }));
  }
})();
