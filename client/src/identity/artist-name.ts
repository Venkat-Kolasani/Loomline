/**
 * Browser-local, anonymous artist-name preference.
 *
 * This is deliberately not an identity system: the Durable Object remains the
 * authority for each joined participant and sanitizes the transmitted value.
 */

export const ARTIST_NAME_STORAGE_KEY = "loomline.artist-name.v1";
export const MAX_ARTIST_NAME_LENGTH = 24;

export interface NameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ADJECTIVES = [
  "Amber",
  "Bright",
  "Calm",
  "Cedar",
  "Coral",
  "Cosmic",
  "Dapper",
  "Dusk",
  "Gentle",
  "Golden",
  "Ivory",
  "Jade",
  "Lumen",
  "Misty",
  "Moss",
  "Noble",
  "Olive",
  "Pearl",
  "Quiet",
  "Rapid",
  "Silver",
  "Solar",
  "Storm",
  "Velvet",
] as const;

const NOUNS = [
  "Brush",
  "Canvas",
  "Comet",
  "Creek",
  "Echo",
  "Fern",
  "Finch",
  "Forge",
  "Glow",
  "Harbor",
  "Ink",
  "Kite",
  "Lantern",
  "Maple",
  "Nest",
  "Orbit",
  "Quill",
  "Ridge",
  "Spark",
  "Stone",
  "Tide",
  "Trail",
  "Wave",
  "Willow",
] as const;

/** Return a trimmed 1–24-character name, or null when it is not valid. */
export function normalizeArtistName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_ARTIST_NAME_LENGTH) {
    return null;
  }
  return name;
}

/** Create a readable, anonymous fallback without an opaque generated suffix. */
export function createArtistName(random: () => number = Math.random): string {
  return `${pick(ADJECTIVES, random)} ${pick(NOUNS, random)}`;
}

/** Read a saved value safely; privacy modes may deny localStorage access. */
export function loadArtistName(storage: NameStorage | null): string | null {
  if (!storage) {
    return null;
  }
  try {
    const value = storage.getItem(ARTIST_NAME_STORAGE_KEY);
    return value === null ? null : normalizeArtistName(value);
  } catch {
    return null;
  }
}

/** Persist only a name that has passed the same client-side validation. */
export function saveArtistName(storage: NameStorage | null, name: string): boolean {
  const normalized = normalizeArtistName(name);
  if (!storage || normalized === null) {
    return false;
  }
  try {
    storage.setItem(ARTIST_NAME_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.floor(random() * values.length)),
  );
  return values[index]!;
}
