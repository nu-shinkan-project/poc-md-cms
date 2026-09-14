import { describe, expect, it } from "vitest";
import {
  FixtureRepository,
  GitHubRepository,
  publicationBranch,
  type Config,
  type Published,
} from "../src/repository";
const config: Config = {
  REPOSITORY_MODE: "github",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "repo",
  GITHUB_BRANCH: "main",
};
function fakeGitHub() {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let branch = false,
    pr = false,
    failPR = false;
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input).replace(
      "https://api.github.com/repos/owner/repo",
      "",
    );
    const method = init?.method ?? "GET";
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, method, body });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer installation-token",
    );
    let value: unknown;
    if (path === "/commits/main")
      value = {
        sha: "current-head",
        commit: { tree: { sha: "current-tree" } },
      };
    else if (path.startsWith("/contents/"))
      value = {
        type: "file",
        encoding: "base64",
        content: btoa("# Published\n"),
        sha: "blob-1",
        size: 12,
      };
    else if (path.startsWith("/git/ref/heads/"))
      return Response.json(branch ? { object: { sha: "new-commit" } } : {}, {
        status: branch ? 200 : 404,
      });
    else if (path === "/git/commits/original-base")
      value = { tree: { sha: "original-tree" } };
    else if (path === "/git/trees" && method === "POST")
      value = { sha: "new-tree" };
    else if (path === "/git/commits" && method === "POST")
      value = { sha: "new-commit" };
    else if (path === "/git/refs" && method === "POST") {
      branch = true;
      value = { object: { sha: "new-commit" } };
    } else if (path.startsWith("/pulls?"))
      value = pr ? [{ html_url: "https://github.com/owner/repo/pull/1" }] : [];
    else if (path === "/pulls" && method === "POST") {
      if (failPR) {
        failPR = false;
        return Response.json({}, { status: 503 });
      }
      pr = true;
      value = { html_url: "https://github.com/owner/repo/pull/1" };
    } else if (path.startsWith("/git/trees/current-tree"))
      value = {
        truncated: false,
        tree: [
          { path: "docs/a.md", type: "blob", mode: "100644" },
          { path: "a.png", type: "blob", mode: "100644" },
          { path: "link.md", type: "blob", mode: "120000" },
        ],
      };
    else throw new Error(`Unexpected request ${method} ${path}`);
    return Response.json(value);
  };
  return {
    calls,
    fetcher,
    failNextPR: () => {
      failPR = true;
    },
  };
}
const base: Published = {
  path: "docs/a.md",
  source: "# Old\n",
  baseCommit: "original-base",
  blobSha: "old-blob",
  baseBranch: "main",
};
describe("GitHub adapter", () => {
  it("pins file reads to a commit and lists only regular Markdown files", async () => {
    const fake = fakeGitHub();
    const repo = new GitHubRepository(
      config,
      async () => "installation-token",
      fake.fetcher,
    );
    expect(await repo.list()).toEqual(["docs/a.md"]);
    expect((await repo.read("docs/a.md")).baseCommit).toBe("current-head");
    expect(
      fake.calls.some((c) => c.path === "/contents/docs/a.md?ref=current-head"),
    ).toBe(true);
  });
  it("branches from original base even when upstream has advanced; retries after partial failure", async () => {
    const fake = fakeGitHub();
    const repo = new GitHubRepository(
      config,
      async () => "installation-token",
      fake.fetcher,
    );
    const branch = await publicationBranch(base, "# Edited\n");
    fake.failNextPR();
    await expect(repo.publish(base, "# Edited\n", branch)).rejects.toThrow(
      "503",
    );
    const result = await repo.publish(base, "# Edited\n", branch);
    expect(result.baseCommit).toBe("original-base");
    expect(result.url).toContain("/pull/1");
    expect(fake.calls.find((c) => c.path === "/git/trees")?.body).toEqual({
      base_tree: "original-tree",
      tree: [
        {
          path: "docs/a.md",
          mode: "100644",
          type: "blob",
          content: "# Edited\n",
        },
      ],
    });
    expect(
      fake.calls.find((c) => c.path === "/git/commits")?.body.parents,
    ).toEqual(["original-base"]);
    expect(fake.calls.filter((c) => c.path === "/git/refs")).toHaveLength(1);
    expect(fake.calls.some((c) => c.method === "PATCH")).toBe(false);
    await repo.publish(base, "# Edited\n", branch);
    expect(fake.calls.filter((c) => c.path === "/pulls")).toHaveLength(2); // failed once, succeeded once
  });
  it("snapshot identity is repeatable and sensitive to path, base and content", async () => {
    const first = await publicationBranch(base, "a");
    expect(await publicationBranch(base, "a")).toBe(first);
    expect(await publicationBranch(base, "b")).not.toBe(first);
    expect(
      await publicationBranch({ ...base, baseCommit: "other" }, "a"),
    ).not.toBe(first);
    expect(
      await publicationBranch({ ...base, path: "other.md" }, "a"),
    ).not.toBe(first);
  });
  it("fixture mode never changes published content", async () => {
    const repo = new FixtureRepository();
    const before = await repo.read("README.md");
    expect((await repo.publish(before, "new", "cms/test")).simulated).toBe(
      true,
    );
    expect(await repo.read("README.md")).toEqual(before);
  });
});
