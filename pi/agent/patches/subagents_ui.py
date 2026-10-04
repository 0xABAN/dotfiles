#!/usr/bin/env python3
"""Style all pi-subagents 0.19.0 source UI surfaces, without changing execution.

Pi loads src/index.ts, not dist. Validate every anchor before writing, preserve
unrelated edits, and refuse partial/unknown installations. Reload Pi to apply.
"""
import json
import os
from pathlib import Path

from patch_support import read_payload, backup_sources, write_sources, replace_counted

MODULE = "src/ui/agent-chrome.ts"
MODULE_SOURCE = read_payload('subagents/subagents_ui.ts.inc')
LEGACY_MODULE_SOURCE = read_payload('subagents/legacy/subagents_ui.ts.inc')
PRE_COMPACT_MODULE_SOURCE = read_payload('subagents/legacy/subagents_ui_pre_compact.ts.inc')
COMPACT_WIDGET = read_payload('subagents/compact_widget.ts.inc') + '\n'
COMPACT_MARKER = '// configs:subagents-compact-widget-v1'
MARKER = "// configs:subagents-ui-v1"

# Keep output transcripts useful while an agent is still running. The source is
# guarded separately because it is upstream-owned and does not carry our UI
# marker/helper.
STREAM_FILE = "src/output-file.ts"
STREAM_EDIT = (
    "if (event.type === \"turn_end\") flush();",
    "if (event.type === \"message_end\" || event.type === \"turn_end\") flush();",
)

