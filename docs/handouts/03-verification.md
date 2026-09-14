# Handoff 03 — local behavior proven

- 15 initial unit tests passed; first complete browser suite passed 2/2 against real local Wrangler/workerd, including separate contexts, disconnected concurrent changes, reload, full process restart with no clients, Markdown export equality and idempotent fixture publication.
- Chromium OS libraries were missing; installed with `npm exec playwright install-deps chromium`. Bootstrap instructions must include `npm run setup:browser`.
- Persistence changed from KV blob to DO SQLite snapshot row to avoid KV's 128 KiB value limit. Metadata and Yjs bytes are written atomically on every update; no external database.
- Publication now checks a client's expected Markdown against authoritative server serialization and rejects stale requests. Simultaneous publication will be rejected rather than returning a different snapshot's result.
- Browser inspection found automated Control+End / Enter sequence could outrun native selectionchange; after allowing animation frames, end-of-document typing behaves correctly. Added synchronization in test helper. Manual browser output also confirmed a second independent session can read the exported result.
- Added signature/audience/expiry tests for Cloudflare Access gate; next verification run in progress.
- Remaining local work: final checks, inspect latest screenshots, npm ci reproducibility, finalize README / external integration guide. No external credentials requested or used.
