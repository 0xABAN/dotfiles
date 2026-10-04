// configs:subagents-ui-v1
// Display-only composition shared by the subagent surfaces. Never rewrite
// rendered task text: glyphs are chosen at their renderer-owned source sites.
import { type Component, CURSOR_MARKER, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "./agent-widget.js";

/** SettingsList snapshots cursor ANSI; its other theme fields are callbacks. */
export function agentSettingsTheme(): ReturnType<typeof getSettingsListTheme> {
  return { ...getSettingsListTheme(), get cursor() { return getSettingsListTheme().cursor; } };
}

/** The host already owns the outer viewport inset; this is its body gutter. */
export function agentBodyWidth(width: number, padding = 3): { pad: number; inner: number } {
  const pad = Math.min(padding, Math.max(0, Math.floor((width - 2) / 2)));
  return { pad, inner: Math.max(0, width - pad * 2) };
}

/** Render at the reduced width first, preserving cursor markers and images. */
export function renderAgentBody(width: number, render: (inner: number) => string[], padding = 3): string[] {
  const { pad, inner } = agentBodyWidth(width, padding);
  if (inner === 0) return [];
  return render(inner).map(line => {
    // Pi's image detector is not public. Do not slice either supported payload.
    const image = line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
    const cursor = line.includes(CURSOR_MARKER);
    let clipped = image ? line : truncateToWidth(line, inner, cursor ? "" : "…");
    // If resizing clipped the cursor itself, retain it at the visible edge.
    if (cursor && !clipped.includes(CURSOR_MARKER)) clipped += CURSOR_MARKER;
    return " ".repeat(pad) + clipped;
  });
}

/** Rebuild display-only tool components so theme changes never retain old ANSI. */
export function agentRenderer(build: () => Component, padding = 3): Component {
  return {
    render: width => renderAgentBody(width, inner => build().render(inner), padding),
    invalidate() {},
  };
}

/** Lazy text avoids retaining theme ANSI between watcher invalidations. */
export function agentText(text: () => string, padding = 3): Component {
  return agentRenderer(() => new Text(text(), 0, 0), padding);
}

/** State alone controls this mark; task-authored text is never interpreted. */
export function agentState(status: string, theme: Pick<Theme, "fg">, frame = "◌"): string {
  switch (status) {
    case "running": return theme.fg("accent", frame);
    case "background": return theme.fg("accent", "◌");
    case "queued": return theme.fg("muted", "○");
    case "completed": return theme.fg("muted", "✓");
    case "steered": return theme.fg("warning", "✓");
    case "stopped": return theme.fg("muted", "■");
    case "aborted": return theme.fg("warning", "×");
    case "error": return theme.fg("error", "×");
    default: return theme.fg("muted", "◇");
  }
}
