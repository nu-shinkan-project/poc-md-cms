import { YServer } from "y-partyserver";
import { getServerByName } from "partyserver";
import * as Y from "yjs";
import { authorized } from "./access";
import {
  exportMarkdown,
  importMarkdown,
  roomName,
  roomPath,
  validatePath,
} from "./markdown";
import {
  repository,
  publicationBranch,
  type Config,
  type Published,
  type Publication,
} from "./repository";
interface Env extends Config {
  Draft: DurableObjectNamespace<Draft>;
  ASSETS: Fetcher;
}
export class Draft extends YServer<Env> {
  private base!: Published;
  private publishing?: Promise<Publication>;
  static callbackOptions = { debounceWait: 100, debounceMaxWait: 500 };
  async onLoad() {
    const path = roomPath(
      this.name,
      this.env.GITHUB_OWNER,
      this.env.GITHUB_REPO,
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, base TEXT NOT NULL, state BLOB NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ base: string; state: ArrayBuffer }>(
        "SELECT base, state FROM snapshot WHERE id = 1",
      )
      .toArray()[0];
    const saved = row
      ? {
          base: JSON.parse(row.base) as Published,
          update: new Uint8Array(row.state),
        }
      : undefined;
    if (saved) {
      this.base = saved.base;
      Y.applyUpdate(this.document, saved.update);
    } else {
      this.base = await repository(this.env).read(path);
      const initial = importMarkdown(this.base.source);
      Y.applyUpdate(this.document, Y.encodeStateAsUpdate(initial));
      initial.destroy();
      await this.onSave();
    }
    // Persist every update before the DO output gate releases subsequent messages.
    this.document.on("update", () => {
      this.ctx.waitUntil(this.onSave());
    });
  }
  async onSave() {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO snapshot (id, base, state) VALUES (1, ?, ?)",
      JSON.stringify(this.base),
      Y.encodeStateAsUpdate(this.document),
    );
  }
  private async publish() {
    const source = exportMarkdown(this.document);
    if (new TextEncoder().encode(source).length > 512_000)
      throw new Error("Draft exceeds 512 KB");
    const branch = await publicationBranch(this.base, source);
    const previous = await this.ctx.storage.get<Publication>(branch);
    if (previous) return previous;
    await this.onSave();
    const result = await repository(this.env).publish(
      this.base,
      source,
      branch,
    );
    await this.ctx.storage.put(branch, result);
    return result;
  }
  async onRequest(request: Request) {
    const action = new URL(request.url).searchParams.get("action");
    if (request.method === "POST" && action === "publish") {
      const body = await request.json<{ expectedMarkdown?: string }>();
      if (body.expectedMarkdown !== exportMarkdown(this.document))
        return Response.json(
          {
            error:
              "Draft changed or has not synchronized yet. Review a fresh Markdown snapshot and retry.",
          },
          { status: 409 },
        );
      if (this.publishing)
        return Response.json(
          {
            error:
              "A publication is already in progress. Retry after it finishes.",
          },
          { status: 409 },
        );
      this.publishing = this.publish().finally(() => {
        this.publishing = undefined;
      });
      return Response.json(await this.publishing);
    }
    if (request.method === "GET") {
      await this.onSave();
      return Response.json({
        base: this.base,
        markdown: exportMarkdown(this.document),
      });
    }
    return new Response("Method not allowed", { status: 405 });
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (!(await authorized(request, env)))
        return new Response("Cloudflare Access authentication required", {
          status: 401,
        });
      const url = new URL(request.url);
      if (
        (request.method !== "GET" && request.method !== "HEAD") ||
        request.headers.get("Upgrade") === "websocket"
      ) {
        if (request.headers.get("Origin") !== url.origin)
          return new Response("Invalid origin", { status: 403 });
      }
      if (url.pathname === "/api/documents" && request.method === "GET")
        return Response.json({
          paths: await repository(env).list(),
          repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
          mode: env.REPOSITORY_MODE,
        });
      if (url.pathname === "/api/document" && request.method === "GET")
        return Response.json(
          await repository(env).read(
            validatePath(url.searchParams.get("path") ?? ""),
          ),
        );
      if (url.pathname === "/api/draft") {
        const path = validatePath(url.searchParams.get("path") ?? "");
        const name = roomName(env.GITHUB_OWNER, env.GITHUB_REPO, path);
        const stub = await getServerByName(env.Draft, name);
        return await stub.fetch(request);
      }
      if (url.pathname.startsWith("/parties/")) {
        const parts = url.pathname.split("/");
        if (parts.length !== 4 || parts[2] !== "draft")
          return new Response("Not found", { status: 404 });
        roomPath(parts[3], env.GITHUB_OWNER, env.GITHUB_REPO);
        const stub = await getServerByName(env.Draft, parts[3]);
        return await stub.fetch(request);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Request failed" },
        { status: 400 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
