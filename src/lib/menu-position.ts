export type MenuAnchor = { right: number; top: number; bottom: number };

/** Keep the menu aligned with its trigger; scroll long menus instead of covering it. */
export function menuPosition(
  anchor: MenuAnchor,
  width: number,
  height: number,
  viewport: { width: number; height: number },
) {
  const margin = 8,
    gap = 6;
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const opensBelow = height <= below || below >= above;
  const maxHeight = Math.max(36, opensBelow ? below : above);
  return {
    x: Math.max(
      margin,
      Math.min(anchor.right - width, viewport.width - width - margin),
    ),
    y: opensBelow
      ? anchor.bottom + gap
      : Math.max(margin, anchor.top - Math.min(height, maxHeight) - gap),
    maxHeight,
  };
}