# (original, replacement, expected occurrences). Counts are deliberate guards,
# including repeated renderer-owned glyphs; never transform rendered task text.
EDITS = {
    "src/agent-color.ts": [
        ('''  const resolved = resolveAgentColor(color);
  if (!resolved) {
    const text = style.bold ? theme.bold(name) : name;
    return style.fallbackColor ? theme.fg(style.fallbackColor, text) : text;
  }

  const rgb = parseHex(resolved);
  const quantized = (theme.getColorMode?.() ?? "truecolor") === "256color" ? rgbTo256(rgb) : undefined;
  const shown = quantized?.rgb ?? rgb;
  const contrasting = relativeLuminance(shown) > 0.179 ? BLACK : WHITE;
  const label = style.bold ? theme.bold(` ${name} `) : ` ${name} `;

  return ansiColor("background", quantized?.index ?? rgb)
    + ansiColor("foreground", quantized ? rgbTo256(contrasting).index : contrasting)
    + label
    + "\\u001b[39m"
    + (style.restoreBackground ?? "\\u001b[49m");''', '''  // Configured agent colors remain data, not background badges in this UI.
  const text = style.bold ? theme.bold(name) : name;
  return theme.fg(style.fallbackColor ?? "toolOutput", text);''', 1),
        ('return type !== undefined && resolveAgentColor(getConfig(type).color) !== undefined;',
         'return false; // The shared transcript uses foreground-only names.', 1),
    ],
    "src/ui/agent-widget.ts": [
        ('import { truncateToWidth }', 'import { agentState, renderAgentBody } from "./agent-chrome.js";\nimport { truncateToWidth }', 1),
        ('{ render(): string[]; invalidate(): void }', '{ render(width: number): string[]; invalidate(): void }', 1),
        ('private renderWidget(tui: any, theme: Theme)', 'private renderWidget(width: number, theme: Theme)', 1),
        ('const w = tui.terminal.columns;', 'const w = width;', 1),
        ('const headingColor = hasActive ? "accent" : "dim";', 'const headingColor = "muted";', 1),
        ('const headingIcon = hasActive ? "●" : "○";', 'const headingIcon = hasActive ? "◈" : "◇";', 1),
        ('theme.fg(headingColor, headingIcon)', 'theme.fg(hasActive ? "accent" : "muted", headingIcon)', 1),
        ('theme.fg("success", "✓")', 'agentState("completed", theme)', 1),
        ('theme.fg("error", "✗")', 'agentState(a.status, theme)', 2),
        ('theme.fg("muted", a.description)', 'theme.fg("toolOutput", a.description)', 1),
        ('`  ⎿  ${activity}`', '`  ╰─ ${activity}`', 1),
        ('lines[last] = lines[last].replace("├─", "└─");',
         '// A running activity row has no branch; do not replace a glyph in its user text.\n        if (!(runningLines.length > 0 && !queuedLine)) lines[last] = lines[last].replace("├─", "└─");', 1),
        ('"└─"', '"╰─"', 3),
        ('render: () => this.renderWidget(tui, theme),',
         'render: (width: number) => renderAgentBody(width, inner => this.renderWidget(inner, theme)),', 1),
    ],
    "src/ui/fleet-list.ts": [
        ('import { Editor,', 'import { renderAgentBody } from "./agent-chrome.js";\nimport { Editor,', 1),
        ('render: (w: number) => this.renderBar(w, theme),',
         'render: (w: number) => renderAgentBody(w, inner => this.renderBar(inner, theme)),', 1),
        ('"  " + theme.fg("dim", hint)', 'theme.fg("dim", hint)', 1),
        ('`  ${this.bullet', '`${this.bullet', 3),
        ('selected ? theme.fg("text", stats) : theme.fg("dim", stats)', 'theme.fg("dim", stats)', 2),
        ('{ fallbackColor: "muted" }', '{ fallbackColor: record.status === "completed" ? "muted" : "toolOutput" }', 1),
        ('const kind = theme.fg(selected ? "text" : "muted", "workflow");',
         'const kind = theme.fg("muted", "◈ workflow");', 1),
    ],
    "src/ui/conversation-viewer.ts": [
        ('import { renderAgentName }', 'import { agentState } from "./agent-chrome.js";\nimport { renderAgentName }', 1),
        ('private readonly markdownTheme:', 'private markdownTheme:', 1),
        ('private readonly markdownCache =', 'private markdownCache =', 1),
        ('th.fg("border",', 'th.fg("borderMuted",', 4),
        ('''const statusIcon = this.record.status === "running"
      ? th.fg("accent", "●")
      : this.record.status === "completed"
        ? th.fg("success", "✓")
        : this.record.status === "error"
          ? th.fg("error", "✗")
          : th.fg("dim", "○");''', 'const statusIcon = agentState(this.record.status, th);', 1),
        ('th.fg("muted", this.record.description)', 'th.fg("toolOutput", this.record.description)', 1),
        ('th.fg("accent", "[User]")', 'th.fg("accent", "◆ ") + th.bold(th.fg("text", "You"))', 1),
        ('th.bold("[Assistant]")', 'th.fg("accent", "● ") + th.bold(th.fg("text", "Pi"))', 1),
        ('th.fg("dim", "[Result]")', 'th.fg("muted", "╰─ □ Result")', 1),
        ('`  [Tool: ${name}]`', '`  ◇ Tool: ${name}`', 1),
        ('if (needsSeparator) lines.push(th.fg("dim", "───"));', 'if (needsSeparator) lines.push("");', 4),
        ('th.fg("accent", "▍ ")', 'th.fg("accent", "◌ ")', 1),
        ('`  ↳ ${parts.join(" · ")}`', '`  ╰─ ${parts.join(" · ")}`', 1),
        ('invalidate(): void { /* no cached state to clear */ }', '''invalidate(): void {
    // Markdown caches contain themed ANSI, unlike the live chrome above.
    this.markdownTheme = resolveMarkdownTheme(this.theme);
    this.markdownCache = new WeakMap();
    this.composer?.invalidate();
  }''', 1),
    ],
    "src/ui/workflow-card.ts": [
        ('import { stripTerminalSequences, Text,', 'import { renderAgentBody } from "./agent-chrome.js";\nimport { type Component, stripTerminalSequences,', 1),
        ('''export const UNICODE_GLYPHS: WorkflowGlyphs = {
  pointer: "▸",
  tick: "✔",
  cross: "✘",
  running: "⟳",
  groupTop: "╭─",
  groupMid: "├─",
  groupBottom: "╰─",
  vertical: "│",
  branch: "├─",
  lastBranch: "└─",
  log: "⎿",
  warning: "⚠",
};''', '''export const UNICODE_GLYPHS: WorkflowGlyphs = {
  pointer: "◈",
  tick: "✓",
  cross: "×",
  running: "◌",
  groupTop: "╭─",
  groupMid: "├─",
  groupBottom: "╰─",
  vertical: "│",
  branch: "├─",
  lastBranch: "╰─",
  log: "╰─",
  warning: "!",
};''', 1),
        ('| "accent";', '| "accent" | "toolOutput" | "text";', 1),
        ('{ text: glyphs.tick, color: "success" }', '{ text: glyphs.tick, color: "muted" }', 1),
        ('return { text: glyphs.running };', 'return { text: glyphs.running, color: "accent" };', 1),
        ('{ text: `${glyphs.pointer} `, color: "toolTitle" }', '{ text: `${glyphs.pointer} `, color: "accent" }', 1),
        ('color: "toolTitle", bold: true', 'color: "toolOutput", bold: true', 2),
        ('{ text: group.title }', '{ text: group.title, color: "toolOutput" }', 1),
        ('segments.push({ text: statParts.length > 0 ? entry.label + " ".repeat(pad) : entry.label });',
         'segments.push({ text: statParts.length > 0 ? entry.label + " ".repeat(pad) : entry.label, color: entry.state === "done" ? "muted" : "toolOutput" });', 1),
        ('''export function renderWorkflowCard(input: WorkflowCardInput, theme: Theme): Text {
  return new Text(styleWorkflowCardLines(layoutWorkflowCard(input), theme).join("\\n"), 0, 0);
}''', '''export function renderWorkflowCard(input: WorkflowCardInput, theme: Theme, padding = 3): Component {
  return {
    render: width => renderAgentBody(width, inner =>
      styleWorkflowCardLines(layoutWorkflowCard({ ...input, width: inner }), theme), padding),
    invalidate() {}, // Layout and theme are evaluated at the supplied width each render.
  };
}''', 1),
        ('theme: Theme): Text | undefined', 'theme: Theme): Component | undefined', 1),
    ],
    "src/ui/workflow-dialog.ts": [
        ('return { text: glyphs.tick, color: "success" };', 'return { text: glyphs.tick, color: "muted" };', 1),
        ('glyphs.spinner.length], color: "dim"', 'glyphs.spinner.length], color: "accent"', 1),
        ('{ text: entry.label, color: selected ? "accent" : undefined }', '{ text: entry.label, color: selected ? "text" : display === "done" ? "muted" : "toolOutput" }', 1),
        ('group.status === "done" ? "success"', 'group.status === "done" ? "muted"', 1),
        ('{ text: head.name, color: "toolTitle", bold: true }', '{ text: head.name, color: "toolOutput", bold: true }', 1),
        ('return styleWorkflowCardLines(lines, this.theme);',
         'return styleWorkflowCardLines(lines, this.theme).map(line => truncateToWidth(line, Math.max(0, width)));', 1),
    ],
    "src/ui/schedule-menu.ts": [
        ('if (!j.enabled) return "✗";', 'if (!j.enabled) return "×";', 1),
        ('if (j.lastStatus === "running") return "⋯";', 'if (j.lastStatus === "running") return "◌";', 1),
    ],
    "src/ui/agent-mention.ts": [
        ('label: `@${target.handle}`', 'label: `◇ @${target.handle}`', 1),
    ],
    "src/index.ts": [
        ('import { abortable }', 'import { agentRenderer, agentSettingsTheme, agentState, agentText, renderAgentBody } from "./ui/agent-chrome.js";\nimport { abortable }', 1),
        ('(message, { expanded }, theme) => {', '(message, { expanded, outputPad }, theme) => {', 1),
        ('if (!d) return undefined;\n\n      function renderOne',
         'if (!d) return undefined;\n\n      return agentRenderer(() => {\n      function renderOne', 1),
        ('const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");',
         'const icon = agentState(d.status, theme);', 1),
        ('${theme.bold(d.description)}', '${theme.bold(theme.fg("toolOutput", d.description))}', 1),
        ('return new Text(rendered.join("\\n"), 0, 0);', 'return new Text(rendered.join("\\n"), 0, 0);\n      }, outputPad + 2);', 1),
        ('    // ---- Custom rendering: Claude Code style ----', '    // ---- Custom rendering: shared transcript chrome ----\n\n    renderShell: "self",', 1),
        ('import { hasAgentBadge, renderAgentName }', 'import { renderAgentName }', 1),
        ('''    renderCall(args, theme, context) {
      // A badge closes its own background, which would clear the tool block's row tint
      // for the rest of the line, so the badge restores it. The tint is opened here too:
      // the TUI's Box paints it, but HTML export takes it from CSS, and restoring a
      // background the line never opened is what banded the export before. The line is
      // deliberately left open — Box.applyBackgroundToLine pads to width and *then*
      // wraps, so closing here would leave that padding untinted, and HTML export closes
      // any open span per line anyway. No badge means no tint, so an uncolored agent
      // renders exactly the line it always did.
      const rowBackground = hasAgentBadge(args.subagent_type)
        ? theme.getBgAnsi(context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg")
        : "";
      const desc = args.description ?? "";
      const name = renderAgentName(args.subagent_type, theme, {
        fallbackColor: "toolTitle",
        restoreBackground: rowBackground,
        bold: true,
      });
      return new Text(rowBackground + "▸ " + name + (desc ? "  " + theme.fg("muted", desc) : ""), 0, 0);
    },''', '''    renderCall(args, theme) {
      return agentText(() => {
        const desc = args.description ?? "";
        const name = renderAgentName(args.subagent_type, theme, { bold: true });
        return theme.fg("accent", "◈ ") + name + (desc ? "  " + theme.fg("toolOutput", desc) : "");
      });
    },''', 1),
        ('renderResult(result, { expanded, isPartial }, theme, renderContext) {',
         'renderResult(result, { expanded, isPartial }, theme, renderContext) {\n      return agentRenderer(() => {', 1),
        ('if (renderContext.isError || !details?.status) {\n        return new Text(text, 0, 0);',
         'if (renderContext.isError || !details?.status) {\n        return new Text(renderContext.isError ? theme.fg("error", text) : text, 0, 0);', 1),
        ('const icon = isSteered ? theme.fg("warning", "✓") : theme.fg("success", "✓");',
         'const icon = agentState(details.status, theme);', 1),
        ('      return new Text(line, 0, 0);\n    },\n\n    // ---- Execute ----',
         '      return new Text(line, 0, 0);\n      });\n    },\n\n    // ---- Execute ----', 1),
        ('    renderCall(args, theme) {\n      return new Text(',
         '    renderShell: "self",\n\n    renderCall(args, theme) {\n      return agentRenderer(() => new Text(', 1),
        ('`${theme.fg("toolTitle", "▸ ")}${theme.bold(theme.fg("toolTitle", "SubagentWorkflow"))}',
         '`${theme.fg("accent", "◈ ")}${theme.bold(theme.fg("toolOutput", "SubagentWorkflow"))}', 1),
        ('        0,\n        0,\n      );\n    },\n\n    renderResult(result, _options, theme, renderContext)',
         '        0,\n        0,\n      ));\n    },\n\n    renderResult(result, _options, theme, renderContext)', 1),
        ('if (renderContext.isError || !task) return new Text(text, 0, 0);',
         'if (renderContext.isError || !task) return new Text(renderContext.isError ? theme.fg("error", text) : text, 0, 0);', 1),
        ('renderResult(result, _options, theme, renderContext) {',
         'renderResult(result, _options, theme, renderContext) {\n      return agentRenderer(() => {', 1),
        ('        theme,\n      );\n    },\n\n    execute: async (toolCallId, params, _signal',
         '        theme,\n        0, // agentRenderer already owns the body gutter.\n      );\n      });\n    },\n\n    execute: async (toolCallId, params, _signal', 1),
        ('⎿', '╰─', 7),
        ('let line = theme.fg("error", "✗") + (s ? " " + s : "");',
         'let line = agentState(details.status, theme) + (s ? " " + s : "");', 1),
        ('const slTheme = getSettingsListTheme();', 'const slTheme = agentSettingsTheme();', 1),
        ('        getSettingsListTheme(),', '        agentSettingsTheme(),', 1),
        ('getAgentDir, getSettingsListTheme }', 'getAgentDir }', 1),
        ('container.addChild(new Text("Agent types", 0, 0));',
         'container.addChild(agentText(() => _theme.fg("accent", "◈ ") + _theme.fg("muted", "Agent types"), 0));', 1),
        ('container.addChild(new Text(slTheme.hint(legendParts.join("  ")), 0, 0));',
         'container.addChild(agentText(() => slTheme.hint(legendParts.join("  ")), 0));', 1),
        ('container.addChild(new Text("⚙  Subagent Settings", 0, 0));',
         'container.addChild(agentText(() => _theme.fg("accent", "◎ ") + _theme.fg("muted", "Subagent Settings"), 0));', 1),
        ('render: (w: number) => container.render(w),',
         'render: (w: number) => renderAgentBody(w, inner => container.render(inner)),', 2),
    ],
}


