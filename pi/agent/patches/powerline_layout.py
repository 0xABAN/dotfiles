#!/usr/bin/env python3
"""Add aligned footer groups and an opt-in context meter to pinned powerline.

Validate every file before writing. Preserve unrelated local patches; refuse
partial/changed upstream anchors instead of guessing. Re-run after updates.
"""
from pathlib import Path

from patch_support import read_payload


# Current output is readable on its own; only legacy variants are derived.
ALIGN = read_payload('powerline/aligned_content.ts.inc') + "\n"
LEGACY_ALIGN = ALIGN.replace(
    'const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style, "");',
    'const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style);',
)

METER = read_payload('powerline/context_meter.ts.inc') + "\n"
LEGACY_METER = METER.replace('return "● [-----]', 'return "[-----]').replace('return `● [${', 'return `[${')


EDITS = {
    "index.ts": [
        ("function computeResponsiveLayout(", ALIGN + "function computeResponsiveLayout("),
        ("const renderedSegments: { content: string; width: number }[] = [];",
         "const renderedSegments: { content: string; width: number; right: boolean }[] = [];"),
        ("renderedSegments.push({ content, width });",
         "renderedSegments.push({ content, width, right: mergedSegments.rightSegments.includes(segId) });"),
        ("let topSegments: string[] = [];",
         "let topSegments: typeof renderedSegments = [];"),
        ("let overflowSegments: { content: string; width: number }[] = [];",
         "let overflowSegments: typeof renderedSegments = [];"),
        ("topSegments.push(seg.content);", "topSegments.push(seg);"),
        ("let secondarySegments: string[] = [];",
         "let secondarySegments: typeof renderedSegments = [];"),
        ("secondarySegments.push(seg.content);", "secondarySegments.push(seg);"),
        ("topContent: buildContentFromParts(topSegments, separatorStyle),",
         "topContent: buildAlignedContent(topSegments, separatorStyle, availableWidth),"),
        ("secondaryContent: buildContentFromParts(secondarySegments, separatorStyle),",
         "secondaryContent: buildAlignedContent(secondarySegments, separatorStyle, availableWidth),"),
    ],
    "segments.ts": [
        ("const contextPctSegment: StatusLineSegment = {", METER + "const contextPctSegment: StatusLineSegment = {"),
        ('const percentOnly = ctx.options.context?.format === "percent";',
         'const meter = ctx.options.context?.format === "meter";\n    const percentOnly = meter || ctx.options.context?.format === "percent";'),
        ("const text = percentOnly\n      ? (hasKnownUsage",
         "const text = meter\n      ? contextMeter(hasKnownUsage ? contextPercent : null, !!ctx.contextApproximate)\n      : percentOnly\n      ? (hasKnownUsage"),
    ],
    "types.ts": [
        ('context?: { format?: "full" | "percent" };',
         'context?: { format?: "full" | "percent" | "meter" };'),
    ],
    "powerline-config.ts": [
        ('raw.context.format === "full" || raw.context.format === "percent" ?',
         'raw.context.format === "full" || raw.context.format === "percent" || raw.context.format === "meter" ?'),
    ],
}


UNSTAGED_EDIT = (
    'indicators.push(applyColor(ctx.theme, "warning", `*${gitStatus.unstaged}`));',
    'indicators.push(applyColor(ctx.theme, "muted", `*${gitStatus.unstaged}`));',
)


SEPARATOR_EDIT = (
    'const sep = separatorDef.left;',
    'const sep = separator ?? (separatorStyle === "chevron" ? "❯" : separatorDef.left);',
)
LEGACY_SEPARATOR = 'const sep = separatorStyle === "chevron" ? "❯" : separatorDef.left;'
SEPARATOR_ARGUMENT_EDIT = (
    '''function buildContentFromParts(
  parts: string[],
  separatorStyle: StatusLineSeparatorStyle,
): string {''',
    '''function buildContentFromParts(
  parts: string[],
  separatorStyle: StatusLineSeparatorStyle,
  separator?: string,
): string {''',
)


