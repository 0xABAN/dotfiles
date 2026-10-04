// configs:powerline-compact-v1
/** One compact footer row: reserve model/context before optional metadata. */
function computeCompactLayout(
  ctx: SegmentContext,
  segments: ReturnType<typeof mergeSegmentsWithCustomItems>,
  style: StatusLineSeparatorStyle,
  width: number,
): { topContent: string; secondaryContent: string } {
  const ids = [...segments.leftSegments, ...segments.rightSegments, ...segments.secondarySegments];
  const rendered = new Map(ids.map(id => [id, renderSegmentWithWidth(id, ctx)]));
  const parts: { content: string; right: boolean }[] = [];
  const context = rendered.get("context_pct");
  if (context?.visible) {
    let content = context.content.replace(" context", "");
    if (width < 60) content = content.replace(/ \[[▰▱-]{5}\]/, "");
    parts.push({ content, right: true });
  }

  const model = rendered.get("model");
  if (model?.visible) {
    const remaining = width - visibleWidth(buildAlignedContent(parts, style, 0)) - 3;
    if (remaining > 0) {
      parts.unshift({ content: truncateToWidth(model.content, remaining, "…"), right: false });
    }
  }

  // Try later small segments even when an earlier path/branch is too long.
  // Queue details have their own persistent preview; never spend another row here.
  const optionalIds = new Set<StatusLineSegmentId>(["shell_mode", ...ids]);
  for (const id of optionalIds) {
    if (id === "model" || id === "context_pct" || id === "queue") continue;
    const segment = rendered.get(id);
    if (!segment?.visible) continue;
    const candidate = { content: segment.content, right: segments.rightSegments.includes(id) };
    if (visibleWidth(buildAlignedContent([...parts, candidate], style, 0)) <= width) {
      parts.push(candidate);
    }
  }

  return {
    topContent: truncateToWidth(buildAlignedContent(parts, style, width), width, "…"),
    secondaryContent: "",
  };
}
