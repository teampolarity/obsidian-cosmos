import { Notice, TFile } from "obsidian";
import type CosmosPlugin from "./main";
import { CosmosClient } from "./cosmos-client";
import { normalize, type VaultIndex } from "./normalize";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildVaultIndex(plugin: CosmosPlugin): VaultIndex {
  const idx: VaultIndex = new Map();
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    idx.set(f.path.toLowerCase(), f.path);
    idx.set(f.basename.toLowerCase(), f.path);
    idx.set(`${f.basename.toLowerCase()}.md`, f.path);
  }
  return idx;
}

export async function syncOne(plugin: CosmosPlugin, file: TFile): Promise<void> {
  if (!plugin.settings.mcpKey || !plugin.settings.polarityUserId) {
    new Notice("Cosmos is not configured. Open settings and run Test connection.");
    return;
  }
  const content = await plugin.app.vault.read(file);
  const hash = await sha256Hex(content);
  const previous = plugin.settings.syncedFiles[file.path];
  if (previous && previous.hash === hash) {
    return;
  }
  const index = buildVaultIndex(plugin);
  const normalized = normalize({ path: file.path, basename: file.basename }, content, index);

  const client = new CosmosClient(plugin.settings);
  try {
    const res = await client.sourcePage({
      source: "obsidian",
      source_id: normalized.source_id,
      title: normalized.title,
      body_markdown: normalized.body_markdown,
      tags: normalized.tags,
      links_out: normalized.links_out,
    });
    const now = new Date().toISOString();
    plugin.settings.syncedFiles[file.path] = { hash, syncedAt: now };
    plugin.settings.lastSyncedAt = now;
    await plugin.saveSettings();
    if (res.status !== "unchanged") {
      new Notice(`Cosmos ${res.status}. ${file.basename}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    new Notice(`Cosmos sync failed. ${msg}`);
  }
}

export async function syncAll(plugin: CosmosPlugin, opts: { silent?: boolean } = {}): Promise<void> {
  if (!plugin.settings.mcpKey || !plugin.settings.polarityUserId) {
    if (!opts.silent) new Notice("Cosmos is not configured. Open settings and run Test connection.");
    return;
  }
  const all = plugin.app.vault.getMarkdownFiles();
  // Bulk-walk watermark. Two layers of dedup now: the mtime filter
  // skips files we know are older than the last completed walk
  // (cheap, no I/O), and the per-file hash check below catches the
  // case where mtime advanced but the body did not (touch, frontmatter
  // shuffle). On an unchanged vault the mtime filter alone drops
  // every file before any read.
  const watermark = plugin.settings.lastIncrementalMtimeMs || 0;
  const fresh = all.filter((f) => (f.stat?.mtime || 0) > watermark);

  if (fresh.length === 0) {
    if (!opts.silent) new Notice(`Cosmos: nothing new (${all.length} notes already up to date).`);
    plugin.settings.lastSyncedAt = new Date().toISOString();
    await plugin.saveSettings();
    return;
  }

  // Newest-first ordering: if the walk is interrupted (plugin reload,
  // Obsidian quit) the next run's watermark lands on real progress
  // instead of leaving newer files unsynced behind a fresh watermark.
  fresh.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let maxMtime = 0;
  const index = buildVaultIndex(plugin);
  const client = new CosmosClient(plugin.settings);

  for (const file of fresh) {
    try {
      const content = await plugin.app.vault.read(file);
      const hash = await sha256Hex(content);
      const previous = plugin.settings.syncedFiles[file.path];
      const mt = file.stat?.mtime || 0;
      if (previous && previous.hash === hash) {
        unchanged += 1;
        if (mt > maxMtime) maxMtime = mt;
        continue;
      }
      const normalized = normalize({ path: file.path, basename: file.basename }, content, index);
      const res = await client.sourcePage({
        source: "obsidian",
        source_id: normalized.source_id,
        title: normalized.title,
        body_markdown: normalized.body_markdown,
        tags: normalized.tags,
        links_out: normalized.links_out,
      });
      const now = new Date().toISOString();
      plugin.settings.syncedFiles[file.path] = { hash, syncedAt: now };
      if (res.status === "created") created += 1;
      else if (res.status === "updated") updated += 1;
      else unchanged += 1;
      if (mt > maxMtime) maxMtime = mt;
    } catch {
      failed += 1;
    }
  }

  // Promote the watermark only on walk completion (mirrors the Notion
  // server-side pending → committed pattern). If something blew up
  // mid-walk we keep the prior watermark so the retry covers the gap.
  if (maxMtime > 0 && failed === 0) {
    plugin.settings.lastIncrementalMtimeMs = maxMtime;
  }
  plugin.settings.lastSyncedAt = new Date().toISOString();
  await plugin.saveSettings();
  if (!opts.silent) {
    new Notice(
      `Cosmos sync done. ${created} new, ${updated} updated, ${unchanged} unchanged, ${failed} failed.`,
    );
  }
}

// Catch up on edits made while the plugin was off. Runs on plugin
// load. `vault.on('modify')` only fires while the plugin is active,
// so any edits made with Obsidian closed (or with the plugin
// disabled, or from another device via Obsidian Sync) would
// otherwise wait for the next interval timer or manual sync. The
// watermark short-circuit means this returns in milliseconds on a
// quiet vault.
export async function syncIncrementalCatchup(plugin: CosmosPlugin): Promise<void> {
  if (!plugin.settings.mcpKey || !plugin.settings.polarityUserId) return;
  if (!plugin.settings.lastIncrementalMtimeMs) return; // first run handled by manual syncAll
  await syncAll(plugin, { silent: true });
}
