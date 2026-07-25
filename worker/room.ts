import { DurableObject } from "cloudflare:workers";

/**
 * RoomDurableObject skeleton.
 *
 * One instance will eventually coordinate a single collaboration room:
 * authoritative sequence assignment, committed operation storage (SQLite),
 * live stroke fan-out, and global undo/redo. This scaffold only proves the
 * binding and class export; it does not accept WebSockets or room protocol
 * messages yet.
 */
export class RoomDurableObject extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({
      ok: true,
      role: "room-durable-object",
      status: "skeleton",
      message:
        "Room behavior (WebSocket, sequencing, persistence) is not implemented yet.",
    });
  }
}
