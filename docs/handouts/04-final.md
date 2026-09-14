# Handoff 04 — final local checkpoint

Date: 2026-09-14 UTC.

## Outcome

The local PoC meets the original handoff boundary. Implemented directory-aware repository browsing, rich-text collaboration, durable drafts, Markdown interchange, original-base PR publication, GitHub App authentication adapter, and Cloudflare Access gate. Actual account authorization and the final Cloudflare/GitHub integration check remain external.

## Verified

- `npm ci`: clean installation passed; 0 reported vulnerabilities.
- `npm run verify`: passed after the clean installation.
- TypeScript: browser and Worker configurations passed.
- ESLint and Prettier: passed.
- Vitest: 18 tests across 3 files passed (Markdown structures/front matter, CRDT restore/convergence, path identity, GitHub base tracking/retry, fixture ownership, Access signature/audience/expiry).
- Production build: Vite and `wrangler deploy --dry-run --env production` passed without account credentials.
- Playwright: 2 integration scenarios passed on real local workerd/DO SQLite. Two independent contexts; bidirectional edits; disconnected concurrent edits; convergence; reload; export equality; stale publication rejection; idempotent publication; unchanged published source; full Worker stop/start while no browsers are connected; navigation/room isolation/origin checks.
- Agent-driven exploratory Chromium interaction in two contexts and screenshot inspection completed. Final screenshot shows correctly placed text, single original heading, both collaborators' edits and Markdown output. A too-fast automated native-selection sequence was corrected by waiting for selectionchange animation frames in the test helper.
- Artifacts: `artifacts/collaboration.png`, `artifacts/manual-browser.png`, `artifacts/worker-browser.log` (generated/ignored; reproducible through tests).

## Resume instructions

1. Read `README.md` for exact commands and `docs/architecture.md` for choices/limits.
2. Use `npm run dev` for a local fixture demo on port 8787. Existing local demo edits can persist in `.wrangler/state`; automated tests use separate state directories.
3. Cross the external boundary using only `docs/external-integration.md`: Cloudflare login, GitHub App installation and PKCS#8 key, production vars/secrets, Access application/AUD, deploy, two-session live PR verification.
4. No external account was authenticated, no cloud deployment was performed, and no GitHub branch/PR was created by this work.

## Known limitations to retain

Markdown extension lossiness; no offline tab-close durability; no document ACL/presence UI; no automatic draft rollover/PR update after merge; full-snapshot storage intended for small trusted PoC documents. Build warnings for client bundle size and upstream Tiptap JSX comments are documented and non-blocking. Runtime peer types use an explicit workers-types override with type/runtime verification.

The pre-existing untracked `.devcontainer/` files were not edited or included in the implementation commit. Local changes, dependencies and browser OS dependencies were handled autonomously as authorized.
