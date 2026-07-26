/** Quick brush colours for the toolbar; custom picker remains available. */

export const COLOR_PRESETS = [
  "#0f6a5a",
  "#1d4ed8",
  "#b45309",
  "#be123c",
  "#334155",
  "#7c3aed",
  "#0f766e",
  "#111827",
] as const;

export type ColorPreset = (typeof COLOR_PRESETS)[number];

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function isColorPreset(value: string): value is ColorPreset {
  const normalized = normalizeHexColor(value);
  return (
    normalized !== null &&
    (COLOR_PRESETS as readonly string[]).includes(normalized)
  );
}
