# Odin

"From people you know, not platforms." A social recommendation app: users save
places/services/products/advice and see what their friends have saved —
word-of-mouth, not algorithmic feed.

## Stack

- **Frontend**: Plain HTML/CSS/JS, no build step, no framework, no
  `package.json`. Everything ships as static files served directly.
  - `index.html` — app shell / markup
  - `app.js` — all frontend logic (single file, ~11k+ lines, organized with
    `// ===== SECTION =====` banner comments — grep those to navigate)
  - `styles.css` — all styling
  - `sw.js` — service worker, network-first with cache fallback (PWA offline
    support). Cache name is versioned (`odin-vN-*`) — bump it whenever shell
    assets change or clients will keep serving stale files.
  - `manifest.json` — PWA manifest
- **Backend / DB**: Supabase (Postgres + Auth). Client initialized in
  `app.js` near the top (`SUPABASE_URL` / `SUPABASE_KEY` / `supabaseClient`).
- **Workflow backend**: n8n (`stanmak.app.n8n.cloud`), called via webhooks
  for anything that needs server-side processing:
  - `search123` — search
  - `capture` — saving/creating a new item (title/type resolution,
    embeddings)
  - `translate-card` — comment/card translation
  - `og-fetch` — Open Graph metadata fetch
  - `delete-account` — deletes the Supabase Auth record server-side
  - `search-feedback` — search feedback loop
- **Geocoding**: Mapbox (address autocomplete in the capture flow)
- **DB migrations**: raw SQL files at repo root (e.g.
  `migration_get_friend_saved_item_ids_v2.sql`), applied manually via the
  Supabase SQL editor — there is no migration runner/CLI in this repo.

## Core domain concepts

- **Knowledge items** (`knowledge_items` table) — the things people save
  (places, services, products, advice), with `added_by`, `visibility`
  (e.g. `friends`), and semantic search over content.
- **Friendships** — direct, bidirectional (`requester_id`/`receiver_id` +
  `status`), enforced via invitation tokens at signup.
- **Endorsements** — a friend saving/backing an existing item (separate
  from adding it originally).
- **Save / bookmark** — unified with the endorsement system.
- **Private Lists (Model A)** — a separate save-like verb, intentionally
  distinct from "Save"/endorsements. Don't merge these concepts.
- **"THE WORD"** — the personal note shown on a card: the saving user's own
  note, or (if viewing via a friend) the friend's note. Warm/styled/italic
  treatment in the UI — this is a deliberate product detail, not
  incidental styling.
- **Save Inheritance / friend-saved surfacing** — items a *friend's* friend
  saved get surfaced via `get_friend_saved_item_ids`, but only if not
  already visible through the user's own direct-friend feed (see the
  migration SQL for the exact dedup logic — don't re-surface items twice).
- **Founding Members account** (`id: fec29546-cabd-44c7-96c9-4dfa6e952e93`)
  — seed account new testers are auto-connected to, so first search never
  returns empty. See "Decisions" below — don't reassign/delete its content
  without checking that log first.
- **Community Notes**, **Notifications**, **Recently Viewed**, **Onboarding
  flow** (4-step, fires once on first login), **Invite link system** — see
  corresponding `// ===== SECTION =====` blocks in `app.js`.

## Decisions log

Historical/product decisions that explain "why," not "what":

- `DATABASE DECISION LOG 28Mar2026.rtf` — Founding Member seed content
  reassignment (why 15 seed entries, why that specific mix of EN/ZH and
  categories, note to review before wider launch).
- Append new decisions here (or as dated entries in that log) rather than
  only in chat — anything that would confuse a future session if
  undocumented belongs in a durable file, not just conversation history.

## Known in-code stopgaps (search before "fixing")

`app.js` contains explicit `STOPGAP` / `TRIPWIRE` comments marking
intentional temporary states, e.g. around line 5078: item visibility limit
widened from 180 to effectively unlimited, with a tripwire noted for when a
user's visible item count exceeds ~1,500. Grep for `STOPGAP` and `TRIPWIRE`
before assuming something is a bug.

## Working conventions

- No build/lint/test tooling is configured in this repo. Treat manual
  in-browser testing as the verification step for UI changes.
- `app.js` and `index.html` are large single files — prefer targeted
  `grep`/section-comment navigation over reading them in full.
- When changing `sw.js` shell assets, bump `CACHE_NAME` so users actually
  get the update.
- SQL changes to Supabase go in a new `migration_*.sql` file at the repo
  root (not applied automatically — must be run manually in the Supabase
  SQL editor); don't edit old migration files in place once they've shipped.

## Requirements not yet captured here

This file was drafted from the existing code/docs in the repo. Project-level
requirements that only exist in your head or in a separate Claude
conversation (business rules, things you've told a different Claude session
that never got written down, hard constraints) are **not** in here yet —
add them below as you think of them so future sessions actually see them.

<!-- Add project requirements / constraints here -->
