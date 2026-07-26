import type { ActiveTool } from "./stroke";

export interface ToolSettings {
  brushWidth: number;
  eraserWidth: number;
}

/** Fixed eraser sizes shown as scaled circle buttons in the toolbar. */
export const ERASER_SIZE_PRESETS = [
  { id: "s", label: "Small", width: 6, dotPx: 8 },
  { id: "m", label: "Medium", width: 12, dotPx: 12 },
  { id: "l", label: "Large", width: 20, dotPx: 18 },
  { id: "xl", label: "Extra large", width: 32, dotPx: 24 },
] as const;

export type EraserSizePresetId = (typeof ERASER_SIZE_PRESETS)[number]["id"];

export function clampToolWidth(width: number): number {
  return Math.min(32, Math.max(1, Math.round(width)));
}

export function createToolSettings(
  brushWidth = 4,
  eraserWidth = 12,
): ToolSettings {
  return {
    brushWidth: clampToolWidth(brushWidth),
    eraserWidth: snapEraserWidth(eraserWidth),
  };
}

/** Rect shares the brush width control (outline stroke weight). */
export function widthForTool(settings: ToolSettings, tool: ActiveTool): number {
  return tool === "eraser" ? settings.eraserWidth : settings.brushWidth;
}

export function withToolWidth(
  settings: ToolSettings,
  tool: ActiveTool,
  width: number,
): ToolSettings {
  if (tool === "eraser") {
    return { ...settings, eraserWidth: snapEraserWidth(width) };
  }
  return { ...settings, brushWidth: clampToolWidth(width) };
}

/** Map any width to the nearest eraser preset (UI has no continuous eraser slider). */
export function snapEraserWidth(width: number): number {
  const clamped = clampToolWidth(width);
  let best: number = ERASER_SIZE_PRESETS[0]!.width;
  let bestDistance = Math.abs(clamped - best);
  for (const preset of ERASER_SIZE_PRESETS) {
    const distance = Math.abs(clamped - preset.width);
    if (distance < bestDistance) {
      best = preset.width;
      bestDistance = distance;
    }
  }
  return best;
}

export function eraserPresetIdForWidth(width: number): EraserSizePresetId {
  const snapped = snapEraserWidth(width);
  const match = ERASER_SIZE_PRESETS.find((preset) => preset.width === snapped);
  return match?.id ?? "m";
}
