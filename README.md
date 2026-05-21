# Cosmos for Obsidian

Cosmos is the one knowledge graph that follows you. Add this plugin to point your Obsidian vault at it.

## What it is

The plugin sends your notes to Cosmos as source pages. Each note becomes a reference node in the graph, tagged with the source `obsidian` and keyed by its vault-relative path. Edits flow through as updates. Unchanged notes are skipped server-side, so a re-sync of a quiet vault costs almost nothing.

## What you need

A Cosmos account at cosmos.polarity-lab.com and an MCP key minted from the account settings page. The key starts with `pmk_`. The plugin sends it as `X-MCP-Key` on every request. Cosmos resolves the key to your `polarity_user_id` and writes against that user only.

## Install

There is no community catalog listing yet. Install manually.

1. Clone this repo somewhere outside your vault.
2. Run `npm install`.
3. Run `npm run build`. This produces `main.js` in the repo root.
4. Make a folder at `<vault>/.obsidian/plugins/cosmos/`.
5. Copy `main.js` and `manifest.json` into that folder.
6. Open Obsidian, go to Settings, Community plugins, and enable Cosmos. Allow community plugins first if you have not.

## Settings

Open Settings, then Cosmos. Fields are:

- **API base**. Defaults to `https://cosmos.polarity-lab.com`. Leave it alone unless you are testing against a fork.
- **MCP key**. Paste your `pmk_...` key. Stored locally in the plugin's data file under your vault.
- **Test connection**. Probes `/api/polarity/whoami`. On success the bound `polarity_user_id` is saved and shown below the button.
- **Sync on save**. Pushes a note shortly after you edit it. Off by default.
- **Sync interval**. Minutes between full vault sweeps. Zero disables the timer.

## What gets synced

- The note's body markdown, with the YAML frontmatter stripped.
- The title, taken from the frontmatter `title` if present, otherwise the first H1, otherwise the file name.
- Tags from the frontmatter and from inline `#tag` tokens in the body. Code blocks are ignored.
- Outgoing wikilinks. `[[Foo]]`, `[[Foo|alias]]`, `[[Foo#section]]`, and `[[Foo#section|alias]]` all reduce to `Foo`, then resolve against the vault to a vault-relative path where possible.

## What stays local

The plugin keeps a small map of file path to body hash in its data file so it can skip notes that have not changed. Nothing leaves the device except the deltas. There is no analytics, no telemetry, no third party. The only outbound request is to your configured API base.

## Privacy

Your notes are written to your Cosmos user only. The server stores the body hash, a four-kilobyte excerpt on the reference node, and the full markdown on the source page row. Cosmos applies the same auth and isolation rules as the rest of the Polarity Lab surface.

## Commands

- **Sync vault to Cosmos**. Sweeps every markdown file in the vault.
- **Sync current note to Cosmos**. Sends just the active file.
- **Ribbon icon**. The orbit icon in the left sidebar runs the vault sweep.

## Development

```bash
npm install
npm run dev    # esbuild watch
npm test       # vitest
npm run build  # production bundle
```

The pure normalization logic in `src/normalize.ts` is covered by tests. The plugin glue is not, because it needs the Obsidian runtime.

## License

MIT. See LICENSE.
