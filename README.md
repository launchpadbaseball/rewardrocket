# Reward Rocket 🚀

A points-and-prizes app for Jaylen. Mom and Dad each sign in from their own phones and share one account. Jaylen gets his own view-only dashboard.

- **Parent app** (`index.html`): award points in one tap, add bonus points or take points away (with a reason), redeem prizes, see history and weekly progress, and edit behaviors and prizes.
- **Kid dashboard** (`kid.html#…`): points, a rocket progress track toward his next prize, his week, prizes, ways to earn points, and celebrations when he earns points or unlocks a prize. It is view-only.

**How it's built:** plain HTML, CSS and JavaScript with no build step. **Supabase** (free tier) provides the database, logins, prize-photo storage and live sync. **Netlify** (free tier) hosts the site.

---

## Make it live (about 20 minutes)

### Step 1: Create the database (Supabase)

1. Go to **https://supabase.com** and sign up (free).
2. Click **New project**. Name it `reward-rocket`, pick any database password (you won't need it again) and the region closest to you, then click **Create**. Wait about a minute for it to finish.
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
4. **Jaylen's dashboard:** in the app, go to **⚙️ Setup → Kid's dashboard**. Tap **Open** on his tablet or phone, or copy the link and send it to his device, then add it to his home screen the same way. The device remembers his link after that.

That's it. 🎉

---

## Daily use

| You want to… | Do this |
|---|---|
| Award points | **🚀 Award** tab → tap the behavior. Mis-tapped? Tap **Undo** in the pop-up. |
| Give a bonus / take points away | **➕ Bonus points** or **➖ Take away** → amount → reason |
| Redeem a prize | **🎁 Prizes** → **Redeem** (only lights up when he has enough points) |
| Fix a mistake from earlier | **📜 History** → 🗑️ next to the entry (this gives back or removes its points) |
| Add/edit/remove behaviors | **⚙️ Setup** → ✏️ or **＋ Add behavior** (⬆️ moves one up the list) |
| Add a prize with a photo | **🎁 Prizes** → **＋ Add prize** → **📷 Choose photo** (or edit a prize with ✏️) |

**Duplicate protection:**
- Behaviors marked **Once a day** (ready for school, homework, chores, bedtime and good behavior at school) can only be earned once per day. The tile turns green with ✓ Done today. The database enforces this, so it holds even if both of you tap at the same moment.
- "Any time" behaviors (kindness, respect, and so on) can be earned several times a day. If one is tapped again within 90 seconds, the app asks "Award again?" first.
- You can switch any behavior between **Once a day** and **Any time** in Setup.

**Sync:** changes show up on the other parent's phone within a second or two. The **● Live** dot in the corner shows the connection is up. Jaylen's dashboard refreshes every 15 seconds.

**Weeks** run Sunday to Saturday.

---

## Security, in plain words

- All data is stored in your Supabase database, so nothing is lost when you refresh or switch phones.
- The database only lets in the emails listed in the `parents` table. Everyone else sees nothing, even with a valid login.
- Jaylen's link contains a long random secret. It can **only read** a summary and can't change anything. If the link ever gets shared by accident, tap **🔄 New link** in Setup and the old link stops working.
- Prize photos are stored with hard-to-guess file names. Anyone holding a photo's exact link could view that photo.

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
  kid.html              Jaylen's dashboard
  css/app.css, kid.css  styles
  js/config.js          ← your Supabase URL + publishable key go here
  js/common.js          shared helpers
  js/parent.js          parent app logic
  js/kid.js             kid dashboard logic
  supabase/setup.sql    database setup (run once in the SQL Editor)
  vendor/               the Supabase JavaScript library (bundled, so no outside CDN is needed)
  icons/, manifest.webmanifest   home-screen icon
  netlify.toml          hosting settings
```
