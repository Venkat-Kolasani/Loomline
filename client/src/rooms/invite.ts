/** Native share/clipboard invite behavior with an explicit manual-copy fallback. */

export interface InviteNavigator {
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  clipboard?: {
    writeText(text: string): Promise<void>;
  };
}

export type InviteResult = "shared" | "copied" | "cancelled" | "manual";

export function createInviteUrl(origin: string, roomId: string): string {
  return new URL(`/r/${encodeURIComponent(roomId)}`, origin).toString();
}

/**
 * Prefer the device share sheet. Clipboard is the desktop/unsupported fallback;
 * a cancelled share is not silently converted into a clipboard write.
 */
export async function shareInvite(
  navigatorLike: InviteNavigator,
  url: string,
): Promise<InviteResult> {
  if (navigatorLike.share) {
    try {
      await navigatorLike.share({
        title: "Join my Loomline room",
        text: "Draw together in this Loomline room.",
        url,
      });
      return "shared";
    } catch (error) {
      if (isShareCancellation(error)) {
        return "cancelled";
      }
    }
  }

  return copyInvite(navigatorLike, url);
}

/** One-click clipboard write for the invite URL (icon control next to the link). */
export async function copyInvite(
  navigatorLike: InviteNavigator,
  url: string,
): Promise<"copied" | "manual"> {
  if (navigatorLike.clipboard) {
    try {
      await navigatorLike.clipboard.writeText(url);
      return "copied";
    } catch {
      // The readonly input remains available for manual selection and copy.
    }
  }
  return "manual";
}

function isShareCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
