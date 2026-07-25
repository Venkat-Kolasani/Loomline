/**
 * RelayCanvas Worker entry.
 *
 * Serves built static assets via the ASSETS binding and exposes a health
 * endpoint for scaffold verification. Room WebSocket routing is intentionally
 * not implemented in this slice.
 */

export { RoomDurableObject } from "./room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "relaycanvas",
        phase: "scaffold",
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
