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
      phase: "observability",
    });
  });

  it("injects room-specific share meta on invite HTML", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/r/abcd1234", {
        headers: { Accept: "text/html" },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Loomline · abcd1234</title>");
    expect(html).toContain('property="og:title" content="Loomline · abcd1234"');
    expect(html).toContain('property="og:url" content="https://example.com/r/abcd1234"');
    expect(html).toContain("Join Loomline room abcd1234");
  });
});
