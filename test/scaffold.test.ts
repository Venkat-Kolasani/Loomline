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
      phase: "local-drawing",
    });
  });

  it("exposes a Room Durable Object skeleton", async () => {
    const id = env.ROOM.idFromName("scaffold-room");
    const stub = env.ROOM.get(id);
    const response = await stub.fetch(
      new Request("https://room/scaffold-room"),
    );

    expect(response.status).toBe(200);

    const body: unknown = await response.json();
    expect(body).toMatchObject({
      ok: true,
      role: "room-durable-object",
      status: "skeleton",
    });
  });
});
