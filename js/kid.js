// The Clubhouse — Jaylen's player dashboard (kid.html).
//
// No login: the secret in the link (kid.html#<secret>) is passed to the
// kid_dashboard() database function, which returns a read-only snapshot.
// From here he can only (1) rate himself on the Game Plan ("file his
// scouting report") and (2) answer today's postgame question. His ratings
// never award XP (his parents' ratings do), and he can't redeem.

(() => {
  const { client: db, esc, $, $$, localDay, icon, fmt, store, toast } = RR;
  const POLL_MS = 15000;

  // ---------------------------------------------------------------- chrome
  $$('.js-mark').forEach(el => { el.outerHTML = RR.brandMark(el.closest('.topbar') ? 'brand-mark' : 'hero-mark'); });
  [['clubhouse', 'clubhouse', 'Clubhouse'], ['lineup', 'lineup', 'Game Plan'], ['locker', 'locker', 'Prize Locker'], ['stats', 'stats', 'Stats']]
    .forEach(([id, ic, text]) => { $('#nav-' + id).innerHTML = icon(ic) + `<span>${text}</span>`; });

  function message(title, body) {
    $('#k-msg-title').textContent = title;
    $('#k-msg-body').textContent = body;
    $('#k-msg').hidden = false;
    $('#k-app').hidden = true;
  }

  if (!RR.configured) { message('Almost ready', 'The Clubhouse isn’t connected to its database yet.'); return; }

  // Remember the secret so the home-screen icon keeps working without the #.
  const fromHash = decodeURIComponent(location.hash.slice(1)).trim();
  if (/^[0-9a-f-]{36}$/i.test(fromHash)) store.set('kidToken', fromHash);
  const token = store.get('kidToken');
  if (!token) { message('Ask a parent', 'Ask Mom or Dad to open your Clubhouse link on this device.'); return; }

  let data = null;
  let first = true;
  let tab = 'clubhouse';

  async function load() {
    const { data: d, error } = await db.rpc('kid_dashboard', { p_token: token });
    if (error) { if (!data) message('No signal', 'Couldn’t reach the Clubhouse. Check the internet and try again.'); return; }
    if (!d) { message('Ask a parent', 'This link is old. Ask Mom or Dad for your new Clubhouse link.'); return; }
    $('#k-msg').hidden = true;
    $('#k-app').hidden = false;
    data = d;
    render();
    celebrate();
    first = false;
  }

  // ---------------------------------------------------------------- render
  let shownBalance = null;
  const model = () => RR.model(data);

  function render() {
    const m = model();
    document.title = `${m.name} · The Clubhouse`;
    const draft = getDraft();
    const canRate = Array.isArray(data.self);   // database has the Game Plan

    // Clubhouse
    $('#k-card').innerHTML = RR.baseballCard(m);
    $('#k-xp').innerHTML = RR.xpHero(m);
    const bal = $('#k-xp .js-bal');
    if (shownBalance !== null && shownBalance !== m.balance) { bal.dataset.v = shownBalance; RR.countTo(bal, m.balance); }
    shownBalance = m.balance;
    $('#k-bar').innerHTML = RR.xpBar(m);

    // Header: his XP and streak, always in view.
    $('#k-top').innerHTML = `<span class="hchip">${icon('bolt')}<b>${fmt(m.balance)}</b>XP</span>` +
      (m.streak ? `<span class="hchip hot">${icon('flame')}<b>${m.streak}</b></span>` : '');

    // Dugout: tonight's scouting report, the latest reply, the next prize.
    // (Today's question has its own big card above.)
    const cards = [];
    const answered = (data.journal || []).some(j => j.day === localDay());
    const needsReport = canRate && !m.filedAt && m.lineup.length > 0;
    if (needsReport) {
      cards.push(RR.dcard({ color: 'yellow', kicker: 'Scouting report', ic: 'stats', title: 'Rate your day',
        body: `How did you show up at home, in learning and on the field? Rate yourself on ${m.lineup.length} standards.`, attrs: 'data-go="lineup"' }));
    }
    const reply = (data.journal || []).find(j => j.parent_reply);
    if (reply) cards.push(RR.dcard({ color: 'peach', kicker: 'From Mom & Dad', ic: 'message', title: 'Coach’s note', body: esc(reply.parent_reply) }));
    cards.push(RR.ondeckCard(m));
    const live = (('journal' in data && !answered) ? 1 : 0) + (needsReport ? 1 : 0);
    // On the Lineup tab, a pointer back to today's question until it's answered.
    $('#k-lineup-pg').innerHTML = 'journal' in data && !answered
      ? RR.dcard({ color: 'lav', kicker: 'Postgame interview', ic: 'mic', title: 'Today’s question is up', body: esc(RR.promptFor(localDay())), attrs: 'data-postgame' }) : '';
    $('#k-dugout').innerHTML = `<div class="dug-head"><h2>Dugout</h2><span class="count">${live}<small>to do</small></span></div>
      <div class="dugout">${cards.join('')}</div>`;

    // Tabbed card: today's Game Plan (his rating and his parents'), scoreboard, highlights.
    const planPane = `<div class="pane-head">${RR.diamond(m)}<button class="btn sm" data-go="lineup">${needsReport ? 'Rate yourself' : 'Game Plan'}</button></div>` +
      RR.gameSummary(m, 'You');
    $('#k-tabs').innerHTML = RR.tabcard('club', [
      { key: 'lineup', label: 'Today’s Game Plan', html: planPane },
      { key: 'score', label: 'Scoreboard', html: RR.scoreboard(m) + '<div style="margin-top:12px">' + RR.statGrid(m) + '</div>' },
      { key: 'high', label: 'Highlights', html: RR.highlights(m) }
    ]);

    // Game Plan: rate yourself, then file your scouting report.
    $('#k-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const picks = m.lineup.filter(b => (draft[b.id] != null ? draft[b.id] : b.self) != null).length;
    const changed = m.lineup.some(b => draft[b.id] != null && draft[b.id] !== b.self);
    $('#k-summary').innerHTML = `<div class="report-bar">
        <div><span class="label">Tonight’s scouting report</span><b class="num" style="font-size:28px">${picks}<small style="font-size:15px;color:var(--muted)"> / ${m.lineup.length} rated</small></b></div>
        ${m.filedAt ? `<span class="rpill r1">${icon('check', 'sm')}Filed${m.filedAt !== 'yes' ? ' ' + RR.timeOf(m.filedAt) : ''}</span>` : ''}</div>
      <p class="muted" style="margin:10px 0 0;font-size:13.5px">This is how we show up. Rate yourself on each standard, honestly. Great players know where they stand. Mom &amp; Dad add their rating, and theirs earns the XP.</p>`;
    $('#k-groups').innerHTML = canRate
      ? RR.gamePlan(m, 'kid', { draft }) + (picks && (changed || !m.filedAt)
        ? `<div class="file-bar"><button class="btn block" data-file>${icon('check')}${m.filedAt ? 'Update my report' : `File my scouting report · ${picks}/${m.lineup.length}`}</button></div>`
        : m.filedAt ? `<div class="filed-note">${icon('check', 'sm')}Report filed. Change any rating to update it.</div>` : '')
      : '<div class="panel empty">The Game Plan is coming soon.</div>';
    renderJournal();

    // Prize Locker
    $('#k-bal').textContent = fmt(m.balance);
    $('#k-ondeck').innerHTML = RR.ondeck(m);
    $('#k-locker').innerHTML = m.rewards.map(r => RR.lockerItem(r, m.balance, 'kid')).join('')
      || '<div class="panel empty" style="grid-column:1/-1">The locker is being stocked.</div>';

    // Stats
    $('#k-box').innerHTML = RR.scoreboard(m);
    $('#k-season').innerHTML = RR.statGrid(m, true);
    $('#k-trophies').innerHTML = RR.trophyCase(m);
    $('#k-ladder').innerHTML = RR.basepath(m);
    $('#k-log').innerHTML = RR.gameLogRows(m.recent.slice(0, 25));
  }

  // ---------------------------------------------------------------- scouting report
  // His picks are kept on the device until he files them.
  const selfKey = () => 'selfdraft.' + localDay();
  function getDraft() { try { return JSON.parse(store.get(selfKey()) || '{}'); } catch { return {}; } }
  function setDraft(d) { store.set(selfKey(), JSON.stringify(d)); }

  function pick(id, level) {
    const d = getDraft();
    d[id] = level;
    setDraft(d);
    render();
  }

  async function fileReport(btn) {
    const m = model(), d = getDraft();
    const ratings = {};
    m.lineup.forEach(b => { const v = d[b.id] != null ? d[b.id] : b.self; if (v != null) ratings[b.id] = v; });
    btn.disabled = true; btn.textContent = 'Filing…';
    const { data: saved, error } = await db.rpc('kid_self_report', { p_token: token, p_day: localDay(), p_ratings: ratings });
    if (error) {
      toast(/Failed to fetch|Load failed|NetworkError/i.test(error.message) ? 'No internet right now. Your picks are saved. Try again in a minute.' : error.message, { warn: true });
      render();
      return;
    }
    data.self = (data.self || []).filter(q => q.day !== localDay()).concat(saved || []);
    setDraft({});
    render();
    RR.burst(30);
    toast('Report filed. Mom & Dad will add their ratings.');
  }

  // ---------------------------------------------------------------- postgame interview
  // While he's writing, the 15-second refresh leaves the form alone, and the
  // draft is kept on the device so closing the app doesn't lose it.
  let jEditing = false;
  const jToday = () => (data.journal || []).find(j => j.day === localDay());
  const draftKey = () => 'draft.' + localDay();
  const journalPaidToday = () => data.recent.some(r => r.kind === 'journal' && r.day === localDay());

  function renderJournal() {
    const box = $('#k-j');
    const on = 'journal' in data;   // database not upgraded yet → hide
    $('#k-q').hidden = !on;
    if (!on) return;
    const today = jToday();
    const earn = data.journal_points > 0 && !journalPaidToday();
    $('#k-q').classList.toggle('done', !!today && !jEditing);
    $('#k-q-head').innerHTML = `${icon('mic', 'oa-mic')}
      <div class="oa-top"><span class="onair"><i></i>${today && !jEditing ? 'Wrapped' : 'On air'}</span>
        <span class="oa-k">Postgame Interview</span>${earn ? `<span class="oa-xp">+${data.journal_points} XP</span>` : ''}</div>
      <span class="oa-label">Today’s question</span>
      <h2 class="oa-q">${esc(RR.promptFor(localDay()))}</h2>`;
    if (jEditing && box.querySelector('form')) return;  // don't disturb him mid-sentence
    if (!today || jEditing) { jEditing = true; box.innerHTML = journalForm(today); wireForm(box); }
    else box.innerHTML = journalDone(today);
    box.insertAdjacentHTML('beforeend', pastEntries());
  }

  function journalForm(today) {
    let draft = {};
    try { draft = JSON.parse(store.get(draftKey()) || '{}'); } catch { /* ignore */ }
    const moodNow = draft.mood || (today && today.mood) || '';
    const body = draft.body != null ? draft.body : (today ? today.body : '');
    return `<form>
      <span class="label">How are you feeling?</span>
      <div class="moods">${RR.MOODS.map(m => `<button type="button" class="mood${m.key === moodNow ? ' on' : ''}" data-mood="${m.key}">
        <span>${m.emoji}</span>${m.label}</button>`).join('')}</div>
      <textarea class="input" name="body" rows="3" maxlength="1000" placeholder="Type your answer…">${esc(body)}</textarea>
      <p class="err"></p>
      <button class="btn block" type="submit" ${moodNow ? '' : 'disabled'}>${icon('mic')}Send my answer</button>
      ${today ? '<button type="button" class="btn ghost block" data-cancel style="margin-top:8px">Never mind</button>' : ''}
    </form>`;
  }

  function wireForm(box) {
    const form = box.querySelector('form');
    let moodNow = (form.querySelector('.mood.on') || {}).dataset?.mood || '';
    const saveDraft = () => store.set(draftKey(), JSON.stringify({ mood: moodNow, body: form.body.value }));
    form.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => {
      moodNow = b.dataset.mood;
      form.querySelectorAll('[data-mood]').forEach(x => x.classList.toggle('on', x === b));
      form.querySelector('[type=submit]').disabled = false;
      saveDraft();
    }));
    form.body.addEventListener('input', saveDraft);
    const cancel = form.querySelector('[data-cancel]');
    if (cancel) cancel.addEventListener('click', () => { jEditing = false; store.set(draftKey(), ''); renderJournal(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';
      const { data: saved, error } = await db.rpc('kid_save_journal', {
        p_token: token, p_day: localDay(), p_mood: moodNow, p_prompt: RR.promptFor(localDay()), p_body: form.body.value.trim()
      });
      if (error) {
        form.querySelector('.err').textContent = /Failed to fetch|Load failed|NetworkError/i.test(error.message)
          ? 'No internet right now. Try again in a minute. Your answer is saved.' : error.message;
        btn.disabled = false; btn.innerHTML = icon('mic') + 'Send my answer';
        return;
      }
      data.journal = [saved].concat((data.journal || []).filter(j => j.day !== saved.day));
      store.set(draftKey(), '');
      jEditing = false;
      render();
      // XP earned: reload so the balance updates and the "+2 XP" celebration shows.
      if (saved.points_awarded) load();
      else toast('Sent. Thanks for sharing.');
    });
  }

  function journalDone(j) {
    const m = RR.mood(j.mood);
    const hard = ['sad', 'frustrated', 'worried'].includes(j.mood);
    return `<div>
      <div class="pg-head"><span class="m">${m.emoji}</span><div><b>Feeling ${esc(m.label.toLowerCase())}</b><small>${icon('check', 'sm')} Sent to Mom &amp; Dad</small></div></div>
      ${j.body ? `<div class="pg-text">“${esc(j.body)}”</div>` : ''}
      <p class="oa-note">${hard ? 'Thanks for telling us how you feel. Tough days happen to every player. We’ve got you.' : 'Thanks for sharing your day.'}</p>
      ${j.parent_reply ? `<div class="pg-reply"><span class="label">Mom &amp; Dad replied</span><p>${esc(j.parent_reply)}</p></div>` : ''}
      <button class="btn ghost sm" data-edit-journal>${icon('edit')}Change my answer</button>
    </div>`;
  }

  function pastEntries() {
    const past = (data.journal || []).filter(j => j.day !== localDay()).slice(0, 5);
    if (!past.length) return '';
    return `<details class="oa-past"><summary>Earlier interviews · ${past.length}</summary><ul class="list">${past.map(j => `<li style="align-items:flex-start">
      <span class="mark" style="font-size:18px">${RR.mood(j.mood).emoji}</span>
      <span class="grow"><b>${RR.dayLabel(j.day)}</b>${j.prompt ? `<small style="display:block;font-style:italic">${esc(j.prompt)}</small>` : ''}
      ${j.body ? `<small style="display:block;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2)">${esc(j.body)}</small>` : ''}
      ${j.parent_reply ? `<small style="display:block;color:var(--gold);margin-top:4px">Reply: ${esc(j.parent_reply)}</small>` : ''}</span></li>`).join('')}</ul></details>`;
  }

  // ---------------------------------------------------------------- celebrations
  // New XP since he last looked, level-ups, newly unlocked prizes, and replies.
  function celebrate() {
    const m = model();
    let seen, unlockedBefore, replies;
    try {
      seen = new Set(JSON.parse(store.get('seen') || '[]'));
      unlockedBefore = new Set(JSON.parse(store.get('unlocked') || '[]'));
      replies = JSON.parse(store.get('replies') || '{}');
    } catch { seen = new Set(); unlockedBefore = new Set(); replies = {}; }
    const unlockedNow = m.rewards.filter(r => m.balance >= r.cost);
    const journal = data.journal || [];
    const lastLevel = store.get('level');

    // First visit on this device: remember where things stand, no fireworks.
    if (!first || store.get('seen')) {
      const fresh = data.recent.filter(r => r.points > 0 && r.kind !== 'redeem' && !seen.has(r.id));
      const sum = rows => rows.reduce((a, r) => a + r.points, 0);
      // Mom & Dad rated his day.
      const ratings = fresh.filter(r => r.kind === 'earn' && r.level);
      if (ratings.length) {
        const n = l => ratings.filter(r => r.level === l).length;
        const parts = [[3, 'All-Star'], [2, 'Strong'], [1, 'Solid']].filter(([l]) => n(l)).map(([l, t]) => `${n(l)} ${t}`);
        RR.celebrate({ kicker: 'Scouting report', title: `+${sum(ratings)} XP`, medal: n(3) ? 'star' : '', big: n(3) > 0,
          body: `Mom & Dad rated your day: ${parts.join(' · ')}.` });
      }
      // A moment they noticed.
      fresh.filter(r => r.kind === 'moment').slice(0, 3).forEach(r =>
        RR.celebrate({ kicker: 'Moment recognized', title: `+${r.points} XP`, medal: 'star', body: r.reason }));
      const other = fresh.filter(r => !(r.kind === 'earn' && r.level) && r.kind !== 'moment');
      if (other.length === 1) {
        RR.celebrate({ kicker: 'XP earned', title: `+${other[0].points} XP`, body: other[0].reason });
      } else if (other.length > 1) {
        RR.celebrate({ kicker: 'XP earned', title: `+${sum(other)} XP`, body: `${other.length} new highlights. Keep stacking wins.` });
      }
      if (lastLevel !== null && m.level.idx > Number(lastLevel)) {
        RR.celebrate({ kicker: 'Level up', title: m.level.name, medal: 'shield', big: true,
          body: m.level.next ? `Next stop: ${m.level.next.name} at ${fmt(m.level.next.min)} lifetime XP.` : 'Top of the game. Hall of Famer.' });
      }
      unlockedNow.filter(r => !unlockedBefore.has(r.id)).forEach(r =>
        RR.celebrate({ kicker: 'Prize unlocked', title: r.name, image: r.image_url, big: true, body: 'Ask a parent to redeem it from the Prize Locker.' }));
      journal.filter(j => j.parent_reply && replies[j.id] !== j.parent_reply).slice(0, 2).forEach(j =>
        RR.celebrate({ kicker: 'Postgame Interview', title: 'Mom & Dad replied', body: j.parent_reply, ok: 'Got it' }));
    }

    store.set('seen', JSON.stringify(data.recent.map(r => r.id)));
    store.set('unlocked', JSON.stringify(unlockedNow.map(r => r.id)));
    store.set('replies', JSON.stringify(Object.fromEntries(journal.filter(j => j.parent_reply).map(j => [j.id, j.parent_reply]))));
    store.set('level', String(m.level.idx));
  }

  // ---------------------------------------------------------------- navigation + taps
  function goTab(name) {
    tab = name;
    $$('.nav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === name));
    $$('[data-tab]').forEach(sec => { sec.hidden = sec.dataset.tab !== name; });
    window.scrollTo({ top: 0 });
  }

  RR.wireUI($('#k-app'));
  $('#k-app').addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-self],[data-file],[data-postgame],[data-edit-journal]');
    if (!t) return;
    if (t.dataset.go) goTab(t.dataset.go);
    else if (t.dataset.self) pick(t.dataset.self, +t.dataset.level);
    else if ('file' in t.dataset) fileReport(t);
    else if ('postgame' in t.dataset) { goTab('clubhouse'); $('#k-q').scrollIntoView({ block: 'start' }); }
    else if ('editJournal' in t.dataset) { jEditing = true; $('#k-j').innerHTML = ''; renderJournal(); }
  });

  load();
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
