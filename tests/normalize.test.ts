import { describe, expect, it } from "vitest";
import { normalize, type VaultIndex } from "../src/normalize";

const file = { path: "notes/example.md", basename: "example" };

describe("normalize", () => {
  it("uses the first H1 as the title when present", () => {
    const md = "# Real title\n\nbody text";
    const out = normalize(file, md);
    expect(out.title).toBe("Real title");
  });

  it("falls back to basename when no H1 and no frontmatter title", () => {
    const md = "no heading here\njust text";
    const out = normalize(file, md);
    expect(out.title).toBe("example");
  });

  it("prefers an explicit frontmatter title over the H1", () => {
    const md = "---\ntitle: From frontmatter\n---\n# Heading\nbody";
    const out = normalize(file, md);
    expect(out.title).toBe("From frontmatter");
  });

  it("strips the yaml frontmatter from body_markdown", () => {
    const md = "---\ntitle: x\ntags: [a, b]\n---\n# Heading\nbody";
    const out = normalize(file, md);
    expect(out.body_markdown.startsWith("---")).toBe(false);
    expect(out.body_markdown).toContain("# Heading");
    expect(out.body_markdown).toContain("body");
  });

  it("extracts #tags from body and ignores tags inside fenced code blocks", () => {
    const md = [
      "# t",
      "This is #alpha and #beta/nested in prose.",
      "",
      "```",
      "this #should_not_count",
      "```",
      "",
      "trailing #gamma here",
    ].join("\n");
    const out = normalize(file, md);
    expect(out.tags).toEqual(expect.arrayContaining(["alpha", "beta/nested", "gamma"]));
    expect(out.tags).not.toContain("should_not_count");
  });

  it("merges frontmatter tags with body tags and dedupes", () => {
    const md = "---\ntags: [alpha, foo]\n---\n# t\nbody with #alpha and #bar";
    const out = normalize(file, md);
    expect(new Set(out.tags)).toEqual(new Set(["alpha", "foo", "bar"]));
  });

  it("ignores # inside inline code", () => {
    const md = "# t\nuse `#nope` carefully";
    const out = normalize(file, md);
    expect(out.tags).not.toContain("nope");
  });

  it("does not extract heading markers as tags", () => {
    const md = "# Heading One\n## Subhead\nplain body";
    const out = normalize(file, md);
    expect(out.tags).toEqual([]);
  });

  it("extracts bare [[wikilinks]]", () => {
    const md = "# t\nsee [[Other Note]] for context";
    const out = normalize(file, md);
    expect(out.links_out).toContain("Other Note");
  });

  it("extracts aliased wikilinks [[Foo|bar]] as the target", () => {
    const md = "# t\nlook at [[Foo|the bar thing]]";
    const out = normalize(file, md);
    expect(out.links_out).toEqual(["Foo"]);
  });

  it("extracts section wikilinks [[Foo#section]] as the target", () => {
    const md = "# t\njump to [[Foo#a section]]";
    const out = normalize(file, md);
    expect(out.links_out).toEqual(["Foo"]);
  });

  it("handles section + alias [[Foo#sec|alias]]", () => {
    const md = "# t\nsee [[Foo#sec|the alias]]";
    const out = normalize(file, md);
    expect(out.links_out).toEqual(["Foo"]);
  });

  it("resolves wikilink targets through the vault index when provided", () => {
    const md = "# t\nrefer to [[Foo]]";
    const index: VaultIndex = new Map([["foo", "deep/folder/Foo.md"]]);
    const out = normalize(file, md, index);
    expect(out.links_out).toEqual(["deep/folder/Foo.md"]);
  });

  it("falls back to the raw target when the vault index has no match", () => {
    const md = "# t\nrefer to [[Missing]]";
    const out = normalize(file, md, new Map());
    expect(out.links_out).toEqual(["Missing"]);
  });

  it("does not extract wikilinks inside fenced code blocks", () => {
    const md = "# t\n```\n[[InCode]]\n```\nbut [[Real]] counts";
    const out = normalize(file, md);
    expect(out.links_out).toContain("Real");
    expect(out.links_out).not.toContain("InCode");
  });

  it("sets source_id to the vault-relative file path", () => {
    const out = normalize({ path: "a/b/c.md", basename: "c" }, "# t\nbody");
    expect(out.source_id).toBe("a/b/c.md");
  });

  it("dedupes repeated wikilinks and tags", () => {
    const md = "# t\n[[X]] and [[X]] with #foo and #foo";
    const out = normalize(file, md);
    expect(out.links_out.filter((l) => l === "X")).toHaveLength(1);
    expect(out.tags.filter((t) => t === "foo")).toHaveLength(1);
  });
});
