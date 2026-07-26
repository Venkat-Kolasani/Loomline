import type { ActiveTool } from "./stroke";

export interface ToolSettings {
  brushWidth: number;
  eraserWidth: number;
}

export function clampToolWidth(width: number): number {
  return Math.min(32, Math.max(1, Math.round(width)));
}

export function createToolSettings(
  brushWidth = 4,
  eraserWidth = 12,
): ToolSettings {
  return {
    brushWidth: clampToolWidth(brushWidth),
    eraserWidth: clampToolWidth(eraserWidth),
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
  const nextWidth = clampToolWidth(width);
  return tool === "eraser"
    ? { ...settings, eraserWidth: nextWidth }
    : { ...settings, brushWidth: nextWidth };
}
