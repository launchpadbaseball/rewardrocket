// The Clubhouse — Jaylen's player dashboard (kid.html).
//
// No login: the secret in the link (kid.html#<secret>) is passed to the
// kid_dashboard() database function, which returns a read-only snapshot.
// From here he can only (1) check in a lineup item for a parent to approve
// and (2) answer today's postgame question. He can't award XP or redeem.

(() => {
  const { client: db, esc, $, $$, localDay, icon, fmt, store, toast } = RR;
  const POLL_MS = 15000;

  // ---------------------------------------------------------------- chrome
  $$('.js-mark').forEach(el => { el.outerHTML = RR.brandMark(el.closest('.topbar') ? 'brand-mark' : 'hero-mark'); });
  [['clubhouse', 'clubhouse', 'Clubhouse'], ['lineup', 'lineup', 'Lineup'], ['locker', 'locker', 'Prize Locker'], ['stats', 'stats', 'Stats']]
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
    const mode = m.canRequest ? 'kid-can-request' : 'kid';

    // Clubhouse
    $('#k-card').innerHTML = RR.playerCard(m);
    const bal = $('#k-card .js-bal');
    if (shownBalance !== null && shownBalance !== m.balance) { bal.dataset.v = shownBalance; RR.countTo(bal, m.balance); }
    shownBalance = m.balance;
    const answered = (data.journal || []).some(j => j.day === localDay());
    $('#k-alerts').innerHTML = 'journal' in data && !answered
      ? `<button class="alert" data-postgame>${icon('mic')}<span class="grow"><b>Postgame Interview</b>
          <small>Today’s question is up${data.journal_points > 0 && !journalPaidToday() ? ` · +${data.journal_points} XP` : ''}</small></span>${icon('right', 'sm')}</button>` : '';
    const open = m.lineup.filter(b => b.status !== 'done').sort((a, b) => (a.status === 'pending') - (b.status === 'pending'));
    $('#k-lineup').innerHTML = `<div class="panel">${RR.lineupSummary(m)}</div>` +
      (open.length ? `<div class="lineup" style="margin-top:12px">${open.slice(0, 4).map(b => RR.lineupRow(b, mode, true)).join('')}</div>`
        : '<p class="muted" style="margin:10px 2px 0">Daily lineup complete. Great work today.</p>');
    $('#k-stats').innerHTML = RR.statGrid(m);
    $('#k-unlock').innerHTML = RR.nextUnlock(m);
    $('#k-highlights').innerHTML = RR.highlights(m);

    // Lineup
    $('#k-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    $('#k-summary').innerHTML = `<span class="label" style="margin-bottom:8px">Completed today</span>` + RR.lineupSummary(m) +
      `<p class="muted" style="margin:10px 0 0;font-size:13px">+${m.todayXP} XP today${m.canRequest ? ' · Did something? Tap “I did it” and a parent will approve it.' : ''}</p>`;
    $('#k-groups').innerHTML = RR.lineupGroups(m, mode);
    renderJournal();

    // Prize Locker
    $('#k-bal').textContent = fmt(m.balance);
    $('#k-locker').innerHTML = m.rewards.map(r => RR.lockerItem(r, m.balance, 'kid')).join('')
      || '<div class="panel empty" style="grid-column:1/-1">The locker is being stocked.</div>';

    // Stats
    $('#k-box').innerHTML = RR.boxScore(m);
    $('#k-season').innerHTML = RR.statGrid(m, true);
    $('#k-trophies').innerHTML = RR.trophyCase(m);
    $('#k-ladder').innerHTML = RR.ladder(m);
    $('#k-log').innerHTML = RR.gameLogRows(m.recent.slice(0, 25));
  }

  // ---------------------------------------------------------------- check-ins
  async function request(id, btn) {
    btn.disabled = true;
    const { error } = await db.rpc('kid_request_task', { p_token: token, p_behavior_id: id, p_day: localDay() });
    if (error) {
      btn.disabled = false;
      toast(/Failed to fetch|Load failed|NetworkError/i.test(error.message) ? 'No internet right now. Try again in a minute.' : error.message, { warn: true });
      return;
    }
    data.pending = (data.pending || []).concat({ behavior_id: id, day: localDay() });
    render();
    toast('Sent for approval. Nice work.');
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
    $('#k-journal').hidden = $('#postgame').hidden = !on;
    if (!on) return;
    $('#k-pg-sub').textContent = data.journal_points > 0 ? `+${data.journal_points} XP · once a day` : '';
    const today = jToday();
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
      <span class="label">Today’s question</span>
      <p class="pg-q">${esc(RR.promptFor(localDay()))}</p>
      ${data.journal_points > 0 && !journalPaidToday() ? `<div class="pg-earn">${icon('bolt', 'sm')}+${data.journal_points} XP for your answer</div>` : ''}
      <span class="label">How are you feeling?</span>
      <div class="moods">${RR.MOODS.map(m => `<button type="button" class="mood${m.key === moodNow ? ' on' : ''}" data-mood="${m.key}">
        <span>${m.emoji}</span>${m.label}</button>`).join('')}</div>
      <textarea class="input" name="body" rows="4" maxlength="1000" placeholder="Your answer">${esc(body)}</textarea>
      <p class="err"></p>
      <button class="btn block" type="submit" ${moodNow ? '' : 'disabled'}>Send to Mom &amp; Dad</button>
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
        btn.disabled = false; btn.textContent = 'Send to Mom & Dad';
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
      <span class="label" style="color:var(--green)">Sent to Mom &amp; Dad</span>
      <div class="pg-head" style="margin-top:10px"><span class="m">${m.emoji}</span><div><b>Feeling ${esc(m.label.toLowerCase())}</b><small>${esc(j.prompt || '')}</small></div></div>
      ${j.body ? `<div class="pg-text">${esc(j.body)}</div>` : ''}
      <p class="muted" style="font-size:14px">${hard ? 'Thanks for telling us how you feel. Tough days happen to every player. We’ve got you.' : 'Thanks for sharing your day.'}</p>
      ${j.parent_reply ? `<div class="pg-reply"><span class="label">Mom &amp; Dad replied</span><p>${esc(j.parent_reply)}</p></div>` : ''}
      <button class="btn ghost block" data-edit-journal>Change my answer</button>
    </div>`;
  }

  function pastEntries() {
    const past = (data.journal || []).filter(j => j.day !== localDay()).slice(0, 5);
    if (!past.length) return '';
    return `<div class="day-head" style="margin-top:18px"><span>Earlier interviews</span></div><ul class="list">${past.map(j => `<li style="align-items:flex-start">
      <span class="mark" style="font-size:18px">${RR.mood(j.mood).emoji}</span>
      <span class="grow"><b>${RR.dayLabel(j.day)}</b>${j.body ? `<small style="display:block;white-space:pre-wrap;overflow-wrap:anywhere">${esc(j.body)}</small>` : ''}
      ${j.parent_reply ? `<small style="display:block;color:var(--gold);margin-top:4px">Reply: ${esc(j.parent_reply)}</small>` : ''}</span></li>`).join('')}</ul>`;
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
      if (fresh.length === 1) {
        RR.celebrate({ kicker: 'XP earned', title: `+${fresh[0].points} XP`, body: fresh[0].reason });
      } else if (fresh.length > 1) {
        RR.celebrate({ kicker: 'XP earned', title: `+${fresh.reduce((a, r) => a + r.points, 0)} XP`, body: `${fresh.length} new highlights. Keep stacking wins.` });
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

  $('#k-app').addEventListener('click', e => {
    const t = e.target.closest('[data-go],[data-request],[data-postgame],[data-edit-journal]');
    if (!t) return;
    if (t.dataset.go) goTab(t.dataset.go);
    else if (t.dataset.request) request(t.dataset.request, t);
    else if ('postgame' in t.dataset) { goTab('lineup'); $('#postgame').scrollIntoView(); }
    else if ('editJournal' in t.dataset) { jEditing = true; $('#k-j').innerHTML = ''; renderJournal(); }
  });

  load();
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
