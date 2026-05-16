// Pure normalization. No Obsidian runtime imports; the plugin layer hands
// in the file metadata and the vault file index so this module stays
// testable in plain node.

export interface NormalizeFileLike {
  path: string;
  basename: string;
}

export interface NormalizedPage {
  source_id: string;
  title: string;
  body_markdown: string;
  tags: string[];
  links_out: string[];
}

// Vault index. Lowercased basename (no extension) and lowercased
// relative path (with or without .md) map to a resolved vault-relative
// path. The plugin builds this from app.vault.getMarkdownFiles().
export type VaultIndex = Map<string, string>;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Strip fenced code blocks and inline code so we do not pull #tags or
// [[wikilinks]] out of literal code samples.
function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  rest: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, rest: raw };
  }
  const yaml = match[1];
  const rest = raw.slice(match[0].length);
  const fm: Record<string, unknown> = {};
  // Minimal YAML. The plugin uses the Obsidian metadata cache for the
  // real load path. This handles top-level scalar and inline/block list
  // values, which covers title and tags.
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const value = kv[2];
    if (value === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        const m = lines[j].match(/^\s*-\s+(.*)$/);
        if (m) items.push(stripQuotes(m[1].trim()));
        j += 1;
      }
      if (items.length > 0) {
        fm[key] = items;
        i = j;
        continue;
      }
      fm[key] = "";
      i += 1;
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      const arr = inner === ""
        ? []
        : inner.split(",").map((s) => stripQuotes(s.trim())).filter((s) => s.length > 0);
      fm[key] = arr;
    } else {
      fm[key] = stripQuotes(value.trim());
    }
    i += 1;
  }
  return { frontmatter: fm, rest };
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// Pull #tag tokens out of body markdown. Skips code (already stripped),
// skips heading markers, skips fragments inside wikilinks, skips bare #
// in URLs. Tag chars allow letters, digits, hyphen, underscore, and
// forward slash for nested tags. Leading digit is disallowed per
// Obsidian rules.
function extractTagsFromBody(stripped: string): string[] {
  const tags = new Set<string>();
  const re = /(^|[\s(,;!?])#([A-Za-z_][A-Za-z0-9_\-/]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    tags.add(m[2]);
  }
  return [...tags];
}

function extractTagsFromFrontmatter(fm: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const raw = fm.tags ?? fm.tag;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t === "string" && t.trim()) out.add(t.replace(/^#/, "").trim());
    }
  } else if (typeof raw === "string") {
    for (const t of raw.split(/[\s,]+/)) {
      if (t.trim()) out.add(t.replace(/^#/, "").trim());
    }
  }
  return [...out];
}

// Extract [[wikilinks]]. Handles [[Foo]], [[Foo|alias]], [[Foo#section]],
// and [[Foo#section|alias]]. Returns Foo. Optionally resolves the target
// to a vault-relative path via the index.
function extractLinks(stripped: string, vaultIndex?: VaultIndex): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    out.add(resolveLink(target, vaultIndex));
  }
  return [...out];
}

function resolveLink(target: string, vaultIndex?: VaultIndex): string {
  if (!vaultIndex) return target;
  const lower = target.toLowerCase();
  const candidates = [lower, `${lower}.md`];
  for (const c of candidates) {
    const hit = vaultIndex.get(c);
    if (hit) return hit;
  }
  return target;
}

function extractTitle(body: string, fallback: string): string {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (m) return m[1].trim();
  return fallback;
}

export function normalize(
  file: NormalizeFileLike,
  content: string,
  vaultIndex?: VaultIndex,
): NormalizedPage {
  const { frontmatter, rest } = parseFrontmatter(content);
  const body = rest;
  const stripped = stripCode(body);

  const bodyTags = extractTagsFromBody(stripped);
  const fmTags = extractTagsFromFrontmatter(frontmatter);
  const tags = [...new Set([...fmTags, ...bodyTags])];

  const links = extractLinks(stripped, vaultIndex);
  const fmTitle = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  const title = fmTitle || extractTitle(body, file.basename);

  return {
    source_id: file.path,
    title,
    body_markdown: body,
    tags,
    links_out: links,
  };
}