SEPARATOR_JOIN_EDIT = (
    'parts.join(` ${sepAnsi}${sep}${ansi.reset} `)',
    'parts.join(separator === "" ? " " : ` ${sepAnsi}${sep}${ansi.reset} `)',
)


COMPACT_EDITS = [
    ("/** Render a single segment and return its content with width */",
     read_payload("powerline/compact_layout.ts.inc") + "\n/** Render a single segment and return its content with width */"),
    ("  availableWidth: number\n): { topContent: string; secondaryContent: string } {",
     "  availableWidth: number,\n  availableRows = Infinity\n): { topContent: string; secondaryContent: string } {"),
    ("  const primaryIds = [...mergedSegments.leftSegments, ...mergedSegments.rightSegments];",
     "  if (availableWidth < 80 || availableRows < 24) {\n"
     "    return computeCompactLayout(ctx, mergedSegments, separatorStyle, availableWidth);\n"
     "  }\n\n  const primaryIds = [...mergedSegments.leftSegments, ...mergedSegments.rightSegments];"),
    ("  let lastLayoutWidth = 0;", "  let lastLayoutWidth = 0;\n  let lastLayoutRows = Infinity;"),
    ("function getResponsiveLayout(width: number, theme: Theme)",
     "function getResponsiveLayout(width: number, theme: Theme, rows = Infinity)"),
    ("lastLayoutResult && lastLayoutWidth === width", "lastLayoutResult && lastLayoutWidth === width && lastLayoutRows === rows"),
    ("    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);",
     "    lastLayoutRows = rows;\n    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width, rows);"),
    ("function renderPowerlinePrimaryLines(width: number, theme: Theme)",
     "function renderPowerlinePrimaryLines(width: number, theme: Theme, rows = Infinity)"),
    ("function renderPowerlineSecondaryLines(width: number, theme: Theme)",
     "function renderPowerlineSecondaryLines(width: number, theme: Theme, rows = Infinity)"),
    ("    const layout = getResponsiveLayout(width, theme);\n    return layout.topContent",
     "    const layout = getResponsiveLayout(width, theme, rows);\n    return layout.topContent"),
    ("    const layout = getResponsiveLayout(width, theme);\n    return layout.secondaryContent",
     "    const layout = getResponsiveLayout(width, theme, rows);\n    return layout.secondaryContent"),
    ("return renderPowerlinePrimaryLines(width, theme);", "return renderPowerlinePrimaryLines(width, theme, _tui.terminal.rows);"),
    ("return renderPowerlineSecondaryLines(width, theme);", "return renderPowerlineSecondaryLines(width, theme, _tui.terminal.rows);"),
    ("function renderBashTranscriptLines(width: number, theme: Theme)",
     "function renderBashTranscriptLines(width: number, theme: Theme, rows = Infinity)"),
    ("return renderBashTranscriptLines(width, theme);", "return renderBashTranscriptLines(width, theme, _tui.terminal.rows);"),
    ("    if (snapshot.commands.length === 0) return [];",
     "    if (snapshot.commands.length === 0) return [];\n\n" + read_payload("powerline/compact_bash.ts.inc").rstrip("\n")),
    ("function renderPowerlineQueuePreviewLines(width: number, theme: Theme)",
     "function renderPowerlineQueuePreviewLines(width: number, theme: Theme, rows = Infinity)"),
    ("return renderPowerlineQueuePreviewLines(width, theme);", "return renderPowerlineQueuePreviewLines(width, theme, _tui.terminal.rows);"),
    ("    if (!summary.leadingText) return [];",
     read_payload("powerline/compact_queue.ts.inc") + "    if (!summary.leadingText) return [];"),
    ("    if (bashModeActive || !showLastPrompt || !lastUserPrompt) return [];",
     "    // The footer factory owns tuiRef; keep the DJ-owned widget byte-identical.\n"
     "    if ((tuiRef?.terminal.rows ?? Infinity) < 24) return [];\n"
     "    if (bashModeActive || !showLastPrompt || !lastUserPrompt) return [];"),
    ("      if (visibleWidth(lineContent) <= width) {\n        notifications.push(lineContent);\n      }",
     "      if (width < 80) {\n        notifications.push(truncateToWidth(lineContent, width, \"…\"));\n"
     "      } else if (visibleWidth(lineContent) <= width) {\n        notifications.push(lineContent);\n      }"),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Upgrade a complete earlier layout or replay the complete compact variant."""
    sources = dict(sources)
    index = sources["index.ts"]
    compact_states = []
    for old, new in COMPACT_EDITS:
        # Replacements can contain their own original anchor. Ignore that one,
        # but still reject stray originals and duplicate/modified replacements.
        if index.count(new) == 1 and old not in index.replace(new, "", 1):
            compact_states.append("patched")
        elif index.count(new) == 0 and index.count(old) == 1:
            compact_states.append("original")
        else:
            raise ValueError(f"compact powerline anchor changed or duplicated: {old[:70]}")
    if len(set(compact_states)) != 1:
        raise ValueError("partial compact powerline patch; inspect before reapplying")
    if compact_states[0] == "patched":
        for old, new in COMPACT_EDITS:
            index = index.replace(new, old, 1)
        sources["index.ts"] = index

    result = patch_layout_sources(sources)
    for old, new in COMPACT_EDITS:
        result["index.ts"] = result["index.ts"].replace(old, new, 1)
    return result


def patch_layout_sources(sources: dict[str, str]) -> dict[str, str]:
    """Accept a wholly original or wholly patched set, never a partial patch."""
    # Small appearance upgrades also apply over an already-installed layout.
    # Keep other warning colors and separator styles intact.
    sources = dict(sources)
    for previous_color in ["95, 168, 118", "94, 158, 128", "94, 158, 170", "67, 145, 135"]:
        previous_align = LEGACY_ALIGN.replace(
            "const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style);",
            'const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style,\n'
            f'    ansi.getFgAnsi({previous_color}) + "●" + ansi.reset);',
        )
        sources["index.ts"] = sources["index.ts"].replace(previous_align, ALIGN)
    sources["segments.ts"] = sources["segments.ts"].replace(LEGACY_METER, METER).replace(
        'indicators.push(applyColor(ctx.theme, "#85877e", `*${gitStatus.unstaged}`));',
        UNSTAGED_EDIT[1],
    )
    sources["index.ts"] = (sources["index.ts"]
        .replace(LEGACY_ALIGN, ALIGN)
        .replace(LEGACY_SEPARATOR, SEPARATOR_EDIT[1]))
    for name, (old, new) in [
        ("segments.ts", UNSTAGED_EDIT),
        ("index.ts", SEPARATOR_EDIT),
        ("index.ts", SEPARATOR_ARGUMENT_EDIT),
        ("index.ts", SEPARATOR_JOIN_EDIT),
    ]:
        source = sources[name]
        if source.count(new) == 0 and source.count(old) == 1:
            sources[name] = source.replace(old, new, 1)
        elif source.count(new) != 1 or source.count(old) != 0:
            raise ValueError(f"{name}: appearance anchor changed or duplicated")

    states = []
    for name, edits in EDITS.items():
        source = sources[name]
        for old, new in edits:
            if source.count(new) == 1:
                states.append("patched")
            elif source.count(new) == 0 and source.count(old) == 1:
                states.append("original")
            else:
                raise ValueError(f"{name}: upstream anchor changed or duplicated: {old[:70]}")
    if len(set(states)) != 1:
        raise ValueError("partial powerline layout patch; inspect before reapplying")
    if states[0] == "patched":
        return sources
    result = {}
    for name, source in sources.items():
        for old, new in EDITS[name]:
            source = source.replace(old, new, 1)
        result[name] = source
    return result


def main() -> None:
    root = Path.home() / ".pi/agent/git/github.com/nicobailon/pi-powerline-footer"
    if not root.exists():
        print("powerline not installed; skipping layout patch")
        return
    sources = {name: (root / name).read_text() for name in EDITS}
    patched = patch_sources(sources)
    for name, content in patched.items():
        if content != sources[name]:
            (root / name).write_text(content)
    print("powerline aligned layout and context meter ready")


if __name__ == "__main__":
    main()
