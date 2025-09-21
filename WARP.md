# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Repository overview
- Monorepo managed by pnpm workspaces and Turborepo
- Primary app: apps/ig-poster (TypeScript, Express server with an optional Electron shell)
- Node 18+ required (see package.json engines)

Common commands (run from repo root)
- Install deps
  - pnpm install
- Start server (development)
  - pnpm start  # runs apps/ig-poster via ts-node on IG_POSTER_PORT (default 4011)
  - pnpm --filter @bulkig-pro/ig-poster dev  # alternative direct dev for the app
- Build
  - pnpm build  # turbo run build; compiles apps/ig-poster to dist
- Type check
  - npx tsc -p apps/ig-poster/tsconfig.json --noEmit
- Format
  - pnpm format       # write
  - pnpm format:check # verify only
- Lint
  - pnpm lint  # currently routed through turbo; may no-op until app scripts/config are added
- Tests
  - pnpm test  # placeholder; no tests configured in the workspace at this time
  - Single test: not applicable (no test runner configured)
- Smoke tests (headless end-to-end checks)
  - pnpm smoke-test -- --base http://localhost:4011
  - pnpm smoke-quick -- --base http://localhost:4011
- Utilities
  - pnpm check-ports           # quick availability scan for known ports
  - pnpm migrate               # migrate drafts/settings from original BulkIG install
  - pnpm license:generate you@example.com  # compute a license key for a given email
- Electron shell
  - pnpm -w build && pnpm electron:dev          # run Electron against built dist
  - pnpm dist:win | pnpm dist:mac | pnpm dist:all  # package installers (requires platform tooling)

Environment and ports
- Create .env at repo root (copy from .env.example)
  - Required for typical dev:
    - IG_POSTER_PORT=4011            # main HTTP server (dashboard + API)
    - STATIC_SERVER_PORT=5006        # informational; main server also serves /media and /static
    - INBOX_PATH=C:\IG-Pro\inbox    # folder to watch and serve media from
    - IG_MOCK=true|false             # mock mode skips real API publishing
    - IG_USER_ID=...                 # Instagram Business Account user id (for real posting)
    - FB_LONG_LIVED_PAGE_TOKEN=...   # Facebook Page token (for real posting and FB support)
    - OPENAI_API_KEY=...             # optional, for AI caption features
    - PUBLIC_IMAGE_BASE=...          # optional public base URL (tunnel) for IG/FB media
- Dashboard entrypoint: http://localhost:4011
- Guardrails
  - Use unique, non-conflicting ports per project. Do not bind to 3000 if other apps are running.
  - In this repo, Pro defaults are 4011 (app) and 5006 (static placeholder).

High-level architecture (apps/ig-poster)
- Express server (src/index.ts)
  - Serves dashboard (public/index.html), media (/media, /static), and REST API
  - Endpoints (representative):
    - GET /health  — basic liveness + tunnel status
    - GET /ig/status — scheduler state snapshot (counts, next items)
    - POST /ig/autorun — enable/disable publishing loop
    - POST /ig/plan — compute schedule for queued items
    - GET /ig/schedule-preview — generate upcoming times
    - GET/POST /ig/schedule-config — scheduling mode and parameters
    - POST /ig/post-now — immediate publish for a queued file (video uses tunnel URL if available)
    - POST /ig/schedule-post — schedule a specific file at a given time
    - POST /ig/upload — upload media to INBOX_PATH (supports library-only via ?library=true)
    - DELETE /ig/media/:filename — remove a media file and related SCHEDULED posts
    - GET /ig/video-info/:filename — ffprobe-based metadata (duration, dimensions)
    - GET /ig/saved-media — paginated media library with usage stats
    - GET /ig/history — published history (filterable by date)
    - GET/POST /ig/keywords — manage hashtag keyword categories
    - POST /ig/caption — deterministic caption generator (no external calls required)
    - Drafts & Autopilot: /ig/generate-drafts, /ig/caption-drafts (CRUD), /ig/queue-with-draft, /ig/autopilot-* endpoints
    - Licensing: /license/status, /license/activate
    - Settings: GET/POST /settings (encrypted persistence on disk)
- Scheduler (src/scheduler.ts)
  - Two modes: interval or times-of-day, with day filters
  - Tracks posts in memory (QUEUED→SCHEDULED→PUBLISHING→PUBLISHED/ERROR)
  - Auto-repost tick to recycle posts (opt-in)
- Publisher (src/publisher.ts) + Instagram Graph helpers (src/ig.ts)
  - Pipeline: create container → wait for processing → publish (REELS for videos)
  - Uses Cloudflare tunnel URL for videos when available
  - Optional Facebook posting via local HTTP hop to /fb/publish
- File watcher (src/watcher.ts)
  - Watches INBOX_PATH and auto-queues supported image/video files
- Caption system (src/caption.ts, src/generator.ts, src/keywords.ts)
  - Generates brand-agnostic captions and 10–15 hashtags; supports batch generation and URL-enrichment
- Configuration (src/env.ts)
  - Reads .env at repo root; sets defaults for ports, inbox path, mock mode, and tokens/keys
- Logging (src/logger.ts)
  - In-memory ring + persisted JSON at apps/ig-poster/logs/activity.json
- Persistence locations (no external DB)
  - Drafts: apps/ig-poster/data/drafts.json
  - Logs: apps/ig-poster/logs/activity.json
  - License + settings: %USERPROFILE%/BulkIG-Pro (or env overrides)
- Electron shell (src/electron/main.ts)
  - Starts the server as a child process (dev via tsx, prod via Node), waits for /health, opens window to http://localhost:4011, manages tray
- Cloudflare tunnel
  - Started on server boot with retries; sets global tunnelUrl used for public media URLs

CI/CD highlights (.github/workflows)
- CI/CD Pipeline (ci.yml)
  - Node 18/20 matrix; pnpm install with caching; build artifacts uploaded from apps/*/dist
  - Lint and type-check steps are present but tolerant if not configured
  - Security job runs pnpm audit (high+), and conditional TruffleHog secret scan across a computed base/head range
- Release (release.yml)
  - Triggered on tags v*; builds and generates a simple changelog from git log; uploads build artifacts

Notes and gotchas
- Port mismatch in scripts vs docs
  - Pro defaults use 4011 (server) and 5006 (static placeholder). The smoke-test script defaults to http://localhost:4010 — always pass --base http://localhost:4011 when testing Pro.
- Static server port (5006) is informational
  - The Express app serves /media and /static on the main port. There is no separate standalone static server process.
- Tests
  - No unit test runner is configured. Add Jest or Vitest at the package level before relying on pnpm test.

Improvements suggested for apps/ig-poster/WARP.md
- Use pnpm workspace commands instead of npm to match repo tooling
  - Replace npm run dev/start/build with pnpm --filter @bulkig-pro/ig-poster dev/start and pnpm -w build as appropriate
- Correct port defaults
  - Change IG_POSTER_PORT examples and dashboard URL from 4010 to 4011
- Remove reference to a non-existent test file
  - The repo has no tests; drop the npx ts-node test/scheduler.test.ts example
- Clarify static hosting
  - Note that STATIC_SERVER_PORT is not a separate server; media is served under /media and /static on the main port

Quick start (Windows, PowerShell)
- Copy env and set ports/paths
  - Copy .env.example to .env and set IG_POSTER_PORT=4011, STATIC_SERVER_PORT=5006, INBOX_PATH=C:\IG-Pro\inbox
- Install and run
  - pnpm install
  - pnpm start
  - Open http://localhost:4011
- Optional: run smoke checks
  - pnpm smoke-quick -- --base http://localhost:4011
