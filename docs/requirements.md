# GitHub-Backed Collaborative Markdown CMS PoC

## Goal

Build a proof of concept for a **GitHub-backed collaborative Markdown CMS** intended for development documentation.

The PoC should demonstrate that:

* Markdown files in a GitHub repository can serve as the published source of truth.
* Users can browse the repository as a directory-aware documentation site.
* Users can edit a document through a web-based rich-text editor.
* Multiple users can edit the same document concurrently in real time.
* In-progress collaborative state can survive reloads and temporary disconnects.
* The edited document can be converted back to Markdown.
* A completed editing session can be prepared for publication back to GitHub through a branch / pull-request workflow.

The task includes **technology selection, project bootstrap, dependency selection, configuration, implementation, testing, and documentation**.

The repository may initially contain nothing other than this README. Do not expect the user to prepare the application structure or development toolchain.

## Completion Boundary

Complete everything that can reasonably be implemented and verified **without requiring the user to authenticate with Cloudflare or connect/install a GitHub App**.

The PoC is complete when the implementation is ready for the final external integration check and the only remaining manual prerequisites are actions such as:

* authenticating the deployment tooling with the user's Cloudflare account;
* creating, installing, authorizing, or supplying credentials for the GitHub App;
* supplying identifiers or secrets that can only be obtained after those actions;
* performing the final end-to-end verification against the real Cloudflare account and GitHub repository.

Do not stop merely because Cloudflare or GitHub integration eventually requires credentials. Implement and verify everything before that boundary using local development facilities, fixtures, test doubles, or mocks as appropriate.

At completion, clearly document the minimal manual steps required to cross that boundary and perform the final verification.

## Scope

The PoC should implement the smallest system necessary to validate the architecture.

A successful result should provide:

### Repository-backed documentation UI

Provide a directory-aware interface for browsing Markdown documents.

The UI should make the relationship to the underlying repository obvious enough for development-document use, while not requiring ordinary users to interact with Git directly.

Support at least:

* directory and document navigation;
* Markdown rendering;
* basic front matter preservation;
* opening a document for editing.

A single configurable repository is sufficient.

### Collaborative editing

Provide real-time editing of a document by at least two browser sessions.

Prefer mature, maintained collaboration primitives rather than implementing a custom synchronization or conflict-resolution algorithm.

Investigate the current Cloudflare ecosystem and other appropriate maintained libraries before selecting the implementation. In particular, evaluate existing Yjs/CRDT integrations for Cloudflare Workers and Durable Objects rather than recreating them.

The internal collaboration granularity does not need to match the UI granularity. It is acceptable, and likely preferable, to use character-level CRDT synchronization internally while presenting a simpler block-oriented editing experience.

At minimum, verify:

1. two browser sessions can open the same document;
2. edits made in either session appear in the other without manual refresh;
3. concurrent edits converge to the same document state;
4. reloading a browser does not silently discard the current collaborative draft;
5. the resulting state can be serialized to Markdown.

Presence indicators, remote cursors, or active-user indicators are useful if naturally supported by the selected stack, but they are not required for PoC success.

### Markdown editing

Use an existing rich-text editor suitable for structured Markdown-oriented content.

Do not build an editor from scratch.

Markdown remains the interchange format with GitHub. The editor's internal document representation does not need to be Markdown while a document is being edited.

Preserve ordinary development-document constructs reasonably well, including at least:

* headings;
* paragraphs;
* lists;
* links;
* inline code;
* fenced code blocks.

Front matter may be edited separately from the rich-text body if that substantially simplifies the implementation.

Do not spend disproportionate effort guaranteeing lossless round-tripping for every Markdown extension. Document unsupported or lossy constructs discovered during the PoC.

If useful, provide a raw Markdown/source view as an escape hatch rather than implementing increasingly complex custom editor extensions.

### Draft lifecycle

Treat collaborative editing state and published Git state as different layers.

A reasonable conceptual model is:

```text
GitHub repository
    |
    | open published document
    v
Collaborative draft session
    |
    | realtime editing
    v
Durable collaborative state
    |
    | publish
    v
Git branch / pull request
```

GitHub should remain the intended source of truth for published documents.

Collaborative storage exists to maintain an active or unfinished editing session. Avoid introducing another permanent CMS database as an independent canonical copy of published documents.

The implementation should make this ownership boundary explicit.

### GitHub publishing workflow

Implement the GitHub integration layer up to the point where real GitHub App credentials are required.

Design for GitHub App authentication rather than a long-lived personal access token.

The intended publishing flow is:

```text
published commit
      |
      v
editing session
      |
      v
CMS-created branch
      |
      v
commit updated Markdown
      |
      v
pull request
```

Do not make direct writes to the default branch the primary publishing mechanism.

Do not build a custom Git merge engine for the PoC.

Record enough information when an editing session begins to identify the Git revision on which the draft was based. If the repository changes independently while the draft is open, the design should preserve that fact and allow Git / GitHub's branch and pull-request workflow to expose the resulting conflict.

Where real GitHub access is unavailable, verify this behavior through an adapter boundary with tests or a realistic fake implementation.

## Technology Selection

Choose the development stack as part of this task.

