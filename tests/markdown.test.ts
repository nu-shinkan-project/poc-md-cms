import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  exportMarkdown,
  importMarkdown,
  markdown,
  roomName,
  roomPath,
  splitFrontMatter,
  validatePath,
} from "../src/markdown";

describe("Markdown interchange", () => {
  const body =
    "# Heading\n\nA paragraph with **bold**, *italic*, [a link](https://example.com) and `inline code`.\n\n- One\n- Two\n\n1. First\n2. Second\n\n```typescript\nconst x = 1;\n```\n";
  it("preserves supported structures through Yjs and Markdown", () => {
    const doc = importMarkdown(body);
    expect(markdown.parse(exportMarkdown(doc))).toEqual(markdown.parse(body));
    doc.destroy();
  });
  it("preserves front matter byte for byte including CRLF and comments", () => {
    const front =
      '---\r\ntitle: "日本語" # comment\r\ntags: [one, two]\r\n---\r\n';
    const doc = importMarkdown(front + body);
    expect(exportMarkdown(doc).startsWith(front)).toBe(true);
    expect(splitFrontMatter(exportMarkdown(doc)).body).toContain("# Heading");
    expect(splitFrontMatter("---\nnot closed").frontMatter).toBe("");
    doc.destroy();
  });
  it("restores a durable snapshot and merges concurrent updates", () => {
    const initial = importMarkdown(body);
    const snapshot = Y.encodeStateAsUpdate(initial);
    const a = new Y.Doc(),
      b = new Y.Doc();
    Y.applyUpdate(a, snapshot);
    Y.applyUpdate(b, snapshot);
    const textA = a.getXmlFragment("content").get(0) as Y.XmlElement;
    const textB = b.getXmlFragment("content").get(0) as Y.XmlElement;
    (textA.get(0) as Y.XmlText).insert(0, "Alice ");
    (textB.get(0) as Y.XmlText).insert(0, "Bob ");
    const updateA = Y.encodeStateAsUpdate(a),
      updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB);
    Y.applyUpdate(b, updateA);
    expect(exportMarkdown(a)).toEqual(exportMarkdown(b));
    expect(exportMarkdown(a)).toContain("Alice");
    expect(exportMarkdown(a)).toContain("Bob");
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(a));
    expect(exportMarkdown(restored)).toEqual(exportMarkdown(a));
    [initial, a, b, restored].forEach((d) => d.destroy());
  });
});
describe("session identity", () => {
  it("isolates repositories, full paths, and case, and supports Unicode", () => {
    const paths = [
      "a/README.md",
      "b/README.md",
      "a/readme.md",
      "日本語/始め方.md",
    ];
    expect(new Set(paths.map((p) => roomName("o", "r", p))).size).toBe(4);
    for (const path of paths)
      expect(roomPath(roomName("o", "r", path), "o", "r")).toBe(path);
    expect(() =>
      roomPath(roomName("o", "r", paths[0]), "other", "r"),
    ).toThrow();
  });
  it.each([
    "../x.md",
    "/x.md",
    "a//x.md",
    "a/./x.md",
    "a\\x.md",
    "x.txt",
    "a\u0000.md",
  ])("rejects %s", (path) => expect(() => validatePath(path)).toThrow());
});
