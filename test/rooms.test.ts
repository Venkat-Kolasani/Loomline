import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createRoomId, isValidRoomId } from "../shared/room";

describe("room id helpers", () => {
  it("accepts 8-char lowercase hex ids", () => {
    expect(isValidRoomId("abcd1234")).toBe(true);
    expect(isValidRoomId("ABCD1234")).toBe(false);
    expect(isValidRoomId("short")).toBe(false);
  });

  it("creates valid random room ids", () => {
    const id = createRoomId();
    expect(isValidRoomId(id)).toBe(true);
  });
});

describe("room Durable Object isolation", () => {
  it("keeps storage isolated across idFromName room ids", async () => {
    const roomA = "aaaa1111";
    const roomB = "bbbb2222";
    expect(isValidRoomId(roomA)).toBe(true);
    expect(isValidRoomId(roomB)).toBe(true);

    const idA = env.ROOM.idFromName(roomA);
    const idB = env.ROOM.idFromName(roomB);
    expect(idA.toString()).not.toBe(idB.toString());

    const stubA = env.ROOM.get(idA);
    const stubB = env.ROOM.get(idB);

    await stubA.fetch(
      new Request("https://room/test/mark", {
        method: "PUT",
        body: "presence-mark-a",
      }),
    );
    await stubB.fetch(
      new Request("https://room/test/mark", {
        method: "PUT",
        body: "presence-mark-b",
      }),
    );

    const valueA = await (
      await stubA.fetch(new Request("https://room/test/mark"))
    ).text();
    const valueB = await (
      await stubB.fetch(new Request("https://room/test/mark"))
    ).text();

    expect(valueA).toBe("presence-mark-a");
    expect(valueB).toBe("presence-mark-b");
    expect(valueA).not.toBe(valueB);
  });
});
