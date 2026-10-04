// configs:powerline-layout-v1
/** Keep ANSI-aware left/right groups at opposite edges, including overflow rows. */
function buildAlignedContent(
  parts: { content: string; right: boolean }[],
  style: StatusLineSeparatorStyle,
  width: number,
): string {
  const left = buildContentFromParts(parts.filter(p => !p.right).map(p => p.content), style);
  const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style, "");
  if (!right) return left;
  const gap = width - visibleWidth(left) - visibleWidth(right);
  // Existing packing is conservative. Fall back rather than exceed tiny widths.
  if (gap < 0) return buildContentFromParts(parts.map(p => p.content), style);
  return left + " ".repeat(gap) + right;
}
