# AGENTS.md — 菇菇宅配網

## Architecture

- **No build system.** Every `.html` file is self-contained (inline CSS + JS). Edit HTML files directly; there is no `package.json`, no bundler, no `npm`.
- **Supabase backend** (PostgreSQL, Auth, Storage, Edge Functions). All DB writes go through the single Edge Function (`supabase/functions/admin-actions/index.ts`), which uses the service role key — no client-side writes against Supabase RLS.
- **Frontend** is vanilla JS served from **GitHub Pages**: `https://yyyiying.github.io/pikmin_app/`
- CDN dependencies per page: Tailwind CSS (`cdn.tailwindcss.com`), Supabase JS SDK v2, plus page-specific libs like `html2canvas` and `compressorjs`.

## File map

| File | Purpose |
|------|---------|
| `index.html` | Login page |
| `dashboard.html` | Main hub: challenges, signups, leaderboard, music player, wishing well |
| `guest.html` | No-account guest zone (guest challenges + self-fly posts) |
| `admin.html` | Admin panel: user management, DB stats |
| `gallery.html` | Public postcard gallery (`guest_postcards` table) |
| `postcard.html` | Member postcard library (`postcards` table) |
| `partner.html` | Friend code directory |
| `radar.html` | Mushroom location radar (`radar_posts` table) |
| `gpx_generator.html` | GPX route generator |
| `monitor.html` | DB resource monitoring |
| `migration.html` | Admin tool: migrate postcards from library to gallery |
| `dedupe.html` | Admin tool: deduplicate postcards |
| `supabase/functions/admin-actions/index.ts` | **Single Edge Function** — all backend logic lives here (Deno) |

## Commands

```bash
# Deploy the Edge Function (run from repo root)
npx supabase functions deploy admin-actions

# Run locally (no dev server needed for HTML — just open in browser, or):
npx serve .
```

The `.vscode/launch.json` expects a local server on port 8080.

## Login system (dual-track)

The login in `index.html` converts the nickname to a virtual email, trying two formats:
1. **New format:** `{hex_encoded_nickname}@pikmin.sys` (UTF-8 → hex)
2. **Old format (fallback):** `{url_encoded_clean_nickname}@pikmin.sys` (symbols stripped)

When changing nicknames, the Edge Function updates the Supabase Auth email to the new hex format (`user-update-nickname` action, `index.ts:2096`).

## Edge Function structure

The `admin-actions` function dispatches on `action` field. The file is organized as:

1. **Public actions** (no auth): scheduled emails, cleanup, guest CRUD, radar reads, public postcards
2. **Auth wall** at line ~1871: all actions below require a valid Supabase JWT
3. **Authenticated actions**: nickname change, subscriptions, wishes, postcard CRUD, radar admin, toggle check-in

Guest users are identified by **IP fingerprint** (SHA-1 hash of `clientIp + 'SALT_2025'`), not auth.

## Cron & notifications

`.github/workflows/cron.yml` calls the Edge Function every 30 minutes during Taiwan daytime (UTC 0–15 = TW 08:00–23:30):
- `cleanup-expired` — deletes dispatched challenges (10h), guest challenges (12h), old self-fly posts, and orphaned images

**Required secrets:**
- GitHub: `SECRET_KEY` (Supabase service role key)
- Supabase Edge Function env: `SUPABASE_URL`, `SECRET_KEY`, `PUBLIC_KEY`

## Gotchas

- **Guest daily limit** is shared across `challenges` and `guest_fly_posts` tables (10 combined/day per IP).
- **Guest signup overflow:** guests can join beyond `slots` up to `slots + 2` (waitlist), capped at 3 concurrent waitlist entries per guest.
- **`is_checked_in`** is the "checked in" flag on signups — toggled by the host (not boolean-safe, uses `!!` coercion in Edge Function).
- **Image cleanup** is manual in the Edge Function: when updating/deleting records with new images, old Storage files must be explicitly deleted. URL parsing strips `?token=` query params to extract filenames.
- **Coordinate deduplication:** both `postcards` and `radar_posts` enforce unique coordinates at the Edge Function level.
- **No `.gitignore` exists.** The `.supabase` directory and `.temp/` files should be added.
- **Windows path separators:** this repo is developed on Win11. Use forward slashes in HTML references (as-is).
- **Supabase anon key** is hardcoded in all HTML files — this is intentional (public key, no security risk).
