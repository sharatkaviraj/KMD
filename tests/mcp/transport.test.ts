import { describe, expect, it } from "vitest";

import { handleMcp } from "@/modules/mcp/domain/mcp";
import { sha256Hex } from "@/modules/mcp/domain/crypto";

import { connect, MCP_URL, mcpRequest, ORIGIN, setup } from "./harness";

const PRM = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("the MCP endpoint's authentication", () => {
  it("answers a request with no token 401 and points at the protected-resource metadata", async () => {
    const h = setup();
    const response = await handleMcp(mcpRequest(h, null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }), h.mcp);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PRM}", scope="one.read"`);
  });

  it("answers an expired access token 401 invalid_token with the same pointer", async () => {
    const h = setup();
    const tokens = await connect(h);
    const ok = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp);
    expect(ok.status).toBe(200);
    h.store.advance(15 * 60_000 + 1);
    const late = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp);
    expect(late.status).toBe(401);
    const challenge = late.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="/);
    expect(challenge).toContain(`resource_metadata="${PRM}"`);
  });

  it("refuses a refresh token, an unknown token and a malformed header", async () => {
    const h = setup();
    const tokens = await connect(h);
    for (const token of [tokens.refresh_token, "x".repeat(43)]) {
      expect((await handleMcp(mcpRequest(h, token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
    }
    const malformed = await handleMcp(mcpRequest(h, null, { jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: "Basic abc" }), h.mcp);
    expect(malformed.status).toBe(401);
    expect(malformed.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("never accepts a token in the query string", async () => {
    const h = setup();
    const tokens = await connect(h);
    const request = new Request(`${MCP_URL}?access_token=${tokens.access_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect((await handleMcp(request, h.mcp)).status).toBe(401);
  });

  it("refuses a token issued for another resource (audience)", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.store.tokens.get(await sha256Hex(tokens.access_token))!.resource = "https://vppsone.vercel.app/api/mcp";
    expect((await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
  });

  it("answers 401 once the connection is revoked (Disconnect)", async () => {
    const h = setup();
    const tokens = await connect(h);
    const connection = [...h.store.connections.values()][0];
    await h.store.revokeConnection(connection.id, "disconnected_by_self", connection.staffProfileId);
    expect((await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
  });

  it("answers 401 after the 90-day grant ends", async () => {
    const h = setup();
    const tokens = await connect(h);
    const connection = [...h.store.connections.values()][0];
    connection.expiresAt = h.store.now - 1;
    expect((await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp)).status).toBe(401);
  });

  it("fails closed with 503 when the store cannot be read", async () => {
    const h = setup();
    const tokens = await connect(h);
    h.store.resolveToken = async () => {
      throw new Error("database down");
    };
    const response = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }), h.mcp);
    expect(response.status).toBe(503);
  });
});

describe("the Streamable HTTP transport", () => {
  it("answers GET and DELETE 405 with Allow: POST", async () => {
    const h = setup();
    for (const method of ["GET", "DELETE"]) {
      const response = await handleMcp(new Request(MCP_URL, { method }), h.mcp);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("refuses a browser Origin that is not a provider's (DNS rebinding)", async () => {
    const h = setup();
    const tokens = await connect(h);
    const evil = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://evil.example" }), h.mcp);
    expect(evil.status).toBe(403);
    const local = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "http://localhost:6274" }), h.mcp);
    expect(local.status).toBe(403); // production: no localhost origins
    const claude = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://claude.ai" }), h.mcp);
    expect(claude.status).toBe(200);
  });

  it("negotiates the protocol version and sets no session id", async () => {
    const h = setup();
    const tokens = await connect(h);
    for (const [asked, answered] of [["2025-06-18", "2025-06-18"], ["2025-03-26", "2025-03-26"], ["2025-11-25", "2025-11-25"], ["2099-01-01", "2025-11-25"]]) {
      const response = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: "t", version: "1" } } }), h.mcp);
      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      const result = (await body(response)).result as Record<string, unknown>;
      expect(result.protocolVersion).toBe(answered);
      expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    }
  });

  it("answers notifications 202 with no body", async () => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" }), h.mcp);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("refuses an unsupported MCP-Protocol-Version header with 400", async () => {
    const h = setup();
    const tokens = await connect(h);
    const response = await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "MCP-Protocol-Version": "2026-07-28" }), h.mcp);
    expect(response.status).toBe(400);
  });

  it("handles a batch and refuses an empty or oversized one", async () => {
    const h = setup();
    const tokens = await connect(h);
    const batch = await handleMcp(
      mcpRequest(h, tokens.access_token, [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
      h.mcp,
    );
    const replies = (await batch.json()) as { id: number }[];
    expect(replies.map((reply) => reply.id)).toEqual([1, 2]);
    expect((await handleMcp(mcpRequest(h, tokens.access_token, []), h.mcp)).status).toBe(400);
    const big = Array.from({ length: 11 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" }));
    expect((await handleMcp(mcpRequest(h, tokens.access_token, big), h.mcp)).status).toBe(400);
  });

  it("answers malformed JSON-RPC with JSON-RPC errors", async () => {
    const h = setup();
    const tokens = await connect(h);
    const parse = await handleMcp(mcpRequest(h, tokens.access_token, "{not json"), h.mcp);
    expect(parse.status).toBe(400);
    expect(((await body(parse)).error as { code: number }).code).toBe(-32700);
    const unknown = await body(await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 3, method: "resources/list" }), h.mcp));
    expect((unknown.error as { code: number }).code).toBe(-32601);
    const notJson = await handleMcp(mcpRequest(h, tokens.access_token, "{}", { "Content-Type": "text/plain" }), h.mcp);
    expect(notJson.status).toBe(415);
  });

  it("lists every tool read-only", async () => {
    const h = setup();
    const tokens = await connect(h);
    const list = await body(await handleMcp(mcpRequest(h, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" }), h.mcp));
    const tools = (list.result as { tools: { name: string; annotations: Record<string, unknown>; inputSchema: Record<string, unknown> }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["get_context", "school_day_summary", "who_is_away", "cover_plan", "pending_leave"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });
});