WIDGET = "src/ui/agent-widget.ts"
LEGACY_WIDGET_EDITS = list(EDITS[WIDGET])
EDITS[WIDGET] += [
    ('import { truncateToWidth }', 'import { truncateToWidth, visibleWidth }', 1),
    ('private renderWidget(width: number, theme: Theme)',
     'private renderWidget(width: number, theme: Theme, compact = false, previewRows = Infinity)', 1),
    ('inner => this.renderWidget(inner, theme)',
     'inner => this.renderWidget(inner, theme, width < 80, tui.configsActivityRows?.() ?? Infinity)', 1),
    ('    // Build sections separately for overflow-aware assembly.',
     COMPACT_WIDGET + '    // Build sections separately for overflow-aware assembly.', 1),
]


# A panel stage is installed as a whole. Each source carries its own stage mark,
# so a current helper never authorizes upgrading a mixed or edited installation.
PANEL_MARKER = '// configs:subagents-compact-panels-v1'
PANEL_EDITS = {
    'src/index.ts': [
        ('import { Container, Key, matchesKey, type SettingItem, SettingsList, Spacer, Text }',
         'import { Container, Key, matchesKey, type SettingItem, SettingsList, Spacer, Text, wrapTextWithAnsi }', 1),
        ('export default function (pi: ExtensionAPI) {', read_payload('subagents/compact_settings.ts.inc') + '\nexport default function (pi: ExtensionAPI) {', 1),
        ('      container.addChild(list);', '      container.addChild(list);\n      const normalRows = Reflect.get(list, "maxVisible") as number;', 2),
        ('render: (w: number) => renderAgentBody(w, inner => container.render(inner)),',
         'render: (w: number) => renderAgentSettings(container, list, _tui, w, normalRows),', 2),
    ],
    'src/ui/conversation-viewer.ts': [
        ('import { agentState } from "./agent-chrome.js";', 'import { agentState } from "./agent-chrome.js";', 1),
        ('    this.lastInnerW = innerW;', '    this.lastInnerW = innerW;\n    if (this.compact()) return this.renderCompact(width);', 1),
        ('  private viewportHeight(): number {', read_payload('subagents/compact_conversation.ts.inc') + '\n  private viewportHeight(): number {', 1),
        ('return Math.max(MIN_VIEWPORT, maxRows - this.chromeLines());',
         'return Math.max(this.compact() ? 0 : MIN_VIEWPORT, maxRows - this.chromeLines());', 1),
        ('    return CHROME_LINES_BASE + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0);',
         '    if (this.compact()) return 3 + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0) + this.compactHints().length;\n    return CHROME_LINES_BASE + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0);', 1),
    ],
    'src/ui/fleet-list.ts': [
        ('import { renderAgentBody } from "./agent-chrome.js";', 'import { renderAgentBody } from "./agent-chrome.js";', 1),
        ('inner => this.renderBar(inner, theme)', 'inner => this.renderBar(inner, theme, tui.terminal?.rows ?? 40, w < 80)', 1),
        ('private renderBar(width: number, theme: Theme)', 'private renderBar(width: number, theme: Theme, terminalRows = 40, compactWidth = false)', 1),
        ('    const hint = this.active', read_payload('subagents/compact_fleet.ts.inc') + '\n    const hint = this.active', 1),
    ],
    'src/ui/workflow-dialog.ts': [
        ('export interface WorkflowDialogInput extends WorkflowDialogSource {', 'export interface WorkflowDialogInput extends WorkflowDialogSource {', 1),
        ('  bodyRows?: number;', '  bodyRows?: number;\n  compact?: boolean;\n  detailOffset?: number;', 1),
        ('return Math.max(12, terminalWidth - 6);', 'return Math.max(12, terminalWidth - (terminalWidth < 80 ? 2 : 6));', 1),
        ('export function layoutWorkflowDialog(input: WorkflowDialogInput): WorkflowCardLine[] {',
         read_payload('subagents/compact_workflow.ts.inc') + '\nexport function layoutWorkflowDialog(input: WorkflowDialogInput): WorkflowCardLine[] & { detailMaxScroll?: number } {', 1),
        ('const capacity = Math.max(MIN_PANE_BODY_ROWS, input.bodyRows ?? DEFAULT_PANE_BODY_ROWS);',
         'const compactHints = input.compact ? compactWorkflowHints(input) : [];\n  const capacity = Math.max(input.compact ? 1 : MIN_PANE_BODY_ROWS, input.bodyRows ?? DEFAULT_PANE_BODY_ROWS);', 1),
        ('  const lines: WorkflowCardLine[] = [];\n\n  // ---- Header:',
         '  const lines: WorkflowCardLine[] & { detailMaxScroll?: number } = [];\n\n  // ---- Header:', 1),
        ('  lines.push(\n    rightAlign(\n      head.subtext', '  if (!input.compact) lines.push(\n    rightAlign(\n      head.subtext', 1),
        ('  lines.push([]);\n\n  const frameWidth', '  if (!input.compact) lines.push([]);\n\n  const frameWidth', 1),
        ('  const rightRows = inPhases ? agentRows : detailRows;',
         '  const detailMaxScroll = Math.max(0, detailRows.length - capacity);\n  const detailStart = Math.min(input.detailOffset ?? 0, detailMaxScroll);\n  const rightRows = inPhases ? agentRows : input.compact ? detailRows.slice(detailStart, detailStart + capacity) : detailRows;\n  if (input.compact) lines.detailMaxScroll = detailMaxScroll;', 1),
        ('Math.max(MIN_PANE_BODY_ROWS, leftRows.length, rightRows.length)', 'Math.max(input.compact ? 1 : MIN_PANE_BODY_ROWS, leftRows.length, rightRows.length)', 1),
        ('  // ---- Key hints ----',
         '  if (input.compact) {\n    lines.push(...compactHints.map(text => [{ text: ` ${text}`, color: "dim" as const }]));\n    return lines;\n  }\n\n  // ---- Key hints ----', 1),
        ('  private spinnerFrame = 0;', '  private spinnerFrame = 0;\n  private detailOffset = 0;\n  private detailMaxScroll = 0;\n  private detailPageRows = 1;', 1),
        ('    const result = handleWorkflowDialogKey(data, this.state, resolveWorkflowDialog(input));',
         '''    if (this.state.level === "agent" && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) {
      const delta = matchesKey(data, "pageUp") ? -this.detailPageRows : this.detailPageRows;
      this.detailOffset = Math.max(0, Math.min(this.detailMaxScroll, this.detailOffset + delta));
      this.tui.requestRender();
      return;
    }
    const result = handleWorkflowDialogKey(data, this.state, resolveWorkflowDialog(input));''', 1),
        ('    this.state = result.state;', '    if (this.state !== result.state) this.detailOffset = 0;\n    this.state = result.state;', 1),
        ('    const lines = layoutWorkflowDialog({',
         '    const rows = this.tui.terminal?.rows ?? 40;\n    const compact = width < 80 || rows < 24;\n    const input: WorkflowDialogInput = {', 1),
        ('      spinnerFrame: this.spinnerFrame,\n    });',
         '''      spinnerFrame: this.spinnerFrame,
      compact,
      detailOffset: this.detailOffset,
    };
    if (compact) {
      // The native overlay hard-crops at 70%; reserve title, frame and all
      // controls first, then window the panes around their real selections.
      input.bodyRows = Math.max(1, Math.floor(rows * 0.7) - 3 - compactWorkflowHints(input).length);
    } else {
      input.bodyRows = Math.min(DEFAULT_PANE_BODY_ROWS, Math.floor(rows * 0.7) - 6);
    }
    const lines = layoutWorkflowDialog(input);
    if (compact) {
      this.detailPageRows = input.bodyRows ?? DEFAULT_PANE_BODY_ROWS;
      this.detailMaxScroll = lines.detailMaxScroll ?? 0;
      this.detailOffset = Math.min(this.detailOffset, this.detailMaxScroll);
    }''', 1),
    ],
}


