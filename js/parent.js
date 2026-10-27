// Reward Rocket — the parent app (index.html).
//
// Everything lives in Supabase (see supabase/setup.sql). Both parents read and
// write the same tables; a realtime subscription reloads this phone whenever
// the other phone changes something.

(() => {
  const { client: db, esc, $, $$, localDay, stats, nextPrize, pct, toast, confetti, signed } = RR;

  const EMOJIS = ['⭐', '🎒', '📚', '👂', '🤝', '🧹', '💛', '🧘', '🌙', '🏫', '🦷', '🛏️', '🍽️', '🐶', '📖', '🎹', '🧺', '🚿', '😊', '🙏',
    '🏆', '⚾', '⚽', '🏀', '🏈', '🧤', '🙌', '💨', '📣', '💪', '🧢', '👏', '🏃', '🥅'];
  // Behaviors are shown in two sections. Sports is about his approach to the game, not results.
  const GROUPS = [
    { key: 'home', title: '🏠 Home & School' },
    { key: 'sports', title: '🏅 Sports & Team', note: 'Effort & attitude, not the score' }
  ];
  const catOf = b => b.category === 'sports' ? 'sports' : 'home';
  const grouped = () => GROUPS.map(g => ({ ...g, items: state.behaviors.filter(b => catOf(b) === g.key) }));
  const PRIZE_EMOJIS = ['🎁', '🧸', '🟣', '🌈', '🍦', '🎮', '📺', '🍕', '🎟️', '🧩', '🪀', '🦖', '🚗', '📚', '🍫', '🌟'];
  const HISTORY_DAYS = 35;   // loaded up front; older entries via "Load older"
  const REPEAT_WARN_MS = 90 * 1000;

  const state = {
    user: null,
    settings: null,
    behaviors: [],
    rewards: [],
    ledger: [],       // newest first
    redeemed: [],
    journal: [],          // newest day first
    journalMissing: false, // true until supabase/add-journal.sql has been run
    balance: 0,
    tab: 'award',
    filter: 'all',
    olderDone: false
  };

  RR.starfield();

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
    btn.disabled = true; btn.textContent = 'Launching…';
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) $('#login-err').textContent = /invalid/i.test(error.message) ? 'That email or password is not right.' : error.message;
  });

  $('#forgot').addEventListener('click', async () => {
    const email = $('#login-form').email.value.trim();
    if (!email) { $('#login-err').textContent = 'Type your email above first, then tap "Forgot password?".'; return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $('#login-err').textContent = '';
    toast(error ? error.message : 'Check your email for a reset link 📬', { warn: !!error, ms: 6000 });
  });

  $('#reset-form').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: e.target.password.value });
    if (error) { $('#reset-err').textContent = error.message; return; }
    toast('Password saved ✅');
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
    const s = sheet(`<h3>🔑 Change password</h3>
      <label class="field"><span>New password (8+ characters)</span><input class="input" type="password" name="pw" minlength="8" autocomplete="new-password"></label>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>`);
    s.on('[data-save]', async () => {
      const pw = s.el.querySelector('[name=pw]').value;
      if (pw.length < 8) { s.err('Use at least 8 characters.'); return; }
      const { error } = await db.auth.updateUser({ password: pw });
      if (error) { s.err(error.message); return; }
      s.close(); toast('Password changed ✅');
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
    const [s, b, r, l, bal, red, jr] = await Promise.all([
      db.from('settings').select('*').eq('id', 1).maybeSingle(),
      db.from('behaviors').select('*').order('sort').order('created_at'),
      db.from('rewards').select('*').order('cost').order('sort'),
      db.from('ledger').select('*').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(1000),
      db.rpc('balance'),
      db.from('ledger').select('*').eq('kind', 'redeem').order('created_at', { ascending: false }).limit(50),
      db.from('journal').select('*').order('day', { ascending: false }).limit(60)
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
    // The journal is optional: an older database without it still works.
    state.journalMissing = !!jr.error;
    state.journal = jr.error ? [] : jr.data;
    render();
  }

  let reloadTimer = null;
  const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 250); };

  let channel = null;
  function subscribe() {
    if (channel) return;
    channel = db.channel('family');
    ['ledger', 'behaviors', 'rewards', 'settings', 'journal'].forEach(table =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon));
    channel.subscribe(status => {
      const live = status === 'SUBSCRIBED';
      $('#sync').classList.toggle('off', !live);
      $('#sync').textContent = live ? 'Live' : 'Reconnecting…';
      if (live) reloadSoon();
    });
  }

  // Phones pause pages in the background: refresh when it comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && started) loadAll(); });
  window.addEventListener('online', () => { if (started) loadAll(); });

  // ---------------------------------------------------------------- render
  function render() {
    renderHero(); renderTiles(); renderPrizes(); renderHistory(); renderSetup(); renderJournal();
  }

  const kidName = () => (state.settings && state.settings.kid_name) || 'Jaylen';
  const avatarHtml = () => {
    const url = state.settings && state.settings.avatar_url;
    return `<span class="avatar">${url ? `<img src="${esc(url)}" alt="">` : '🧑‍🚀'}</span>`;
  };

  function renderHero() {
    const st = stats(state.ledger);
    const next = nextPrize(state.rewards, state.balance);
    const hero = $('#hero');
    if (!hero.dataset.ready) {
      hero.innerHTML = `<div class="rocket" aria-hidden="true">🚀</div>
        <div class="kid"></div>
        <div class="bal"><b id="bal-num">0</b><span>points</span></div>
        <div class="stats">
          <div class="stat"><b id="today-num">0</b><span>earned today</span></div>
          <div class="stat"><b id="week-num">0</b><span>earned this week</span></div>
        </div>
        <div class="next" id="hero-next"></div>`;
      hero.dataset.ready = 1;
    }
    hero.querySelector('.kid').innerHTML = avatarHtml() + `<span>${esc(kidName())}’s balance</span>`;
    RR.countTo($('#bal-num'), state.balance);
    $('#today-num').textContent = '+' + st.todayPts;
    $('#week-num').textContent = '+' + st.weekPts;
    $('#hero-next').innerHTML = next
      ? `${next.cost - state.balance} more to <b>${esc(next.emoji)} ${esc(next.name)}</b><div class="bar"><i style="width:${pct(state.balance, next.cost)}%"></i></div>`
      : state.rewards.length ? '🎉 Enough points for every prize!' : '';
  }

  function todayEarns(behaviorId) {
    const today = localDay();
    return state.ledger.filter(r => r.kind === 'earn' && r.behavior_id === behaviorId && r.day === today);
  }

  function renderTiles() {
    const box = $('#tiles');
    if (!state.behaviors.length) { box.innerHTML = '<div class="card empty">No behaviors yet. Add some in ⚙️ Setup.</div>'; return; }
    box.innerHTML = grouped().filter(g => g.items.length).map(g => `
      <div class="section-title">${g.title} <small>${g.note || 'Tap to award'}</small></div>
      <div class="tiles ${g.key}">${g.items.map(tileHtml).join('')}</div>`).join('');
  }

  function tileHtml(b) {
    const n = todayEarns(b.id).length;
    const done = b.once_daily && n > 0;
    const tag = done ? '✓ Done today' : b.once_daily ? 'Once a day' : n ? `✓ ${n}× today` : 'Any time';
    return `<button class="tile${done ? ' done' : ''}" data-b="${b.id}">
      <span class="pts">+${b.points}</span>
      <span class="emo">${esc(b.emoji)}</span>
      <span class="nm">${esc(b.name)}</span>
      <span class="tag">${tag}</span>
    </button>`;
  }

  $('#tiles').addEventListener('click', e => {
    const t = e.target.closest('.tile');
    if (t) award(t.dataset.b, t);
  });

  const busy = new Set();
  async function award(id, tile) {
    const b = state.behaviors.find(x => x.id === id);
    if (!b || busy.has(id)) return;
    const earns = todayEarns(id);
    if (b.once_daily && earns.length) {
      toast(`${b.emoji} Already earned today — once a day only.`);
      return;
    }
    if (!b.once_daily && earns.length && Date.now() - new Date(earns[0].created_at).getTime() < REPEAT_WARN_MS) {
      if (!await confirmSheet(`Award again?`, `“${b.name}” was just awarded a moment ago. Give another +${b.points}?`, 'Yes, award again')) return;
    }
    busy.add(id);
    tile.classList.remove('pop'); void tile.offsetWidth; tile.classList.add('pop');
    const { data, error } = await db.from('ledger').insert({
      day: localDay(), kind: 'earn', points: b.points, reason: b.name, emoji: b.emoji,
      behavior_id: b.id, once_daily: b.once_daily
    }).select().single();
    busy.delete(id);
    if (error) {
      if (error.code === '23505') toast(`${b.emoji} Already earned today (maybe the other parent just did it).`);
      else toast(friendly(error), { warn: true });
      loadAll();
      return;
    }
    state.ledger.unshift(data);
    state.balance += b.points;
    const before = state.balance - b.points;
    const unlocked = state.rewards.filter(r => r.cost > before && r.cost <= state.balance);
    render();
    confetti(unlocked.length ? ['🎉', '🎁', '⭐', '🚀'] : undefined, unlocked.length ? 50 : 24);
    toast(`+${b.points} ${b.emoji} ${b.name}` + (unlocked.length ? ` — ${unlocked[0].name} unlocked! 🎉` : ''),
      { action: { label: 'Undo', run: () => undo(data) } });
  }

  async function undo(row) {
    const { error } = await db.from('ledger').delete().eq('id', row.id);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('Undone ↩️');
    state.ledger = state.ledger.filter(x => x.id !== row.id);
    loadAll();
  }

  // ----- Bonus points (the app only ever adds points; prizes are the only thing that spends them)
  $('#btn-bonus').addEventListener('click', bonusSheet);

  function bonusSheet() {
    const reasons = ['Extra helpful', 'Great attitude', 'Tried something hard', 'Helped a sibling', 'Above and beyond'];
    const s = sheet(`<h3>🌟 Bonus points</h3>
      <label class="field"><span>How many points?</span>
        <div class="stepper"><button type="button" data-step="-1">−</button><input class="input" name="amt" type="number" inputmode="numeric" min="1" value="2"><button type="button" data-step="1">+</button></div></label>
      <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="80" placeholder="Why?"></label>
      <div class="chips">${reasons.map(r => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn green" data-save>Add points</button></div>`);
    stepper(s.el);
    s.el.querySelectorAll('[data-reason]').forEach(c => c.addEventListener('click', () => {
      s.el.querySelector('[name=reason]').value = c.dataset.reason;
      s.el.querySelectorAll('[data-reason]').forEach(x => x.classList.toggle('on', x === c));
    }));
    s.on('[data-save]', async btn => {
      const amt = parseInt(s.el.querySelector('[name=amt]').value, 10);
      const reason = s.el.querySelector('[name=reason]').value.trim();
      if (!(amt > 0)) { s.err('Enter a number of points.'); return; }
      if (!reason) { s.err('Add a short reason so you both know why.'); return; }
      btn.disabled = true;
      const { data, error } = await db.from('ledger').insert({
        day: localDay(), kind: 'adjust', points: amt, reason, emoji: '🌟'
      }).select().single();
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      s.close();
      confetti();
      toast(`+${amt} points · ${reason}`, { action: { label: 'Undo', run: () => undo(data) } });
      loadAll();
    });
  }

  // ---------------------------------------------------------------- prizes
  function renderPrizes() {
    const bal = state.balance;
    $('#prize-list').innerHTML = state.rewards.length ? state.rewards.map(r => {
      const ready = bal >= r.cost;
      return `<article class="prize${ready ? ' ready' : ''}">
        <button class="icon-btn edit" data-edit-prize="${r.id}" aria-label="Edit ${esc(r.name)}">✏️</button>
        <div class="pic">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy">` : esc(r.emoji)}</div>
        <div class="body">
          <div class="row"><span class="nm">${esc(r.name)}</span><span class="cost">⭐ ${r.cost}</span></div>
          <div class="bar${ready ? ' full' : ''}"><i style="width:${pct(bal, r.cost)}%"></i></div>
          <div class="left">${ready ? 'Ready to redeem! 🎉' : `${r.cost - bal} more points to go`}</div>
          <button class="btn ${ready ? 'green' : 'ghost'} block" data-redeem="${r.id}" ${ready ? '' : 'disabled'}>🎁 Redeem</button>
        </div>
      </article>`;
    }).join('') : '<div class="card empty">No prizes yet. Tap “Add prize”.</div>';

    $('#redeemed').innerHTML = state.redeemed.length ? state.redeemed.map(r => `<li>
        <span class="emo">${esc(r.emoji || '🎁')}</span>
        <span class="grow"><b>${esc(r.reason)}</b><small>${RR.dayLabel(r.day)} · ${RR.timeOf(r.created_at)}${who(r)}</small></span>
        <span class="pts-pill prize">${signed(r.points)}</span></li>`).join('')
      : '<li class="empty" style="display:block">Nothing redeemed yet.</li>';
  }

  $('#prize-list').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-prize]');
    if (ed) { prizeSheet(state.rewards.find(r => r.id === ed.dataset.editPrize)); return; }
    const rd = e.target.closest('[data-redeem]');
    if (!rd) return;
    const r = state.rewards.find(x => x.id === rd.dataset.redeem);
    if (!await confirmSheet(`Redeem ${r.emoji} ${r.name}?`, `This takes ${r.cost} points from ${kidName()}’s balance (${state.balance} → ${state.balance - r.cost}).`, 'Redeem it!')) return;
    rd.disabled = true;
    const { error } = await db.rpc('redeem_reward', { p_reward_id: r.id, p_day: localDay() });
    if (error) { toast(friendly(error), { warn: true }); loadAll(); return; }
    confetti(['🎁', '🎉', '⭐', r.emoji], 60);
    toast(`🎉 ${r.name} redeemed! −${r.cost} points`);
    loadAll();
  });

  $('#btn-add-prize').addEventListener('click', () => prizeSheet(null));

  function prizeSheet(r) {
    const isNew = !r;
    r = r || { name: '', emoji: '🎁', cost: 30, image_url: null };
    let imageUrl = r.image_url, emoji = r.emoji;
    const s = sheet(`<h3>${isNew ? '🎁 New prize' : '✏️ Edit prize'}</h3>
      <label class="field"><span>Prize name</span><input class="input" name="name" maxlength="60" value="${esc(r.name)}" placeholder="e.g. Regular NeeDoh"></label>
      <label class="field"><span>Cost in points</span>
        <div class="stepper"><button type="button" data-step="-5">−</button><input class="input" name="cost" type="number" inputmode="numeric" min="1" value="${r.cost}"><button type="button" data-step="5">+</button></div></label>
      <div class="field"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">Picture</span>
        <div class="photo-pick"><div class="thumb" id="thumb"></div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="btn sm">📷 Choose photo<input type="file" accept="image/*" hidden id="photo"></label>
            <button type="button" class="btn sm ghost" id="rm-photo">Use emoji instead</button>
          </div></div>
        <div class="emoji-row">${PRIZE_EMOJIS.map(x => `<button type="button" data-emoji="${x}">${x}</button>`).join('')}</div>
      </div>
      <p class="err"></p>
      <div class="btns">${isNew ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn red" data-del>Delete</button>'}<button class="btn" data-save>Save</button></div>`);
    stepper(s.el);
    const paint = () => {
      s.el.querySelector('#thumb').innerHTML = imageUrl ? `<img src="${esc(imageUrl)}" alt="">` : esc(emoji);
      s.el.querySelectorAll('[data-emoji]').forEach(x => x.classList.toggle('on', !imageUrl && x.dataset.emoji === emoji));
      s.el.querySelector('#rm-photo').hidden = !imageUrl;
    };
    paint();
    s.el.querySelectorAll('[data-emoji]').forEach(x => x.addEventListener('click', () => { emoji = x.dataset.emoji; imageUrl = null; paint(); }));
    s.el.querySelector('#rm-photo').addEventListener('click', () => { imageUrl = null; paint(); });
    s.el.querySelector('#photo').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      s.err('');
      s.el.querySelector('#thumb').textContent = '⏳';
      try { imageUrl = await uploadImage(file); } catch (err) { s.err('Could not upload that picture: ' + friendly(err)); }
      paint();
    });
    s.on('[data-save]', async btn => {
      const name = s.el.querySelector('[name=name]').value.trim();
      const cost = parseInt(s.el.querySelector('[name=cost]').value, 10);
      if (!name) { s.err('Give the prize a name.'); return; }
      if (!(cost > 0)) { s.err('Cost must be at least 1 point.'); return; }
      btn.disabled = true;
      const row = { name, cost, emoji, image_url: imageUrl };
      const { error } = isNew ? await db.from('rewards').insert(row) : await db.from('rewards').update(row).eq('id', r.id);
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      if (!isNew && r.image_url && r.image_url !== imageUrl) removeImage(r.image_url);
      s.close(); toast(isNew ? 'Prize added 🎁' : 'Prize saved ✅'); loadAll();
    });
    s.on('[data-del]', async () => {
      if (!await confirmSheet(`Delete ${r.name}?`, 'It disappears from the store. Past redemptions stay in the history.', 'Delete', 'red')) return;
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

  // ---------------------------------------------------------------- history
  const who = r => r.created_by ? ' · ' + esc(r.created_by.split('@')[0]) : '';

  function renderHistory() {
    const st = stats(state.ledger);
    const max = Math.max(5, ...Object.values(st.perDay));
    const today = localDay();
    $('#week').innerHTML = st.days.map(d => `<div class="col${d === today ? ' today' : ''}">
      <span class="v">${st.perDay[d] || ''}</span>
      <span class="b" style="height:${Math.round(st.perDay[d] / max * 100)}%"></span>
      <span class="d">${d === today ? 'Today' : RR.shortDay(d)}</span></div>`).join('');
    $('#summary').innerHTML = `<div><b>+${st.weekPts}</b><span>earned this week</span></div>
      <div><b>${st.weekAwards}</b><span>awards this week</span></div>
      <div><b>${st.weekRedeemed}</b><span>prizes this week</span></div>`;

    const rows = state.ledger.filter(r => state.filter === 'all' || r.kind === state.filter || (state.filter === 'earn' && r.kind === 'journal'));
    if (!rows.length) { $('#history').innerHTML = '<p class="empty">Nothing here yet.</p>'; }
    else {
      let html = '', day = null;
      for (const r of rows) {
        if (r.day !== day) {
          if (day !== null) html += '</ul>';
          day = r.day;
          const net = rows.filter(x => x.day === day && x.kind !== 'redeem').reduce((a, x) => a + x.points, 0);
          html += `<div class="day-head"><span>${RR.dayLabel(day)}</span><span>${signed(net)}</span></div><ul class="list">`;
        }
        const cls = r.kind === 'redeem' ? 'prize' : r.points > 0 ? 'plus' : 'minus';
        html += `<li data-row="${r.id}">
          <span class="emo">${esc(r.emoji || (r.points > 0 ? '⭐' : '⚠️'))}</span>
          <span class="grow"><b>${esc(r.reason)}</b><small>${RR.timeOf(r.created_at)}${who(r)}${r.kind === 'redeem' ? ' · prize' : ''}</small></span>
          <span class="pts-pill ${cls}">${signed(r.points)}</span>
          <button class="icon-btn" data-del-row="${r.id}" aria-label="Remove">🗑️</button></li>`;
      }
      $('#history').innerHTML = html + '</ul>';
    }
    $('#load-older').hidden = state.olderDone;
  }

  $('#filters').addEventListener('click', e => {
    const c = e.target.closest('[data-f]');
    if (!c) return;
    state.filter = c.dataset.f;
    $$('#filters .chip').forEach(x => x.classList.toggle('on', x === c));
    renderHistory();
  });

  $('#history').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-row]');
    if (!b) return;
    const r = state.ledger.find(x => x.id === b.dataset.delRow);
    const msg = r.kind === 'redeem'
      ? `This gives back ${-r.points} points (use it if the prize was redeemed by mistake).`
      : `Only for fixing a mistake: removes this entry and its ${Math.abs(r.points)} points.`;
    if (!await confirmSheet(`Remove “${r.reason}”?`, msg, 'Remove', 'red')) return;
    const { error } = await db.from('ledger').delete().eq('id', r.id);
    if (error) { toast(friendly(error), { warn: true }); return; }
    state.ledger = state.ledger.filter(x => x.id !== r.id);
    toast('Removed'); loadAll();
  });

  $('#load-older').addEventListener('click', async () => {
    const oldest = state.ledger[state.ledger.length - 1];
    let q = db.from('ledger').select('*').order('created_at', { ascending: false }).limit(100);
    if (oldest) q = q.lt('created_at', oldest.created_at);
    const { data, error } = await q;
    if (error) { toast(friendly(error), { warn: true }); return; }
    state.ledger = state.ledger.concat(data);
    if (data.length < 100) state.olderDone = true;
    renderHistory();
    if (!data.length) toast('That’s everything — no older history.');
  });

  // ---------------------------------------------------------------- setup
  function kidLink() {
    return new URL('kid.html#' + state.settings.kid_token, location.href).href;
  }

  function renderSetup() {
    $('#behavior-admin').innerHTML = grouped().map(g => `<li class="day-head" style="border:0;padding-bottom:0">${g.title}</li>` +
      (g.items.map((b, i) => `<li>
      <span class="emo">${esc(b.emoji)}</span>
      <span class="grow"><b>${esc(b.name)}</b><small>+${b.points} pts · ${b.once_daily ? 'once a day' : 'any time'}</small></span>
      <button class="icon-btn" data-move="${b.id}" aria-label="Move up" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>⬆️</button>
      <button class="icon-btn" data-edit-b="${b.id}" aria-label="Edit">✏️</button></li>`).join('')
      || '<li class="muted" style="display:block">None yet.</li>')).join('');
    if (!state.settings) return;
    const url = state.settings.avatar_url;
    $('#avatar-thumb').innerHTML = url ? `<img src="${esc(url)}" alt="">` : '🧑‍🚀';
    $('#avatar-remove').hidden = !url;
    const jp = $('#journal-points');
    $('#journal-points-row').hidden = !('journal_points' in state.settings);
    if (document.activeElement !== jp) jp.value = state.settings.journal_points;
    const nameInput = $('#kid-name');
    if (document.activeElement !== nameInput) nameInput.value = state.settings.kid_name;
    $('#kid-link').textContent = kidLink();
    $('#open-kid-link').href = kidLink();
  }

  $('#behavior-admin').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-b]');
    if (ed) { behaviorSheet(state.behaviors.find(b => b.id === ed.dataset.editB)); return; }
    const mv = e.target.closest('[data-move]');
    if (!mv) return;
    // Move up within its own section, then renumber everything section by section.
    const groups = grouped().map(g => g.items);
    const items = groups.find(g => g.some(b => b.id === mv.dataset.move));
    const i = items.findIndex(b => b.id === mv.dataset.move);
    [items[i - 1], items[i]] = [items[i], items[i - 1]];
    const list = groups.flat();
    state.behaviors = list;
    renderSetup(); renderTiles();
    const results = await Promise.all(list.map((b, k) => b.sort === k + 1 ? null : db.from('behaviors').update({ sort: k + 1 }).eq('id', b.id)));
    if (results.some(r => r && r.error)) toast('Could not save the new order', { warn: true });
    loadAll();
  });

  $('#btn-add-behavior').addEventListener('click', () => behaviorSheet(null));

  function behaviorSheet(b) {
    const isNew = !b;
    b = b || { name: '', emoji: '⭐', points: 3, once_daily: true, category: 'home' };
    let emoji = b.emoji, category = catOf(b);
    const s = sheet(`<h3>${isNew ? '⭐ New behavior' : '✏️ Edit behavior'}</h3>
      <label class="field"><span>What did he do?</span><input class="input" name="name" maxlength="60" value="${esc(b.name)}" placeholder="e.g. Made his bed"></label>
      <label class="field"><span>Points</span>
        <div class="stepper"><button type="button" data-step="-1">−</button><input class="input" name="points" type="number" inputmode="numeric" min="1" value="${b.points}"><button type="button" data-step="1">+</button></div></label>
      <div class="field"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">Section</span>
        <div class="chips">${GROUPS.map(g => `<button type="button" class="chip" data-cat="${g.key}">${g.title}</button>`).join('')}</div></div>
      <label class="toggle"><span><b>Once a day</b><small>Blocks a second award on the same day</small></span>
        <span class="switch"><input type="checkbox" name="once" ${b.once_daily ? 'checked' : ''}><i></i></span></label>
      <div class="field"><span style="display:block;font-weight:600;font-size:14px">Icon</span>
        <div class="emoji-row">${EMOJIS.map(x => `<button type="button" data-emoji="${x}">${x}</button>`).join('')}</div></div>
      <p class="err"></p>
      <div class="btns">${isNew ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn red" data-del>Delete</button>'}<button class="btn" data-save>Save</button></div>`);
    stepper(s.el);
    const paint = () => s.el.querySelectorAll('[data-emoji]').forEach(x => x.classList.toggle('on', x.dataset.emoji === emoji));
    if (!EMOJIS.includes(emoji)) s.el.querySelector('.emoji-row').insertAdjacentHTML('afterbegin', `<button type="button" data-emoji="${esc(emoji)}">${esc(emoji)}</button>`);
    s.el.querySelectorAll('[data-emoji]').forEach(x => x.addEventListener('click', () => { emoji = x.dataset.emoji; paint(); }));
    paint();
    const paintCat = () => s.el.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x.dataset.cat === category));
    s.el.querySelectorAll('[data-cat]').forEach(x => x.addEventListener('click', () => { category = x.dataset.cat; paintCat(); }));
    paintCat();
    s.on('[data-save]', async btn => {
      const name = s.el.querySelector('[name=name]').value.trim();
      const points = parseInt(s.el.querySelector('[name=points]').value, 10);
      const once_daily = s.el.querySelector('[name=once]').checked;
      if (!name) { s.err('Give it a name.'); return; }
      if (!(points > 0)) { s.err('Points must be at least 1.'); return; }
      btn.disabled = true;
      const row = { name, points, once_daily, emoji, category };
      if (isNew) row.sort = Math.max(0, ...state.behaviors.map(x => x.sort)) + 1;
      const { error } = isNew ? await db.from('behaviors').insert(row) : await db.from('behaviors').update(row).eq('id', b.id);
      btn.disabled = false;
      if (error) { s.err(friendly(error)); return; }
      s.close(); toast(isNew ? 'Behavior added ⭐' : 'Saved ✅'); loadAll();
    });
    s.on('[data-del]', async () => {
      if (!await confirmSheet(`Delete “${b.name}”?`, 'Points he already earned for it stay in his balance and history.', 'Delete', 'red')) return;
      const { error } = await db.from('behaviors').delete().eq('id', b.id);
      if (error) { toast(friendly(error), { warn: true }); return; }
      s.close(); toast('Behavior deleted'); loadAll();
    });
  }

  // Profile photo: upload, save on the settings row, then tidy up the old file.
  $('#avatar-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('#avatar-thumb').textContent = '⏳';
    try {
      const url = await uploadImage(file);
      await saveAvatar(url);
    } catch (err) {
      toast('Could not upload that photo: ' + friendly(err), { warn: true });
      renderSetup();
    }
  });

  $('#avatar-remove').addEventListener('click', async () => {
    if (!await confirmSheet('Remove the profile photo?', 'The rocket icon shows instead.', 'Remove', 'red')) return;
    saveAvatar(null);
  });

  async function saveAvatar(url) {
    const old = state.settings.avatar_url;
    const { error } = await db.from('settings').update({ avatar_url: url }).eq('id', 1);
    if (error) {
      if (url) removeImage(url);
      toast(/avatar_url/.test(error.message) ? 'Run supabase/add-avatar.sql in Supabase first (see README).' : friendly(error), { warn: true });
      renderSetup();
      return;
    }
    if (old && old !== url) removeImage(old);
    toast(url ? 'Profile photo saved 📸' : 'Photo removed');
    loadAll();
  }

  stepper($('#journal-points-row'), 0);
  $('#save-journal-points').addEventListener('click', async () => {
    const n = parseInt($('#journal-points').value, 10);
    if (!(n >= 0 && n <= 50)) { toast('Pick 0 to 50 points.'); return; }
    const { error } = await db.from('settings').update({ journal_points: n }).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast(n ? `He’ll earn +${n} for sharing his day 📝` : 'Journal points turned off'); loadAll();
  });

  $('#save-kid-name').addEventListener('click', async () => {
    const name = $('#kid-name').value.trim();
    if (!name) return;
    const { error } = await db.from('settings').update({ kid_name: name }).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('Name saved ✅'); loadAll();
  });

  $('#copy-kid-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(kidLink()); toast('Link copied 📋'); }
    catch { toast('Press and hold the link to copy it.'); }
  });

  $('#new-kid-link').addEventListener('click', async () => {
    if (!await confirmSheet('Make a new link?', 'The old kid link stops working. You’ll need to open the new link on his device.', 'Make new link')) return;
    const { error } = await db.from('settings').update({ kid_token: crypto.randomUUID() }).eq('id', 1);
    if (error) { toast(friendly(error), { warn: true }); return; }
    toast('New link ready 🔄'); loadAll();
  });

  // ---------------------------------------------------------------- journal
  const store = {
    get(k) { try { return localStorage.getItem('rr.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('rr.' + k, v); } catch { /* private mode */ } }
  };
  const newestJournal = () => state.journal.reduce((m, j) => j.updated_at > m ? j.updated_at : m, '');
  const journalUnread = () => !!state.journal.length && newestJournal() > (store.get('journalSeen') || '');
  const QUICK_REPLIES = ['So proud of you! ⭐', 'Love you, buddy! ❤️', 'Thanks for telling us 🤗', 'Let’s talk about it tonight 💬', 'That made us smile! 😄'];

  function renderJournal() {
    if (state.tab === 'journal' && state.journal.length) store.set('journalSeen', newestJournal());
    const unread = journalUnread();
    $('#journal-dot').hidden = !unread;
    const latest = state.journal[0];
    $('#journal-banner').hidden = !unread;
    if (unread) $('#journal-banner').innerHTML = `<span class="emo">${RR.mood(latest.mood).emoji}</span>
      <span class="grow"><b>${esc(kidName())} wrote about his day</b><small>Tap to read it 📝</small></span><span>›</span>`;

    $('#journal-title').textContent = `💬 ${kidName()}’s journal`;
    if (state.journalMissing) {
      $('#journal-week').innerHTML = '';
      $('#journal-list').innerHTML = `<div class="card"><b>One quick step:</b> run <code>supabase/add-journal.sql</code> in Supabase’s SQL Editor to turn on the journal (see the README).</div>`;
      return;
    }

    // Mood strip for the last 7 days
    const byDay = Object.fromEntries(state.journal.map(j => [j.day, j]));
    const today = localDay();
    $('#journal-week').innerHTML = RR.last7().map(d => `<div class="mood-day${d === today ? ' today' : ''}">
      <span class="m">${byDay[d] ? RR.mood(byDay[d].mood).emoji : '·'}</span><span class="d">${d === today ? 'Today' : RR.shortDay(d)}</span></div>`).join('');

    $('#journal-list').innerHTML = state.journal.length ? state.journal.map(j => {
      const m = RR.mood(j.mood);
      return `<article class="card j-entry mood-${esc(j.mood)}">
        <div class="j-head"><span class="j-mood">${m.emoji}</span>
          <span class="grow"><b>Feeling ${esc(m.label.toLowerCase())}</b><small>${RR.dayLabel(j.day)} · ${RR.timeOf(j.updated_at)}</small></span></div>
        ${j.prompt ? `<p class="j-prompt">💭 ${esc(j.prompt)}</p>` : ''}
        <p class="j-body">${j.body ? esc(j.body) : '<span class="muted">(Just a feeling today, no words.)</span>'}</p>
        ${j.parent_reply
          ? `<div class="j-reply"><small>💌 ${esc((j.replied_by || 'You').split('@')[0])} wrote back</small><p>${esc(j.parent_reply)}</p>
               <button class="btn sm ghost" data-reply="${j.id}">✏️ Edit reply</button></div>`
          : `<button class="btn sm pink" data-reply="${j.id}">💌 Write back</button>`}
      </article>`;
    }).join('') : `<div class="card empty">Nothing yet. When ${esc(kidName())} writes about his day on his dashboard, it shows up here.</div>`;
  }

  $('#journal-banner').addEventListener('click', () => goTab('journal'));

  $('#journal-list').addEventListener('click', e => {
    const b = e.target.closest('[data-reply]');
    if (!b) return;
    const j = state.journal.find(x => x.id === b.dataset.reply);
    const s = sheet(`<h3>💌 Write back to ${esc(kidName())}</h3>
      <p class="muted" style="margin-top:0">He’ll see this on his dashboard with a little celebration.</p>
      <label class="field"><textarea class="input" name="reply" rows="3" maxlength="500" placeholder="Your message…">${esc(j.parent_reply || '')}</textarea></label>
      <div class="chips">${QUICK_REPLIES.map(r => `<button type="button" class="chip" data-quick="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <p class="err"></p>
      <div class="btns"><button class="btn ghost" data-close>Cancel</button><button class="btn pink" data-save>Send 💌</button></div>`);
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
      s.close(); toast(reply ? 'Sent 💌' : 'Reply removed'); loadAll();
    });
  });

  // ---------------------------------------------------------------- tabs
  function goTab(name) {
    state.tab = name;
    $$('.nav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === name));
    $$('[data-tab]').forEach(sec => { sec.hidden = sec.dataset.tab !== name; });
    window.scrollTo({ top: 0 });
    if (name === 'journal') renderJournal();
  }
  $$('.nav [data-go]').forEach(btn => btn.addEventListener('click', () => goTab(btn.dataset.go)));

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

  function confirmSheet(title, body, yes, color = 'green') {
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
