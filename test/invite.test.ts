import { describe, expect, it, vi } from "vitest";
import { createInviteUrl, shareInvite } from "../client/src/rooms/invite";

describe("room invite sharing", () => {
  it("creates the canonical room URL without carrying local debug state", () => {
    expect(createInviteUrl("https://loomline.example", "abcd1234")).toBe(
      "https://loomline.example/r/abcd1234",
    );
  });

  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const clipboard = { writeText: vi.fn() };

    await expect(
      shareInvite({ share, clipboard }, "https://loomline.example/r/abcd1234"),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Join my Loomline room",
      text: "Draw together in this Loomline room.",
      url: "https://loomline.example/r/abcd1234",
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies when the share sheet is unavailable or fails", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await expect(
      shareInvite({ clipboard }, "https://loomline.example/r/abcd1234"),
    ).resolves.toBe("copied");

    await expect(
      shareInvite(
        { share: vi.fn().mockRejectedValue(new Error("unsupported")), clipboard },
        "https://loomline.example/r/abcd1234",
      ),
    ).resolves.toBe("copied");
  });

  it("does not overwrite the clipboard when a user cancels sharing", async () => {
    const clipboard = { writeText: vi.fn() };
    await expect(
      shareInvite(
        {
          share: vi.fn().mockRejectedValue({ name: "AbortError" }),
          clipboard,
        },
        "https://loomline.example/r/abcd1234",
      ),
    ).resolves.toBe("cancelled");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("leaves a manual selection fallback when no API can complete", async () => {
    await expect(
      shareInvite({}, "https://loomline.example/r/abcd1234"),
    ).resolves.toBe("manual");
  });
});
