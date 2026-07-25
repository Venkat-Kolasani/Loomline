/**
 * Loomline Worker entry.
 *
 * Routes `/ws?room=` to the room Durable Object (idFromName) and serves
 * static assets for the SPA (landing + `/r/:roomId`).
 */

export { RoomDurableObject } from "./room";
import { isValidRoomId } from "../shared/room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "loomline",
        phase: "hardened",
      });
    }

    if (url.pathname === "/ws") {
      return routeRoomWebSocket(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function routeRoomWebSocket(
  request: Request,
  env: Env,
  url: URL,
): Response | Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const roomId = url.searchParams.get("room") ?? "";
  if (!isValidRoomId(roomId)) {
    return new Response("Invalid room id", { status: 400 });
  }

  // idFromName maps each room id string to one stable Durable Object instance.
  // Different room ids never share that instance (platform hash → unique DO id).
  const durableId = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(durableId);
  return stub.fetch(request);
}