Prefer:

* currently maintained technologies;
* official or well-established Cloudflare integrations;
* existing CRDT/collaboration libraries;
* conventional TypeScript tooling;
* the simplest architecture that demonstrates the PoC.

Research current documentation before choosing versions or APIs.

Cloudflare Workers and Durable Objects are the target deployment environment. Existing Cloudflare libraries for WebSocket applications and Yjs collaboration should be investigated as likely implementation candidates.

A Tiptap/ProseMirror-family editor with Yjs integration is also a reasonable candidate, but it is not mandatory if another maintained solution produces a materially simpler PoC.

Choose the package manager, build tooling, test framework, linting, formatting, and project structure yourself. Configure them in the repository so a new contributor does not need globally installed project-specific tooling beyond the ordinary runtime/bootstrap requirements you document.

Commit lockfiles and other files required for reproducible setup.

## Architecture Constraints

Keep the architecture deliberately small.

Prefer approximately one collaborative room/session per document.

Separate persistent document content from ephemeral collaboration metadata such as connected users and cursor positions where practical.

Avoid adding infrastructure that is not required to answer the PoC question.

In particular, do not add D1, R2, queues, a search service, a custom authentication system, or another database merely because they may be useful in a future production CMS.

They may be introduced only if the PoC genuinely cannot meet its acceptance criteria without them, and the reason must be documented.

## Non-Goals

This is not an attempt to build a production-ready Dhub, Notion, or Google Docs replacement.

The following are explicitly out of scope unless they fall out almost for free from selected libraries:

* production-quality visual design;
* mobile optimization;
* comments and discussion threads;
* suggestion / track-changes mode;
* document-level ACL management;
* full-text search;
* backlinks;
* document graphs;
* ADR-specific workflows;
* advanced front matter editing;
* arbitrary Git providers;
* multi-repository management;
* offline-first editing;
* custom CRDT algorithms;
* custom Git merge algorithms;
* production observability;
* billing;
* general-purpose CMS extensibility.

Do not create abstractions solely for hypothetical future implementations of these features.

## Implementation Approach

Work autonomously from the repository.

Begin by inspecting the current ecosystem and selecting the shortest maintained path to the acceptance criteria.

Bootstrap the project and implement incrementally.

Prefer proving the riskiest architectural assumption early: persistent real-time collaborative Markdown editing on the target Cloudflare architecture.

Once that works, connect it to the repository/document lifecycle.

Where external credentials prevent a real integration test, isolate the external boundary and continue implementing and testing the rest of the system.

Do not wait for user input merely to make ordinary technical choices that can be reasonably decided from the goal, current documentation, and PoC constraints.

Ask for user action only when an external authorization, secret, account-specific identifier, potentially billable action, or other genuinely user-controlled resource is required.

If multiple technically reasonable choices exist, choose the simpler one and record the decision briefly.

## Verification

Automate verification wherever practical.

At minimum, provide commands that exercise:

* dependency installation;
* type checking;
* automated tests;
* production build;
* local development;
* local Cloudflare Worker / Durable Object execution where supported.

Include automated tests around the boundaries where errors would undermine the PoC, especially:

* Markdown conversion;
* collaborative document persistence;
* document/session identity;
* GitHub adapter behavior;
* base-revision tracking;
* publication preparation.

Also perform a browser-level manual verification of concurrent editing using multiple sessions before declaring the local PoC complete.

If automated browser testing is straightforward with the selected stack, it may be added, but do not turn browser-test infrastructure into a project of its own.

## Final Deliverables

Leave the repository in a state where another developer can clone it and understand:

* what architecture was selected and why;
* how to install dependencies;
* how to run the PoC locally;
* how to verify collaborative editing;
* how collaborative drafts are persisted;
* how Markdown enters and leaves the editor;
* how GitHub publication is modeled;
* what was mocked because external authorization was unavailable;
* what limitations were discovered;
* exactly what remains to perform the final Cloudflare + GitHub integration.

Update this README as implementation knowledge becomes concrete. Replace speculative setup instructions with the actual commands and configuration used by the PoC.

## Final Handoff Point

Stop only after the repository has been implemented and locally verified as far as possible without the user's external account authorization.

The final report should make the remaining actions narrow and mechanical, ideally resembling:

```text
Remaining external verification

1. Authenticate Wrangler with the target Cloudflare account.
2. Create/install the GitHub App using the documented permissions and repository scope.
3. Supply the documented environment variables/secrets.
4. Deploy using the documented command.
5. Open two browser sessions and verify real-time collaboration.
6. Open a document from the configured GitHub repository.
7. Edit collaboratively and publish it.
8. Confirm that the expected branch, commit, and pull request are created.
```

The exact steps must reflect the actual implementation.

If additional implementation work would still be required after those credentials are supplied, the PoC has not yet reached the intended handoff point.

## Guiding Principle

This is an exploratory proof of concept.

Optimize for answering:

> Can a GitHub-backed development-document CMS with practical real-time collaborative Markdown editing be built cleanly on Cloudflare without taking ownership of Git's role as the published source of truth?

Prefer a small working implementation that answers that question over a generalized architecture designed for hypothetical future requirements.
