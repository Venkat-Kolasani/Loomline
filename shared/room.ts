/** Room identity helpers and participant metadata shared by client and Worker. */

/**
 * 4: adds `shape:rect` / `kind: "rect"` committed ops (normalized start/end).
 * 3: stroke and cursor coordinates are normalized fractions of the sender's
 * canvas box instead of that client's CSS pixels. A version 2 client mixed
 * into a version 3 room would paint pixel values as fractions, so the bump is
 * what keeps the two coordinate spaces from meeting.
 */
export const PROTOCOL_VERSION = 4 as const;

export const ROOM_ID_PATTERN = /^[a-z0-9]{8}$/;

export const PARTICIPANT_COLORS = [
  "#0f6a5a",
  "#b45309",
  "#1d4ed8",
  "#be123c",
  "#7c3aed",
  "#0f766e",
  "#a16207",
  "#334155",
] as const;

export interface Participant {
  id: string;
  displayName: string;
  color: string;
}

export interface SocketAttachment {
  participantId: string;
  displayName: string;
  color: string;
  roomId: string;
}

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

/** Cryptographically random 8-char lowercase hex room id. */
export function createRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function colorForParticipantId(participantId: string): string {
  let hash = 0;
  for (let i = 0; i < participantId.length; i += 1) {
    hash = (hash * 31 + participantId.charCodeAt(i)) >>> 0;
  }
  return PARTICIPANT_COLORS[hash % PARTICIPANT_COLORS.length]!;
}

export function defaultDisplayName(participantId: string): string {
  return `Artist-${participantId.slice(0, 4)}`;
}
