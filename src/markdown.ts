import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

export const extensions = [StarterKit.configure({ undoRedo: false })];
export const schema = getSchema(extensions);
export const markdown = new MarkdownManager({ extensions });
export function splitFrontMatter(source: string) {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  return {
    frontMatter: match?.[0] ?? "",
    body: source.slice(match?.[0].length ?? 0),
  };
}
export function importMarkdown(source: string): Y.Doc {
  const { frontMatter, body } = splitFrontMatter(source);
  const doc = prosemirrorJSONToYDoc(schema, markdown.parse(body), "content");
  doc.getText("frontMatter").insert(0, frontMatter);
  return doc;
}
export function exportMarkdown(doc: Y.Doc) {
  return (
    doc.getText("frontMatter").toString() +
    markdown.serialize(yDocToProsemirrorJSON(doc, "content")) +
    "\n"
  );
}
export function validatePath(path: string) {
  if (
    !path ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.includes("\\") ||
    Array.from(path).some((c) => c.charCodeAt(0) < 32) ||
    !/\.md$/i.test(path)
  )
    throw new Error("Invalid Markdown path");
  return path;
}
export function roomName(owner: string, repo: string, path: string) {
  validatePath(path);
  return btoa(unescape(encodeURIComponent(JSON.stringify([owner, repo, path]))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function roomPath(room: string, owner: string, repo: string) {
  const [o, r, p] = JSON.parse(
    decodeURIComponent(
      escape(atob(room.replaceAll("-", "+").replaceAll("_", "/"))),
    ),
  );
  if (o !== owner || r !== repo || roomName(o, r, p) !== room)
    throw new Error("Invalid room");
  return validatePath(p);
}
