# Vagacoin (VGC) — Private Fiat-Backed Digital Treasury PWA

Vagacoin (VGC) is a zero-cost, closed-loop digital treasury and append-only PostgreSQL ledger for a private friend group or committee (chit-fund style).

- **Fixed Peg:** `1 VGC = 1 PKR` (configured in `src/lib/format.js` via `PEG_PKR_PER_VGC = 1` and `group_settings.peg`).
- **Golden Invariant:** `Total Minted - Total Burned = Sum(All Member Ledger Balances) = Active Supply = Real Cash (PKR / peg)`.
- **Dual-Mode Execution:** Automatically runs in **Demo Mode** (full LocalStorage transaction engine with 5 seeded members) when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not configured, and switches seamlessly to **Live Supabase Mode** once `.env` variables are provided.

## 1. Quick Start (Demo Mode)

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. With no `.env` file present, the app boots into **Demo Mode** with 5 seeded members (`Ali Raza` as Admin, `Ayesha Khan`, `Hamza Sheikh`, `Fatima Noor`, `Usman Tariq`), demo PIN `1234`, and invite code `VAGA2026`.

## 2. Live Supabase Setup (Zero-Cost Free Tier)

1. **Create a Supabase Project:** Create a new free-tier project at [supabase.com](https://supabase.com).
2. **Run the Database Schema:**
   - Open the **SQL Editor** in your Supabase Dashboard.
   - Paste the entire contents of `supabase/schema.sql` and click **Run**.
   - Optionally update the initial invite code in `group_settings`:
     ```sql
     UPDATE public.group_settings SET invite_code = 'YOUR_SECRET_CODE' WHERE id = true;
     ```
3. **Turn OFF Email Confirmation (Recommended for Private Group):**
   - Go to **Authentication -> Providers -> Email** in Supabase Dashboard.
   - Toggle **OFF** `"Confirm email"` so members can sign up immediately with the group invite code without hitting Supabase Free Tier hourly email rate limits.
4. **Create the Admin Account:**
   - The **first user** to sign up with the valid invite code is automatically assigned `role = 'admin'` by the `handle_new_user()` trigger. All subsequent signups become `member`.
5. **Configure Environment Variables:**
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings -> API**.

## 3. GitHub Actions Keep-Alive Setup

Supabase pauses free-tier projects after 7 days of inactivity.
1. In your GitHub repository, go to **Settings -> Secrets and variables -> Actions**.
2. Add two Repository Secrets:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your Supabase anon public key
3. `.github/workflows/keep-alive.yml` runs every 4 days (`0 3 */4 * *`) and calls `POST /rest/v1/rpc/get_ping`.
4. *Note:* GitHub disables scheduled workflows after 60 days of repository inactivity (re-enable in the Actions tab or push a commit periodically), and you should also open the Supabase Dashboard occasionally.

## 4. Deployment & PWA Installation

- **Vercel / Netlify:** Import the repository, set build command `npm run build`, output directory `dist`, and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **GitHub Pages:** If deploying under a subpath (`https://user.github.io/vagacoin/`), set `base: '/vagacoin/'` in `vite.config.js`.
- **Add to Home Screen (PWA):**
  - On iOS Safari: Tap **Share -> Add to Home Screen**.
  - On Android Chrome: Tap **Menu -> Install App / Add to Home Screen**.
  - *Icon Note:* `public/manifest.json` uses `/icons/icon.svg` with `"sizes": "any"`. For older Android WebAPK installers, you can optionally add 192x192 and 512x512 PNG icons alongside the SVG.

## 5. Known Limitations (By Design for Zero Cost)

- **No Web-Push / SMS Gateways:** All notifications are delivered in-app via the `notifications` table + Supabase Realtime + toast alerts + unread bell counter.
- **No Server-Side Background Workers:** All ledger mutations, PIN lockouts, remainder-exact splits, escrow settlements, and Golden Invariant checks execute atomically inside PostgreSQL `SECURITY DEFINER` RPCs.
