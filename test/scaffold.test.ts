import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Loomline scaffold", () => {
  it("serves a health response from the Worker entry", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/api/health"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);

    const body: unknown = await response.json();
    expect(body).toMatchObject({
      ok: true,
      service: "loomline",
      phase: "reconnect",
    });
  });

  it("exposes a Room Durable Object that rejects non-WebSocket fetches", async () => {
    const id = env.ROOM.idFromName("scaffold-room");
    const stub = env.ROOM.get(id);
    const response = await stub.fetch(
      new Request("https://room/scaffold-room"),
    );

    expect(response.status).toBe(426);
  });
});
