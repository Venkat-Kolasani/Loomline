/**
 * Keep a provisional eraser when the durable op has fewer points so the hole
 * cannot shrink (erased ink "growing back") on the provisional→committed swap.
 */
export function retainProvisionalEraser(
  provisionalPointCount: number,
  committedPointCount: number,
): boolean {
  return committedPointCount < provisionalPointCount;
}
