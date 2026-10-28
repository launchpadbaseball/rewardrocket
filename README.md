# The Clubhouse

**Earn Your Wins.**

A player-development app for Jaylen. Mom and Dad each sign in on their own phones and share one account. Jaylen gets his own player dashboard. It's built to feel like a baseball video game: he earns XP, levels up and unlocks prizes.

**Parent app** (`index.html`)
- **Clubhouse:** his player card, check-ins waiting for approval, today's lineup, his stats, the next unlock and recent highlights.
- **Lineup:** tap any item to award XP (two taps from opening the app). Bonus XP lives here too.
- **Prize Locker:** add prizes with product photos, set XP costs and redeem.
- **Stats:** weekly box score, season stats, the Trophy Case, Road to the Hall, his Postgame Interviews (read and reply) and the full game log.
- **Front Office** (gear icon): player card (photo, name, jersey #, position), lineup and XP values, postgame XP, his dashboard link and your account.

**Player dashboard** (`kid.html#…`)
- The same four tabs, built for him: player card, today's lineup, stats, Prize Locker, Trophy Case.
- **I did it:** he taps this on a lineup item. It shows as **Pending Approval** until a parent approves it (which awards the XP) or declines it.
- **Postgame Interview:** a new question each day. He picks how he's feeling and writes an answer. Answering earns XP (+2 by default), once a day.
- **Celebrations** for XP earned, level-ups, unlocked prizes and your replies.
- **Limits:** he can't award XP, redeem prizes or change anything else.

**XP and levels**
- **XP balance** is what he spends in the Prize Locker. XP only goes up, except when a prize is redeemed. A mistaken award can still be undone.
- **Levels** come from **lifetime XP**, so redeeming a prize never lowers his level: Rookie (0), Prospect (100), Starter (300), All-Star (600), MVP (1,200), Hall of Famer (2,500).
- **Trophy Case:** First Pitch, Hot Streak (3 days), Iron Man (7 days), Double Digits (10 tasks), Grinder (50 tasks), Team Player (10 on-field awards), Closer (first prize) and Postgame Pro (7 interviews).
- **Lineup categories:** **Home & School** and **On the Field**. On the Field is about his approach to the game, not his stats.

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

## Daily use

| You want to… | Do this |
|---|---|
| Award XP | **Lineup** → tap the item. Mis-tapped? Tap **Undo** in the pop-up. |
| Approve his check-ins | **Clubhouse** → **Pending Approval** → **Approve** (or ✕ to decline). Tapping the item in the Lineup also approves it. |
| Give bonus XP | **Lineup** → **Bonus XP** → amount → reason |
| Redeem a prize | **Prize Locker** → **Redeem** (only lit up once he has enough XP) |
| Fix a mistake | **Stats → Game Log** → trash icon next to the entry |
| Edit the lineup / XP values | gear → **Lineup & XP Values** (or **Lineup → Edit lineup**) |
| Add a prize with a photo | **Prize Locker → Add prize → Choose photo** (edit one with the pencil) |
| Read and reply to his answers | **Stats → Postgame Interviews → Reply** (a new one also shows on the Clubhouse) |
| Jersey #, position, photo | gear → **Player Card** |

**Duplicate protection:**
- **Once a day items** can only be earned once per day, and show **Completed** after that. The database enforces this, so it holds even if both of you tap at the same moment.
- **Any time items** can be earned several times a day. A second tap within 90 seconds asks "Award again?" first.

**Sync:** changes show up on the other parent's phone within a second or two (the **● Live** dot shows the connection). His dashboard refreshes every 15 seconds.

**Weeks** run Sunday to Saturday.

---

## Security, in plain words

- All data is stored in your Supabase database, so nothing is lost when you refresh or switch phones.
- The database only lets in the emails listed in the `parents` table. Everyone else sees nothing, even with a valid login.
- Jaylen's link contains a long random secret. It can read his dashboard, check in a lineup item for **your approval**, and save **his own postgame answer for today**. It can't award XP, redeem prizes or change anything else.
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
