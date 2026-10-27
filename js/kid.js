// Reward Rocket — Jaylen's view-only dashboard (kid.html).
//
// No login: the secret in the link (kid.html#<secret>) is passed to the
// kid_dashboard() database function, which returns a read-only snapshot.
// Nothing on this page can change points.

(() => {
  const { client: db, esc, $, localDay, stats, nextPrize, pct, confetti, signed } = RR;
  const POLL_MS = 15000;
  const store = {
    get(k) { try { return localStorage.getItem('rr.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('rr.' + k, v); } catch { /* private mode */ } }
  };

  RR.starfield();

  function message(title, body) {
    $('#k-msg-title').textContent = title;
    $('#k-msg-body').textContent = body;
    $('#k-msg').hidden = false;
    $('#k-app').hidden = true;
  }

  if (!RR.configured) { message('Almost ready!', 'Reward Rocket isn’t connected to its database yet.'); return; }

  // Remember the secret so the home-screen icon keeps working without the #.
  const fromHash = decodeURIComponent(location.hash.slice(1)).trim();
  if (/^[0-9a-f-]{36}$/i.test(fromHash)) store.set('kidToken', fromHash);
  const token = store.get('kidToken');
  if (!token) { message('Ask Mom or Dad!', 'Ask them to open your special Reward Rocket link on this device.'); return; }

  let data = null;
  let first = true;

  async function load() {
    const { data: d, error } = await db.rpc('kid_dashboard', { p_token: token });
    if (error) { if (!data) message('Lost signal 📡', 'Couldn’t reach Mission Control. Check the internet and try again.'); return; }
    if (!d) { message('Ask Mom or Dad!', 'This link is old. Ask them for your new Reward Rocket link.'); return; }
    $('#k-msg').hidden = true;
    $('#k-app').hidden = false;
    data = d;
    render();
    celebrate();
    first = false;
  }

  function render() {
    const { kid_name, balance, behaviors, rewards, recent } = data;
    document.title = `${kid_name}’s Reward Rocket 🚀`;
    $('#k-hi').textContent = `Hi ${kid_name}! 👋`;
    const av = $('#k-avatar');
    av.classList.toggle('photo', !!data.avatar_url);
    av.innerHTML = data.avatar_url ? `<img src="${esc(data.avatar_url)}" alt="">` : '🪐';
    RR.countTo($('#k-bal'), balance);

    const st = stats(recent);
    $('#k-today').innerHTML = st.todayPts
      ? `You earned <b>${st.todayPts}</b> point${st.todayPts === 1 ? '' : 's'} today! 🎉`
      : 'Earn some points today! 💪';

    // Mission toward the next prize
    const next = nextPrize(rewards, balance);
    if (next) {
      const p = pct(balance, next.cost);
      $('#k-mission-title').textContent = `🚀 Mission: ${next.name}`;
      $('#k-goal').innerHTML = next.image_url ? `<img src="${esc(next.image_url)}" alt="">` : esc(next.emoji);
      $('#k-fill').style.width = p + '%';
      $('#k-rocket').style.left = p + '%';
      const left = next.cost - balance;
      $('#k-left').innerHTML = `Only <b>${left}</b> more point${left === 1 ? '' : 's'} to go!`;
    } else {
      $('#k-mission-title').textContent = rewards.length ? '🏆 Mission complete!' : '🚀 Next mission';
      $('#k-goal').textContent = '🏆';
      $('#k-fill').style.width = '100%';
      $('#k-rocket').style.left = '100%';
      $('#k-left').textContent = rewards.length ? 'You have enough for any prize! Ask Mom or Dad! 🎉' : 'Prizes are coming soon!';
    }

    // Week
    const today = localDay();
    const max = Math.max(5, ...Object.values(st.perDay));
    $('#k-week').innerHTML = st.days.map(d => `<div class="col${d === today ? ' today' : ''}">
      <span class="v">${st.perDay[d] ? '⭐' + st.perDay[d] : ''}</span>
      <span class="b" style="height:${Math.round(st.perDay[d] / max * 100)}%"></span>
      <span class="d">${d === today ? 'Today' : RR.shortDay(d)}</span></div>`).join('');

    // Prizes
    $('#k-prizes').innerHTML = rewards.map(r => {
      const ready = balance >= r.cost;
      return `<article class="prize${ready ? ' ready' : ''}">
        ${ready ? '<span class="badge">Unlocked! 🔓</span>' : ''}
        <div class="pic">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy">` : esc(r.emoji)}</div>
        <div class="body">
          <div class="row"><span class="nm">${esc(r.name)}</span><span class="cost">⭐ ${r.cost}</span></div>
          <div class="bar${ready ? ' full' : ''}"><i style="width:${pct(balance, r.cost)}%"></i></div>
          <div class="left">${ready ? 'You can get this! Ask Mom or Dad 🎉' : `${r.cost - balance} more points`}</div>
        </div></article>`;
    }).join('') || '<div class="card empty">Prizes are coming soon!</div>';

    // Ways to earn
    const doneToday = new Set(recent.filter(r => r.kind === 'earn' && r.day === today).map(r => r.behavior_id));
    const way = b => `<li class="${b.once_daily && doneToday.has(b.id) ? 'done' : ''}">
      <span class="emo">${esc(b.emoji)}</span>
      <span class="grow"><b>${esc(b.name)}</b>${b.once_daily ? '<small>once a day</small>' : ''}</span>
      <span class="pts-pill plus">+${b.points}</span></li>`;
    const sports = behaviors.filter(b => b.category === 'sports');
    $('#k-ways').innerHTML = behaviors.filter(b => b.category !== 'sports').map(way).join('');
    $('#k-sports').innerHTML = sports.map(way).join('');
    $('#k-sports-card').hidden = !sports.length;

    // Team points this week: earned from sports behaviors.
    const sportIds = new Set(sports.map(b => b.id));
    const wk = RR.weekStart().getTime();
    const teamPts = recent.filter(r => r.kind === 'earn' && sportIds.has(r.behavior_id) && new Date(r.created_at).getTime() >= wk)
      .reduce((a, r) => a + r.points, 0);
    $('#k-team').innerHTML = teamPts
      ? `You earned <b>${teamPts}</b> team points this week! Great teammates make great teams. 🙌`
      : 'Hustle, be a great teammate and play with heart. That’s how you earn team points! 💪';

    renderJournal();

    // Recent
    const wins = recent.slice(0, 12);
    $('#k-recent').innerHTML = wins.length ? wins.map(r => `<li>
      <span class="emo">${esc(r.emoji || (r.points > 0 ? '⭐' : '⚠️'))}</span>
      <span class="grow"><b>${esc(r.kind === 'redeem' ? 'Got a prize: ' + r.reason : r.reason)}</b><small>${RR.dayLabel(r.day)}</small></span>
      <span class="pts-pill ${r.kind === 'redeem' ? 'prize' : r.points > 0 ? 'plus' : 'minus'}">${signed(r.points)}</span></li>`).join('')
      : '<li class="empty" style="display:block">Your wins will show up here! 🌟</li>';
  }

  // ----- Journal: how he's feeling + the question of the day
  // While he's writing, the 15-second refresh leaves the form alone, and the
  // draft is kept on the device so closing the app doesn't lose it.
  let jEditing = false;
  const jToday = () => (data.journal || []).find(j => j.day === localDay());
  const draftKey = () => 'draft.' + localDay();
  const journalPaidToday = () => data.recent.some(r => r.kind === 'journal' && r.day === localDay());

  function renderJournal() {
    const box = $('#k-j');
    if (!('journal' in data)) { $('#k-journal').hidden = true; return; }  // database not upgraded yet
    $('#k-journal').hidden = false;
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
    return `<form class="k-j-form">
      <p class="k-j-q">💭 ${esc(RR.promptFor(localDay()))}</p>
      ${data.journal_points > 0 && !journalPaidToday() ? `<p class="k-j-earn">⭐ Earn +${data.journal_points} points for sharing your day!</p>` : ''}
      <p class="k-j-label">How are you feeling?</p>
      <div class="mood-grid">${RR.MOODS.map(m => `<button type="button" class="mood-btn${m.key === moodNow ? ' on' : ''}" data-mood="${m.key}">
        <span>${m.emoji}</span>${m.label}</button>`).join('')}</div>
      <textarea class="input" name="body" rows="4" maxlength="1000" placeholder="Write your answer here…">${esc(body)}</textarea>
      <p class="err"></p>
      <button class="btn pink block" type="submit" ${moodNow ? '' : 'disabled'}>🚀 Send to Mom &amp; Dad</button>
      ${today ? '<button type="button" class="btn ghost block" data-cancel style="margin-top:8px">Never mind</button>' : ''}
    </form>`;
  }

  function wireForm(box) {
    const form = box.querySelector('form');
    let moodNow = (form.querySelector('.mood-btn.on') || {}).dataset?.mood || '';
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
      btn.disabled = true; btn.textContent = 'Sending… 🚀';
      const { data: saved, error } = await db.rpc('kid_save_journal', {
        p_token: token, p_day: localDay(), p_mood: moodNow, p_prompt: RR.promptFor(localDay()), p_body: form.body.value.trim()
      });
      if (error) {
        form.querySelector('.err').textContent = /Failed to fetch|Load failed|NetworkError/i.test(error.message)
          ? 'No internet right now. Try again in a minute — your words are saved.' : error.message;
        btn.disabled = false; btn.textContent = '🚀 Send to Mom & Dad';
        return;
      }
      data.journal = [saved].concat((data.journal || []).filter(j => j.day !== saved.day));
      store.set(draftKey(), '');
      jEditing = false;
      renderJournal();
      // Points earned: reload so the balance updates and the "+2 points!" party shows.
      if (saved.points_awarded) load();
      else confetti(['💛', '⭐', '✨', RR.mood(saved.mood).emoji], 30);
    });
  }

  function journalDone(j) {
    const m = RR.mood(j.mood);
    const hard = ['sad', 'frustrated', 'worried'].includes(j.mood);
    return `<div class="k-j-done">
      <div class="k-j-sent">✅ Sent to Mom &amp; Dad!</div>
      <div class="k-j-mood">${m.emoji}<span>Feeling ${esc(m.label.toLowerCase())}</span></div>
      ${j.body ? `<p class="k-j-text">${esc(j.body)}</p>` : ''}
      <p class="k-j-note">${hard ? 'Thanks for telling us how you feel. We love you, always. ❤️' : 'Thanks for sharing your day! 💛'}</p>
      ${j.parent_reply ? `<div class="j-reply"><small>💌 Mom &amp; Dad wrote back</small><p>${esc(j.parent_reply)}</p></div>` : ''}
      <button class="btn ghost block" data-edit-journal>✏️ Change my answer</button>
    </div>`;
  }

  function pastEntries() {
    const past = (data.journal || []).filter(j => j.day !== localDay()).slice(0, 5);
    if (!past.length) return '';
    return `<p class="k-j-label" style="margin-top:18px">Earlier days</p><ul class="list">${past.map(j => `<li style="align-items:flex-start">
      <span class="emo">${RR.mood(j.mood).emoji}</span>
      <span class="grow"><b>${RR.dayLabel(j.day)}</b>${j.body ? `<small class="k-j-past">${esc(j.body)}</small>` : ''}
      ${j.parent_reply ? `<small class="k-j-past-reply">💌 ${esc(j.parent_reply)}</small>` : ''}</span></li>`).join('')}</ul>`;
  }

  $('#k-j').addEventListener('click', e => {
    if (!e.target.closest('[data-edit-journal]')) return;
    jEditing = true;
    $('#k-j').innerHTML = '';
    renderJournal();
  });

  // ----- Celebrations: new points since he last looked, and newly unlocked prizes
  const queue = [];
  function celebrate() {
    const seen = new Set(JSON.parse(store.get('seen') || '[]'));
    const unlockedBefore = new Set(JSON.parse(store.get('unlocked') || '[]'));
    const unlockedNow = data.rewards.filter(r => data.balance >= r.cost);
    const fresh = data.recent.filter(r => r.points > 0 && !seen.has(r.id));

    if (!first || store.get('seen')) {
      if (fresh.length === 1) {
        const r = fresh[0];
        queue.push({ emoji: r.emoji || '⭐', title: `+${r.points} points!`, body: r.reason });
      } else if (fresh.length > 1) {
        const total = fresh.reduce((a, r) => a + r.points, 0);
        queue.push({ emoji: '🌟', title: `+${total} points!`, body: `You earned ${fresh.length} awards. Way to go!` });
      }
      unlockedNow.filter(r => !unlockedBefore.has(r.id)).forEach(r =>
        queue.push({ emoji: r.emoji, image: r.image_url, title: 'Prize unlocked! 🔓', body: `You have enough points for ${r.name}! Ask Mom or Dad.`, big: true }));
    }

    // A new (or changed) reply from Mom or Dad.
    let replies = {};
    try { replies = JSON.parse(store.get('replies') || '{}'); } catch { /* ignore */ }
    const journal = data.journal || [];
    if (!first || store.get('seen')) {
      journal.filter(j => j.parent_reply && replies[j.id] !== j.parent_reply).slice(0, 2).forEach(j =>
        queue.push({ emoji: '💌', title: 'Mom & Dad wrote back!', body: j.parent_reply }));
    }
    store.set('replies', JSON.stringify(Object.fromEntries(journal.filter(j => j.parent_reply).map(j => [j.id, j.parent_reply]))));

    store.set('seen', JSON.stringify(data.recent.map(r => r.id)));
    store.set('unlocked', JSON.stringify(unlockedNow.map(r => r.id)));
    if ($('#k-party').hidden) nextParty();
  }

  function nextParty() {
    const p = queue.shift();
    if (!p) { $('#k-party').hidden = true; return; }
    $('#k-party-emoji').innerHTML = p.image ? `<img src="${esc(p.image)}" alt="">` : esc(p.emoji);
    $('#k-party-title').textContent = p.title;
    $('#k-party-body').textContent = p.body;
    $('#k-party').hidden = false;
    confetti(p.big ? ['🎉', '🎁', '⭐', '🚀', '🌈'] : undefined, p.big ? 70 : 40);
  }
  $('#k-party-ok').addEventListener('click', nextParty);

  load();
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
