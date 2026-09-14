# Handoff 02 — implementation skeleton

- Worker + y-partyserver Draft class, server Markdown import/export, repository and GitHub App REST adapter, directory browser/Tiptap client now implemented.
- Draft key = encoded owner/repo/path; initial base commit and original front matter persisted atomically with Yjs snapshot. All updates trigger storage write; library save callback provides an additional save.
- Publication serializes server state. Deterministic SHA-256 snapshot branch; original commit is sole commit parent. Existing branch/PR lookup supports retries. Fixture publication explicitly simulated.
- Production mode verifies Cloudflare Access JWT (jose); fixture local mode deliberately unauthenticated. Need document Access setup along with GitHub App secrets.
- npm peer metadata conflict: y-partyserver still declares workers-types v4, current Wrangler requires v5; explicit override uses root v5 types. Type/runtime verification required. No --legacy-peer-deps.
- Next: complete build/type checks, boundary unit tests, browser concurrency/reload/disconnect tests, restart persistence, inspect UX, documentation and cleanup.
