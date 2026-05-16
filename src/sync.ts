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

export async function syncAll(plugin: CosmosPlugin): Promise<void> {
  if (!plugin.settings.mcpKey || !plugin.settings.polarityUserId) {
    new Notice("Cosmos is not configured. Open settings and run Test connection.");
    return;
  }
  const files = plugin.app.vault.getMarkdownFiles();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const index = buildVaultIndex(plugin);
  const client = new CosmosClient(plugin.settings);

  for (const file of files) {
    try {
      const content = await plugin.app.vault.read(file);
      const hash = await sha256Hex(content);
      const previous = plugin.settings.syncedFiles[file.path];
      if (previous && previous.hash === hash) {
        unchanged += 1;
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
    } catch {
      failed += 1;
    }
  }

  plugin.settings.lastSyncedAt = new Date().toISOString();
  await plugin.saveSettings();
  new Notice(
    `Cosmos sync done. ${created} new, ${updated} updated, ${unchanged} unchanged, ${failed} failed.`,
  );
}
