# The Clubhouse

**Earn Your Wins.**

A player-development app for Jaylen. Mom and Dad each sign in on their own phones and share one account. Jaylen gets his own player dashboard. It's built to feel like a baseball video game: he earns XP, levels up and unlocks prizes.

**Parent app** (`index.html`)
- **Clubhouse:** a dashboard.
  - **Baseball card:** his personalized card. Tap it to flip to the stat sheet on the back.
  - **XP and levels:** his XP balance and level, plus a bar showing XP spent, his balance and how far he is from the next level.
  - **Dugout:** his scouting report when he files it, new postgame interviews, the next prize and quick Bonus XP.
  - **Tabbed card:** Today's Game Plan (his rating and yours for every standard, with an infield diamond that fills its bases), Scoreboard and Highlights.
- **Game Plan:** rate each standard for the day, and recognize standout moments. Bonus XP lives here too.
- **Prize Locker:** add prizes with product photos, set XP costs and redeem.
- **Stats:** weekly box score, season stats, the Trophy Case, Road to the Hall, his Postgame Interviews (read and reply) and the full game log.
- **Front Office** (gear icon): player card (photo, name, jersey #, position), the Game Plan standards and their XP, postgame XP, notifications, his dashboard link and your account.

**Player dashboard** (`kid.html#…`)
- The same four tabs, built for him: player card, the Game Plan, stats, Prize Locker, Trophy Case.
- **Scouting report:** each evening he rates himself on every standard and files it. You see his rating next to yours. **Your rating earns the XP; his never does.**
- **Postgame Interview:** a new question each day. He picks how he's feeling and writes an answer. Answering earns XP (+2 by default), once a day.
- **Celebrations** for XP earned, level-ups, unlocked prizes and your replies.
- **Limits:** he can't award XP, redeem prizes or change anything else.

**XP and levels**
- **XP balance** is what he spends in the Prize Locker. XP only goes up, except when a prize is redeemed. A mistaken award can still be undone.
- **Levels** come from **lifetime XP**, so redeeming a prize never lowers his level: Rookie (0), Prospect (100), Starter (300), All-Star (600), MVP (1,200), Hall of Famer (2,500).
- **Trophy Case:** First Pitch, Hot Streak (3 days), Iron Man (7 days), Double Digits (10 tasks), Grinder (50 tasks), Team Player (10 on-field awards), Closer (first prize) and Postgame Pro (7 interviews).
- **The Game Plan** is a guide to how he shows up, not a to-do list. It has three arenas with a few standards each, and every standard says what it looks like:
  - **At Home:** Own Your Responsibilities, and Respect & Kindness.
  - **Learning:** Homework & Study Habits, and Learner's Mindset.
  - **On the Field:** Compete Every Rep, Great Teammate, and Coachable.
- **Daily ratings:** you rate each standard once a day. **Solid / Strong / All-Star** earn 1× / 2× / 3× its XP (+2 / +4 / +6 by default). **Not today** earns nothing.
- **Moments:** **Recognize a moment** adds XP with a note about what he did, such as "helped his sister without being asked".
- **Editing:** edit the standards, their descriptions and their XP in the Front Office.

**How it's built:** plain HTML, CSS and JavaScript with no build step. **Supabase** (free tier) provides the database, logins, photo storage and live sync. **Netlify** (free tier) hosts the site.

---

## Upgrading an existing install

Already using the app? Run each file below that you haven't run yet in Supabase → **SQL Editor → New query → Run**. Each one only *adds* things; no XP, prizes or entries are changed, and each is safe to run twice.

| File | Adds |
|---|---|
| `supabase/add-sports.sql` | the On the Field category and its starter items |
| `supabase/add-avatar.sql` | the player photo |
| `supabase/add-journal.sql` | the Postgame Interview |
| `supabase/add-clubhouse.sql` | **The Clubhouse redesign:** jersey # and position, check-in approvals, and lifetime-XP levels and stats |
| `supabase/add-notifications.sql` | **Notifications:** the bell, pop-ups, and email when Jaylen does something |
| `supabase/add-gameplan.sql` | **The Game Plan:** swaps the old task list for the 7 standards, daily ratings, moments and his scouting report (run after add-notifications.sql) |

New installs only need `setup.sql`.

---

## Make it live (about 20 minutes)

### Step 1: Create the database (Supabase)

1. Go to **https://supabase.com** and sign up (free).
2. Click **New project**. Name it `clubhouse`, pick any database password (you won't need it again) and the region closest to you, then click **Create**. Wait about a minute for it to finish.
3. Open **SQL Editor** in the left sidebar and click **New query**.
4. Open `supabase/setup.sql` from this folder and copy **all** of it into the editor.
5. **Before running**, find these two lines near the top and replace the emails with the ones you and your wife will sign in with:
   ```sql
   ('dad@example.com'),     -- ← change me
   ('mom@example.com')      -- ← change me
   ```
6. Click **Run**. You should see "Success". This creates the tables, the security rules, the 10 starter behaviors and the 3 starter prizes.

### Step 2: Create your two logins

1. In Supabase, go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password, and tick **Auto Confirm User**. Click **Create user**.
3. Repeat for your wife's email. These must be the same two emails you put in step 1.5.
4. **Turn off public sign-ups**: go to **Authentication → Sign In / Providers** (on some dashboards it's **Authentication → Settings**) and switch off **Allow new users to sign up**. (Even with sign-ups on, a stranger's account would see nothing, because only the emails on your parents list can get in. This just keeps things tidy.)

### Step 3: Connect the website to the database

1. In Supabase, go to **Project Settings → API Keys** (or **Settings → API**).
2. Copy the **Project URL** (from **Settings → Data API**, or the top of the API page). It looks like `https://abcdefghijkl.supabase.co`.
3. Copy the **Publishable key** (starts with `sb_publishable_`). On older dashboards, copy the **anon public** key instead.
4. Open `js/config.js` and paste them in:
   ```js
   window.RR_CONFIG = {
     SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
     SUPABASE_KEY: 'sb_publishable_xxxxxxxxxxxx'
   };
   ```
   These two values are safe to publish. **Never** paste the *secret* or *service_role* key here.
5. Commit and push that change (or edit `js/config.js` directly on GitHub). (This is already done for this repository.)

### Step 4: Publish the website (Netlify)

1. Go to **https://app.netlify.com** and sign in with GitHub.
2. Click **Add new site → Import an existing project → GitHub** and pick the `launchpadbaseball/rewardrocket` repository.
3. Leave **Base directory**, **Build command** and **Publish directory** empty, and keep the branch as `main`.
4. Click **Deploy**. You'll get a URL like `https://something-random.netlify.app`.
5. Optional: under **Site configuration → Change site name**, rename it to something like `jaylen-rockets`, which gives you `https://jaylen-rockets.netlify.app`.

> **No-GitHub alternative:** after filling in `js/config.js`, drag this whole folder onto **https://app.netlify.com/drop**. It's live instantly. To update it later, drag the folder again.

### Step 5: Allow password-reset emails to come back to your site

In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to your Netlify address (for example `https://jaylen-rockets.netlify.app`). This makes the "Forgot password?" link work.

### Step 6: Put it on your phones

1. Open the Netlify URL on your phone and sign in. You stay signed in after that.
2. Add it to your home screen so it opens like an app:
   - **iPhone (Safari):** tap Share **⬆︎** → **Add to Home Screen**.
   - **Android (Chrome):** tap **⋮** → **Add to Home screen** (or **Install app**).
3. Send the URL to your wife. She signs in with her own email and password.
4. **Jaylen's player dashboard:** in the app, tap the gear (**Front Office**) → **Player Dashboard Link**. Tap **Open** on his device, or copy the link and send it there, then add it to his home screen the same way. His device remembers the link after that.

---

## Notifications

When Jaylen **files his scouting report** or **answers his Postgame Interview**, you find out three ways:

1. **Bell (top right):** a red badge counts what's new. Tap it for the feed.
2. **Pop-up:** appears on any parent phone that has the app open.
3. **Email:** to each parent who has it switched on. Several taps in a row arrive as **one** email, sent about a minute after he stops tapping.

Each parent controls their own email in the app: gear → **Notifications** → **Email me**. There's also a **Send me a test email** button that shows whether it worked.

### Turning on email (one time, about 10 minutes)

Emails are sent by your database through **Resend**, a free email service (3,000 emails a month).

1. Sign up at **https://resend.com**.
2. **Choose how you'll send:**
   - **To email both of you (recommended):** in Resend, go to **Domains → Add domain** and add a domain you own (for example `hudlup.co`). Copy the DNS records it shows into your domain provider's DNS settings, then wait for it to show **Verified**.
   - **Without a domain:** Resend will only deliver to the email address you signed up to Resend with.
3. In Resend, go to **API Keys → Create API key** (Sending access) and copy it. It starts with `re_`.
4. In Supabase, open **SQL Editor → New query**, paste this with your key and domain, and click **Run**:
   ```sql
   update private.email_settings
     set api_key = 're_your_key_here',
         from_address = 'The Clubhouse <clubhouse@yourdomain.com>';
   ```
   Skipped the domain? Leave out the `from_address` line.
5. In the app, go to gear → **Notifications** → **Send me a test email**. A few seconds later it shows whether the email went through (or Resend's error message if not).

The key is stored in a private part of the database that the website can't read.

---

## Daily use

| You want to… | Do this |
|---|---|
| Rate his day | **Game Plan** → tap Solid, Strong or All-Star on each standard (tap again to change; **Not today** clears it). Mis-tapped? **Undo** in the pop-up. |
| Recognize a moment | **Game Plan** → **Recognize a moment** on the standard → what he did → XP |
| See how he rated himself | **Game Plan** (his rating is on each standard) or the Clubhouse → **Today's Game Plan** |
| Give bonus XP | **Game Plan** → **Bonus XP** → amount → reason |
| Redeem a prize | **Prize Locker** → **Redeem** (only lit up once he has enough XP) |
| Fix a mistake | **Stats → Game Log** → trash icon next to the entry |
| Edit standards / XP | gear → **Game Plan Standards** (or **Game Plan → Edit standards**) |
| Add a prize with a photo | **Prize Locker → Add prize → Choose photo** (edit one with the pencil) |
| Read and reply to his answers | **Stats → Postgame Interviews → Reply** (a new one also shows on the Clubhouse) |
| Jersey #, position, photo | gear → **Player Card** |

**One rating per standard per day:** changing a rating replaces it rather than adding more XP. The database enforces this, so it holds even if both of you tap at the same moment.

**Sync:** changes show up on the other parent's phone within a second or two (the **● Live** dot shows the connection). His dashboard refreshes every 15 seconds.

**Weeks** run Sunday to Saturday.

---

## Security, in plain words

- All data is stored in your Supabase database, so nothing is lost when you refresh or switch phones.
- The database only lets in the emails listed in the `parents` table. Everyone else sees nothing, even with a valid login.
- Jaylen's link contains a long random secret. It can read his dashboard, save **his own ratings for today** (which never award XP), and save **his own postgame answer for today**. It can't award XP, redeem prizes or change anything else.
- Anyone holding his link could read his recent answers, so treat it like a key. If it ever gets shared, tap **New link** in the Front Office and the old link stops working.
- Photos are stored with hard-to-guess file names. Anyone holding a photo's exact link could view that photo.

## Changing who can sign in

Run this in Supabase's SQL Editor, then create the user under Authentication → Users:

```sql
insert into public.parents (email) values ('grandma@example.com');
-- remove someone:
delete from public.parents where email = 'old@example.com';
```

## Costs and limits

Both free tiers are far more than one family needs. One thing to know: **Supabase pauses free projects after 7 days with no activity at all**. Normal daily use keeps it awake. If you take a long break, open your Supabase dashboard and click **Restore project**. Your data is kept.

## Files

```
rewardrocket/
  index.html            parent app
  kid.html              Jaylen's player dashboard
  css/clubhouse.css     the design system (colors, type, player card, lineup, locker…)
  js/config.js          ← your Supabase URL + publishable key go here
  js/common.js          shared logic + components (levels, stats, badges, player card…)
  js/parent.js          parent app
  js/kid.js             player dashboard
  supabase/setup.sql    database setup (run once in the SQL Editor)
  supabase/add-sports.sql  one-time upgrade for databases made before the sports section
  supabase/add-avatar.sql  one-time upgrade for databases made before profile photos
  supabase/add-journal.sql one-time upgrade for databases made before the journal
  supabase/add-clubhouse.sql one-time upgrade for The Clubhouse redesign
  vendor/               the Supabase JavaScript library (bundled, so no outside CDN is needed)
  icons/, manifest.webmanifest   home-screen icon
  netlify.toml          hosting settings
```
