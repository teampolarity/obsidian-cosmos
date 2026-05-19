import type { CosmosSettings } from "./settings";

export interface WhoamiResponse {
  polarity_user_id: string;
  cosmos_user_id: number;
  scopes?: string[];
  created_at?: string;
}

export interface SourcePagePayload {
  source: "obsidian";
  source_id: string;
  title: string;
  body_markdown: string;
  tags: string[];
  links_out: string[];
}

export interface SourcePageResponse {
  status: "created" | "updated" | "unchanged";
  node_id: number;
  source_page_id: number;
}

export class CosmosError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Cosmos ${status} on ${path}. ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
}

// Thin wrapper. Mirrors the cosmos-mcp client's request shape so the
// server sees identical headers regardless of which client called.
export class CosmosClient {
  constructor(private readonly settings: CosmosSettings) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const base = this.settings.apiBase.replace(/\/+$/, "");
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-MCP-Key": this.settings.mcpKey,
      "User-Agent": "obsidian-cosmos/0.2.1",
    };
    if (this.settings.polarityUserId) {
      headers["X-Polarity-User-Id"] = this.settings.polarityUserId;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text
      }
    }
    if (!res.ok) throw new CosmosError(res.status, path, parsed);
    return parsed as T;
  }

  whoami(): Promise<WhoamiResponse> {
    return this.request<WhoamiResponse>("GET", "/api/polarity/whoami");
  }

  sourcePage(payload: SourcePagePayload): Promise<SourcePageResponse> {
    if (!this.settings.polarityUserId) {
      throw new Error("polarity_user_id is not set. Run Test connection first.");
    }
    return this.request<SourcePageResponse>("POST", "/api/polarity/source-page", {
      polarity_user_id: this.settings.polarityUserId,
      ...payload,
    });
  }
}