PRE_PANEL_EDITS = {name: list(edits) for name, edits in EDITS.items()}
for name, edits in PANEL_EDITS.items():
    old, new, count = edits[0]
    edits[0] = (old, PANEL_MARKER + '\n' + new, count)
    EDITS[name] += edits


def transform(name: str, source: str, reverse: bool = False) -> str:
    # Older installations have the complete original UI but no compact branch.
    # Still reverse/count every old anchor; a recognized helper is not enough.
    edits = PRE_PANEL_EDITS[name] if reverse and name in PANEL_EDITS and PANEL_MARKER not in source else EDITS[name]
    if reverse and name == WIDGET and COMPACT_MARKER not in source:
        edits = LEGACY_WIDGET_EDITS
    return replace_counted(
        source, edits, f"{name}: changed/duplicate UI anchor", reverse=reverse,
    )


def patch_stream_source(source: str) -> str:
    """Flush complete messages before the parent agent turn settles."""
    old, new = STREAM_EDIT
    old_lines = [line for line in source.splitlines() if line.strip() == old]
    new_lines = [line for line in source.splitlines() if line.strip() == new]
    if len(new_lines) == 1 and not old_lines:
        return source
    if len(old_lines) != 1 or new_lines:
        raise ValueError(f"{STREAM_FILE}: changed/duplicate output stream anchor")
    return source.replace(old, new, 1)


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Validate the complete installation before returning any changed source."""
    stream = patch_stream_source(sources[STREAM_FILE])
    states = [source.count(MARKER) for name, source in sources.items() if name in EDITS]
    if any(count not in (0, 1) for count in states) or len(set(states)) != 1:
        raise ValueError("partial or duplicated subagents UI patch")
    # The call renderer is one larger replacement. Reject a stray copy of its
    # old method header too, not only a second byte-identical complete block.
    expected_calls = 0 if states[0] else 1
    if sources["src/index.ts"].count("renderCall(args, theme, context) {") != expected_calls:
        raise ValueError("partial or duplicated Agent call renderer")
    if states[0] == 1:
        if not all(sources[name].startswith(MARKER + "\n") for name in EDITS):
            raise ValueError("subagents UI source marker moved")
        if sources.get(MODULE) not in (MODULE_SOURCE, LEGACY_MODULE_SOURCE, PRE_COMPACT_MODULE_SOURCE):
            raise ValueError("subagents UI helper changed or missing; inspect before reapplying")
        panel_stages = [sources[name].count(PANEL_MARKER) for name in PANEL_EDITS]
        if len(set(panel_stages)) != 1 or panel_stages[0] not in (0, 1):
            raise ValueError('partial or duplicated compact panel stage')
        result = dict(sources)
        for name in EDITS:
            source = sources[name].removeprefix(MARKER + "\n")
            original = transform(name, source, reverse=True)
            if name == WIDGET and COMPACT_MARKER not in source:
                expected = replace_counted(original, LEGACY_WIDGET_EDITS, "inconsistent previous widget")
            elif name in PANEL_EDITS and PANEL_MARKER not in source:
                expected = replace_counted(original, PRE_PANEL_EDITS[name], 'inconsistent previous panels')
            else:
                expected = transform(name, original)
            if expected != source:
                raise ValueError(f"{name}: inconsistent subagents UI patch")
            result[name] = MARKER + "\n" + transform(name, original)
        # Upgrade sources/helper only after validating the complete installation.
        return {**result, MODULE: MODULE_SOURCE, STREAM_FILE: stream}
    if MODULE in sources:
        raise ValueError("unexpected subagents UI helper alongside original sources")
    result = {name: MARKER + "\n" + transform(name, sources[name]) for name in EDITS}
    result[MODULE] = MODULE_SOURCE
    result[STREAM_FILE] = stream
    return result


def main() -> None:
    root = Path(os.environ.get("PI_SUBAGENTS_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/@tintinweb/pi-subagents"))).expanduser()
    if not root.exists():
        print("pi-subagents not installed; skipping UI patch")
        return
    version = json.loads((root / "package.json").read_text())["version"]
    if version != "0.19.0":
        raise ValueError(f"subagents UI requires 0.19.0, found {version}; review upstream first")
    sources = {name: (root / name).read_text() for name in EDITS}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    sources[STREAM_FILE] = (root / STREAM_FILE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "subagents-ui-", added_files=sorted(set(patched) - set(sources)))
        print(f"Subagents UI backup: {backup}")
        write_sources(root, patched)
    print("Subagents UI ready; reload Pi to apply")


if __name__ == "__main__":
    main()
