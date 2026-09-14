import { createAppAuth } from "@octokit/auth-app";
import { validatePath } from "./markdown";
export interface Config {
  REPOSITORY_MODE: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_PRIVATE_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
export interface Published {
  path: string;
  source: string;
  baseCommit: string;
  blobSha: string;
  baseBranch: string;
}
export interface Publication {
  branch: string;
  commit: string;
  url: string;
  baseCommit: string;
  simulated: boolean;
}
export interface Repository {
  list(): Promise<string[]>;
  read(path: string): Promise<Published>;
  publish(
    base: Published,
    source: string,
    branch: string,
  ): Promise<Publication>;
}
export const fixtures: Record<string, string> = {
  "README.md":
    "---\ntitle: Demo documentation\n---\n# Welcome\n\nPublished documentation lives in Git. Collaborative drafts live in Durable Objects.\n\n- Open a document\n- Edit together\n- Prepare a pull request\n\nSee the [guide](guides/getting-started.md).\n",
  "guides/getting-started.md":
    '# Getting started\n\nUse `npm ci` to install dependencies.\n\n```typescript\nconst greeting = "Hello, collaborators";\nconsole.log(greeting);\n```\n\n1. Open two browser sessions.\n2. Edit the same document.\n',
  "guides/architecture.md":
    "# Architecture\n\nGitHub → collaborative draft → branch → pull request.\n",
};
export class FixtureRepository implements Repository {
  async list() {
    return Object.keys(fixtures).sort();
  }
  async read(path: string): Promise<Published> {
    validatePath(path);
    if (!(path in fixtures)) throw new Error("Document not found");
    return {
      path,
      source: fixtures[path],
      baseCommit: "fixture-base-v1",
      blobSha: `fixture:${path}`,
      baseBranch: "main",
    };
  }
  async publish(
    base: Published,
    _source: string,
    branch: string,
  ): Promise<Publication> {
    return {
      branch,
      commit: branch.slice(4),
      url: "",
      baseCommit: base.baseCommit,
      simulated: true,
    };
  }
}
export class GitHubRepository implements Repository {
  private root: string;
  constructor(
    private config: Config,
    private token: () => Promise<string>,
    private fetcher: typeof fetch = fetch,
  ) {
    this.root = `https://api.github.com/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(config.GITHUB_REPO)}`;
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    allow404 = false,
  ): Promise<T> {
    const response = await this.fetcher(this.root + path, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "markdown-cms-poc",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allow404 && response.status === 404) return null as T;
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path}: ${response.status}`);
    return response.json() as Promise<T>;
  }
  private async head() {
    return this.request<{ sha: string; commit: { tree: { sha: string } } }>(
      `/commits/${encodeURIComponent(this.config.GITHUB_BRANCH)}`,
    );
  }
  async list() {
    const head = await this.head();
    const tree = await this.request<{
      truncated: boolean;
      tree: { path: string; type: string; mode: string }[];
    }>(`/git/trees/${head.commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error("Repository tree exceeds PoC limit");
    return tree.tree
      .filter(
        (e) =>
          e.type === "blob" && e.mode !== "120000" && /\.md$/i.test(e.path),
      )
      .map((e) => e.path)
      .sort();
  }
  async read(path: string): Promise<Published> {
    validatePath(path);
    const head = await this.head();
    const file = await this.request<{
      type: string;
      encoding: string;
      content: string;
      sha: string;
      size: number;
    }>(
      `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${head.sha}`,
    );
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      file.size > 512_000
    )
      throw new Error("Unsupported file or file exceeds 512 KB");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) =>
        c.charCodeAt(0),
      ),
    );
    return {
      path,
      source,
      baseCommit: head.sha,
      blobSha: file.sha,
      baseBranch: this.config.GITHUB_BRANCH,
    };
  }
  async publish(
    base: Published,
    source: string,
    branch: string,
  ): Promise<Publication> {
    // Deterministic branch per snapshot makes retries safe after any REST failure.
    let ref = await this.request<{ object: { sha: string } } | null>(
      `/git/ref/heads/${branch}`,
      "GET",
      undefined,
      true,
    );
    if (!ref) {
      const parent = await this.request<{ tree: { sha: string } }>(
        `/git/commits/${base.baseCommit}`,
      );
      const tree = await this.request<{ sha: string }>("/git/trees", "POST", {
        base_tree: parent.tree.sha,
        tree: [
          { path: base.path, mode: "100644", type: "blob", content: source },
        ],
      });
      const commit = await this.request<{ sha: string }>(
        "/git/commits",
        "POST",
        {
          message: `docs: update ${base.path}`,
          tree: tree.sha,
          parents: [base.baseCommit],
        },
      );
      ref = await this.request("/git/refs", "POST", {
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
    }
    const existing = await this.request<{ html_url: string }[]>(
      `/pulls?state=all&head=${encodeURIComponent(`${this.config.GITHUB_OWNER}:${branch}`)}&base=${encodeURIComponent(base.baseBranch)}`,
    );
    const pr =
      existing[0] ??
      (await this.request<{ html_url: string }>("/pulls", "POST", {
        title: `docs: update ${base.path}`,
        head: branch,
        base: base.baseBranch,
        body: `Collaborative draft based on ${base.baseCommit}.\n\nGitHub handles mergeability against the current base branch.`,
      }));
    return {
      branch,
      commit: ref!.object.sha,
      url: pr.html_url,
      baseCommit: base.baseCommit,
      simulated: false,
    };
  }
}
export function repository(config: Config): Repository {
  if (config.REPOSITORY_MODE === "fixture") return new FixtureRepository();
  if (config.REPOSITORY_MODE !== "github")
    throw new Error("Invalid repository mode");
  if (
    !config.GITHUB_APP_ID ||
    !config.GITHUB_INSTALLATION_ID ||
    !config.GITHUB_PRIVATE_KEY
  )
    throw new Error("GitHub App secrets are missing");
  const auth = createAppAuth({
    appId: config.GITHUB_APP_ID,
    installationId: config.GITHUB_INSTALLATION_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
  });
  return new GitHubRepository(
    config,
    async () => (await auth({ type: "installation" })).token,
  );
}
export async function publicationBranch(base: Published, source: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([base.path, base.baseCommit, source]),
    ),
  );
  return (
    "cms/" +
    Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
