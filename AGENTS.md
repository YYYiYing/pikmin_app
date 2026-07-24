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

## Key changes (post-initial-AGENTS.md)

### Source classification
- `postcards.source` and `guest_postcards.source` (text DEFAULT '') — classify images as 巨大花/蘑菇/探測器
- Pill buttons in gallery + postcard forms for source selection
- Source badge on every card (左上角)
- Source filter row: All / 巨大花 / 蘑菇 / 探測器
- Old tags (大花點/蘑菇點/蘑菇/探測器) migrated to `source` column, then removed from `tags`
- Image selector in dashboard/guest modals filters to `source='蘑菇'` only (library query + gallery tab filters)

### Quick publish flow
- Postcard/gallery cards show 「🍄 發布」button **only when `source='蘑菇'` or empty/no source**
- **Members**: redirects to `dashboard.html?quickImg=...` → dashboard auto-fills file input, triggers `postChallengeButton.click()` for proper modal init
- **Guests**: opens publish chooser modal (自飛菇 / 大聲公), redirects to `guest.html?quickImg=...&type=fly|loudspeaker&quickCoord=...`
  - `type=fly`: auto-fills image + coordinate fields, opens fly modal
  - `type=loudspeaker`: auto-fills image, opens guest challenge modal
- Passes `quickCoord` for 自飛菇 so guest doesn't have to re-enter coordinates

### Checked-in auto-full
- Edge Function: `toggle-signup-checked-in` checks `checked_in_count >= 4` — if so, auto-fills remaining slots from waitlist (backfill)
- RPC `cancel_signup_and_update_challenge`: also checks `checked_in_count >= 4` before backfilling
- Frontend: `effectiveStatus` calculated client-side — if `status='open'` but `checked_in_count >= slots`, shows as full
- Waitlist UI/logic REMOVED from frontend (no quota, no absent, no stand-by status display)

### Removed features
- **Waitlist UI**: quota display, absent score, stand-by status, waitlist count in card footer — all removed
- **Email notification system**: dashboard subscription buttons, Edge Function 6 actions (scheduled-email-notify, scheduled-full-notify, update-subscription, send-test-email, trigger-check-now, get-subscriber-counts), cron.yml entries, admin.html notification UI, docs references. RESEND_API_KEY constant removed from Edge Function.
- **Default slot 4→6**: new challenges default to 6 slots

### Sorting
- Card sorting: open challenges first, then by signup count (most signups first), then by challenge ID
- Comment display: inline text with CSS overflow hidden → icon fallback when text too long (dashboard + guest comment section)

### Bug fixes
- Removed TypeScript `: any` syntax from all HTML JS files (causes SyntaxError in browsers)
- Quick publish: must call `postChallengeButton.click()` to ensure identities/time/remembered-settings are initialized before setting file input
- `quickPublishFromGallery` stores coord alongside imgUrl

### Database migrations
- `MIGRATION_REMOVE_WAITLIST.sql`: RPC changes for checked-in >=4 logic, waitlist removal
- Source column added via ALTER TABLE (no migration file — done manually in Supabase SQL editor)
- Tag migration: UPDATE guest_postcards/postcards SET source = ... based on tags, then tags = array_remove(tags, ...)

### Reference files (not served, for AI context)
- `GALLERY_POSTCARD_ANALYSIS.md` — analysis of gallery vs postcard relationship
- `CODE_REFERENCE.md` — cross-file code reference
- `DASHBOARD_ANALYSIS.md` — dashboard features analysis

### Host release signup
- Edge Function `host-remove-signup`: host removes a participant's signup, freeing up a slot. Full auth check (host_id === user.id). Deletes signup record, recalculates challenge status (same auto-full logic as toggle-signup-checked-in: `checked_in_count >= 4 → 已額滿`).
- Dashboard: each participant row shows 「釋出」button (red, subtle) next to「已入」for the host. Confirm dialog before removal. No penalty to the removed user.

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
- **git policy**: NO automatic push. Only commit/push when user explicitly says. User deploys via `/deploy` or direct instruction.
