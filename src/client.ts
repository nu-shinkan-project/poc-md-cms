import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import * as Y from "yjs";
import YProvider from "y-partyserver/provider";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { extensions, roomName, splitFrontMatter } from "./markdown";
import type { Published, Publication } from "./repository";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<header><strong>Repository docs</strong><span id="repo"></span><span id="mode"></span></header><div class="layout"><nav aria-label="Documents" id="tree"></nav><main><h1 id="path">Select a document</h1><div id="error" role="alert"></div><div id="revision"></div><div class="actions"><button id="browse">Published</button><button id="edit">Edit collaboratively</button><button id="export" disabled>Markdown snapshot</button><button id="publish" disabled>Prepare pull request</button><span id="status"></span></div><p id="notice"></p><article id="preview"></article><section id="editing" hidden><div id="toolbar"><button data-command="bold">Bold</button><button data-command="italic">Italic</button><button data-command="heading">Heading</button><button data-command="bullet">List</button><button data-command="code">Code block</button><button data-command="undo">Undo</button><button data-command="redo">Redo</button></div><div id="editor"></div><details><summary>Preserved front matter (read only)</summary><pre id="frontmatter"></pre></details></section><details id="source-panel" hidden><summary>Markdown snapshot — copy or download before publishing</summary><textarea id="source" readonly aria-label="Markdown snapshot"></textarea><button id="download">Download Markdown</button></details><div id="publication" role="status"></div></main></div>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let editor: Editor | undefined;
let provider: YProvider | undefined;
let ydoc: Y.Doc | undefined;
let currentPath = "";
let repo = "";
let mode = "";
let generation = 0;

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}
function fail(error: unknown) {
  el("error").textContent =
    error instanceof Error ? error.message : String(error);
}
function apiPath(action = "") {
  return `/api/draft?path=${encodeURIComponent(currentPath)}${action ? `&action=${action}` : ""}`;
}
function stopEditing() {
  provider?.destroy();
  editor?.destroy();
  ydoc?.destroy();
  provider = undefined;
  editor = undefined;
  ydoc = undefined;
  el("editing").hidden = true;
  el("preview").hidden = false;
  el("source-panel").hidden = true;
  el<HTMLButtonElement>("export").disabled = true;
  el<HTMLButtonElement>("publish").disabled = true;
  el("status").textContent = "";
}
async function open(path: string) {
  const token = ++generation;
  stopEditing();
  currentPath = path;
  location.hash = encodeURIComponent(path);
  el("path").textContent = path;
  el("error").textContent = "";
  el("publication").textContent = "";
  el("notice").textContent =
    "Published source. Open the collaborative draft to edit; preparing a PR does not change this view.";
  el("preview").textContent = "Loading…";
  const published = await api<Published>(
    `/api/document?path=${encodeURIComponent(path)}`,
  );
  if (token !== generation) return;
  el("revision").textContent = `Published revision: ${published.baseCommit}`;
  el("preview").innerHTML = DOMPurify.sanitize(
    await marked.parse(splitFrontMatter(published.source).body),
  );
  el("preview")
    .querySelectorAll<HTMLAnchorElement>("a")
    .forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (/\.md(?:#.*)?$/i.test(href) && !/^[a-z]+:|^\/\//i.test(href)) {
        a.onclick = (event) => {
          event.preventDefault();
          const resolved = new URL(
            href,
            `https://repository.invalid/${path}`,
          ).pathname.slice(1);
          void open(decodeURIComponent(resolved)).catch(fail);
        };
      }
    });
}
async function edit() {
  if (provider || !currentPath) return;
  const token = generation;
  el<HTMLButtonElement>("edit").disabled = true;
  try {
    const draft = await api<{ base: Published }>(apiPath());
    if (token !== generation) return;
    el("revision").textContent =
      `Draft base: ${draft.base.baseCommit} · branch target: ${draft.base.baseBranch}`;
    el("notice").textContent =
      "Shared draft: changes persist separately from Git. Front matter is preserved. Tables, images, HTML, MDX and other extensions may be lossy; inspect the snapshot before publishing.";
    el("preview").hidden = true;
    el("editing").hidden = false;
    ydoc = new Y.Doc();
    const [owner, name] = repo.split("/");
    provider = new YProvider(
      location.host,
      roomName(owner, name, currentPath),
      ydoc,
      { party: "draft", disableBc: true },
    );
    const doc = ydoc;
    provider.on("status", ({ status }: { status: string }) => {
      el("status").textContent =
        status === "connected"
          ? "Connected · synchronizing"
          : "Disconnected · keep this tab open until reconnected";
      el<HTMLButtonElement>("publish").disabled = true;
    });
    provider.on("sync", (synced: boolean) => {
      if (!synced || token !== generation) return;
      if (!editor)
        editor = new Editor({
          element: el("editor"),
          extensions: [
            ...extensions,
            Markdown,
            Collaboration.configure({ document: doc, field: "content" }),
          ],
          editorProps: {
            attributes: {
              "aria-label": "Collaborative document",
              role: "textbox",
            },
          },
        });
      el("status").textContent = "Connected · shared draft";
      el("frontmatter").textContent =
        doc.getText("frontMatter").toString() || "(none)";
      el<HTMLButtonElement>("export").disabled = false;
      el<HTMLButtonElement>("publish").disabled = false;
    });
  } finally {
    el<HTMLButtonElement>("edit").disabled = false;
  }
}
el("edit").onclick = () => void edit().catch(fail);
el("browse").onclick = () => void open(currentPath).catch(fail);
el("export").onclick = () => {
  if (!editor || !ydoc) return;
  el<HTMLTextAreaElement>("source").value =
    ydoc.getText("frontMatter").toString() + editor.getMarkdown() + "\n";
  el("source-panel").hidden = false;
  el<HTMLDetailsElement>("source-panel").open = true;
};
el("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([el<HTMLTextAreaElement>("source").value], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = currentPath.split("/").at(-1)!;
  a.click();
  URL.revokeObjectURL(url);
};
el("publish").onclick = async () => {
  el<HTMLButtonElement>("publish").disabled = true;
  try {
    const result = await api<Publication>(apiPath("publish"), "POST", {
      expectedMarkdown:
        ydoc!.getText("frontMatter").toString() + editor!.getMarkdown() + "\n",
    });
    el("publication").textContent =
      `${result.simulated ? "Simulated publication (no GitHub write)" : "Pull request prepared"} · ${result.branch} · based on ${result.baseCommit}`;
    if (result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.textContent = " Open pull request";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      el("publication").append(a);
    }
  } catch (error) {
    fail(error);
  } finally {
    el<HTMLButtonElement>("publish").disabled = !provider?.synced;
  }
};
el("toolbar").onclick = (event) => {
  if (!editor) return;
  const command = (event.target as HTMLElement).dataset.command;
  const chain = editor.chain().focus();
  if (command === "bold") chain.toggleBold().run();
  if (command === "italic") chain.toggleItalic().run();
  if (command === "heading") chain.toggleHeading({ level: 2 }).run();
  if (command === "bullet") chain.toggleBulletList().run();
  if (command === "code") chain.toggleCodeBlock().run();
  if (command === "undo") chain.undo().run();
  if (command === "redo") chain.redo().run();
};
async function start() {
  const data = await api<{ paths: string[]; repository: string; mode: string }>(
    "/api/documents",
  );
  repo = data.repository;
  mode = data.mode;
  el("repo").textContent = repo;
  el("mode").textContent = mode === "fixture" ? "LOCAL FIXTURE" : "GITHUB";
  for (const path of data.paths) {
    const segments = path.split("/");
    let parent = el("tree");
    let key = "";
    for (const dir of segments.slice(0, -1)) {
      key += "/" + dir;
      let details = Array.from(parent.children).find(
        (child) => (child as HTMLElement).dataset.dir === key,
      ) as HTMLDetailsElement | undefined;
      if (!details) {
        details = document.createElement("details");
        details.open = true;
        details.dataset.dir = key;
        const summary = document.createElement("summary");
        summary.textContent = dir;
        details.append(summary);
        parent.append(details);
      }
      parent = details;
    }
    const button = document.createElement("button");
    button.textContent = segments.at(-1)!;
    button.title = path;
    button.onclick = () => void open(path).catch(fail);
    parent.append(button);
  }
  if (data.paths.length)
    await open(decodeURIComponent(location.hash.slice(1)) || data.paths[0]);
}
window.addEventListener("beforeunload", () => stopEditing());
void start().catch(fail);
