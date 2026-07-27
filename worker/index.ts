/**
 * Loomline Worker entry.
 *
 * Routes `/ws?room=` to the room Durable Object (idFromName) and serves
 * static assets for the SPA (landing + `/r/:roomId`). HTML responses for
 * room URLs get share-preview meta so invite links show Loomline branding.
 */

export { RoomDurableObject } from "./room";
import { isValidRoomId } from "../shared/room";

const ROOM_PATH = /^\/r\/([a-z0-9]{8})\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "loomline",
        phase: "observability",
      });
    }

    if (url.pathname === "/api/room-metrics") {
      return routeRoomMetrics(env, url);
    }

    if (url.pathname === "/ws") {
      return routeRoomWebSocket(request, env, url);
    }

    const roomMatch = ROOM_PATH.exec(url.pathname);
    if (roomMatch && request.method === "GET") {
      const roomId = roomMatch[1]!;
      if (isValidRoomId(roomId) && acceptsHtml(request)) {
        return serveRoomSharePage(request, env, url, roomId);
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get("Accept") ?? "";
  return accept.includes("text/html") || accept.includes("*/*") || accept === "";
}

async function serveRoomSharePage(
  _request: Request,
  env: Env,
  url: URL,
  roomId: string,
): Promise<Response> {
  // Fetch the SPA shell by path, not `/r/:id`. Vitest/CI often runs before
  // `dist/client` exists, and Assets has no file at the room URL — SPA
  // not_found_handling is not applied when we already intercepted the path.
  const html = await loadSpaShellHtml(env, url);
  const pageUrl = new URL(`/r/${roomId}`, url.origin).toString();
  const title = `Loomline · ${roomId}`;
  const description = `Join Loomline room ${roomId} and draw together in real time.`;
  const withShareMeta = html
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    );

  return new Response(withShareMeta, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function loadSpaShellHtml(env: Env, url: URL): Promise<string> {
  for (const path of ["/index.html", "/"] as const) {
    const response = await env.ASSETS.fetch(
      new Request(new URL(path, url.origin), {
        method: "GET",
        headers: { Accept: "text/html" },
      }),
    );
    const contentType = response.headers.get("Content-Type") ?? "";
    if (response.ok && contentType.includes("text/html")) {
      return response.text();
    }
  }
  // Minimal shell when Assets are missing (e.g. CI runs tests before build).
  return SHARE_META_SHELL_HTML;
}

/** Placeholders match the replace patterns in serveRoomSharePage. */
const SHARE_META_SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Loomline</title>
    <meta name="description" content="Real-time collaborative drawing canvas." />
    <meta property="og:title" content="Loomline" />
    <meta property="og:description" content="Real-time collaborative drawing canvas." />
    <meta property="og:url" content="https://loomline.example/" />
    <meta name="twitter:title" content="Loomline" />
    <meta name="twitter:description" content="Real-time collaborative drawing canvas." />
  </head>
  <body></body>
</html>
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function routeRoomMetrics(env: Env, url: URL): Response | Promise<Response> {
  const roomId = url.searchParams.get("room") ?? "";
  if (!isValidRoomId(roomId)) {
    return new Response("Invalid room id", { status: 400 });
  }
  const durableId = env.ROOM.idFromName(roomId);
  const stub = env.ROOM.get(durableId);
  return stub.fetch(new Request("https://room/test/durable-head"));
}

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
