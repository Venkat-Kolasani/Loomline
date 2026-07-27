import { describe, expect, it } from "vitest";
import {
  ARTIST_NAME_STORAGE_KEY,
  createArtistName,
  loadArtistName,
  MAX_ARTIST_NAME_LENGTH,
  normalizeArtistName,
  saveArtistName,
  type NameStorage,
} from "../client/src/identity/artist-name";

describe("artist-name preference", () => {
  it("accepts a trimmed 1–24-character nickname and rejects invalid input", () => {
    expect(normalizeArtistName("  Loom Artist  ")).toBe("Loom Artist");
    expect(normalizeArtistName("   ")).toBeNull();
    expect(normalizeArtistName("x".repeat(MAX_ARTIST_NAME_LENGTH + 1))).toBeNull();
  });

  it("creates readable random fallback names", () => {
    expect(createArtistName(() => 0)).toBe("Amber Brush");
    expect(createArtistName(() => 0.999)).toBe("Velvet Willow");
    for (let i = 0; i < 40; i += 1) {
      const name = createArtistName(() => (i + 0.5) / 40);
      expect(normalizeArtistName(name)).toBe(name);
      expect(name.includes(" ")).toBe(true);
    }
  });

  it("persists only valid values and reads them back", () => {
    const storage = new MemoryStorage();

    expect(saveArtistName(storage, "  Moss Finch ")).toBe(true);
    expect(storage.getItem(ARTIST_NAME_STORAGE_KEY)).toBe("Moss Finch");
    expect(loadArtistName(storage)).toBe("Moss Finch");
    expect(saveArtistName(storage, " ")).toBe(false);
  });

  it("falls back safely when browser storage is unavailable", () => {
    const unavailable: NameStorage = {
      getItem: () => {
        throw new Error("Storage denied");
      },
      setItem: () => {
        throw new Error("Storage denied");
      },
    };

    expect(loadArtistName(unavailable)).toBeNull();
    expect(saveArtistName(unavailable, "Cedar Kite")).toBe(false);
  });
});

class MemoryStorage implements NameStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
