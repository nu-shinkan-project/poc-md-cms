# Handoff 01 — bootstrap

- Original requirements: ../requirements.md. User authorizes all internal devcontainer work; no external account actions authorized/needed.
- Stack: npm / TypeScript / Vite static client, Wrangler Worker + one y-partyserver Durable Object per repository/path; Tiptap 3 + Yjs; GitHub App REST adapter and local fixture adapter.
- Prioritize server-side initialization (avoid duplicate initial content), durable Yjs snapshots, immutable base commit outside client-editable CRDT, PR branch from original base revision.
- Verify unit boundaries plus two independent Playwright browser contexts against real local Wrangler. Include process restart persistence check.
- Next: inspect installed APIs, implement, typecheck/build/test. Keep periodic handouts and final external integration instructions.
