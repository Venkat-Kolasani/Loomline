import type { DrawingTool } from "./stroke";

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

export function widthForTool(settings: ToolSettings, tool: DrawingTool): number {
  return tool === "brush" ? settings.brushWidth : settings.eraserWidth;
}

export function withToolWidth(
  settings: ToolSettings,
  tool: DrawingTool,
  width: number,
): ToolSettings {
  const nextWidth = clampToolWidth(width);
  return tool === "brush"
    ? { ...settings, brushWidth: nextWidth }
    : { ...settings, eraserWidth: nextWidth };
}
