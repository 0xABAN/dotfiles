#!/usr/bin/env python3
"""Style rpiv-todo 2.9.0 after rpiv_todo_gray.py, without changing task state.

All anchors are checked before any writes. Keep the new spellings outside the
legacy patcher's broad replacements. Its exact clear-block reinjection is the
only supported partially reapplied state.
"""
import json
import os
from pathlib import Path
import re

from patch_support import read_payload, backup_sources, write_sources


# Older gray-patch runs duplicated this identical ternary on every replay.
# Accept only that exact, behavior-equivalent variation, not arbitrary code.
SUBJECT = '\tconst subjectColor =\n\t\tt.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";'
SUBJECT_PATTERN = re.compile(
    r'\tconst subjectColor =\n\t\t(?:t\.status === "in_progress" \? "accent" : )+'
    r't\.status === "completed" \|\| t\.status === "deleted" \? "dim" : "thinkingText";'
)

LAYOUT = read_payload('todo/legacy/format_layout.ts.inc')
TOOL_ROW_EDITS = {
    "view/format.ts": [
        (read_payload("todo/tool_call.ts.inc"), read_payload("todo/empty_tool_call.ts.inc")),
        (read_payload("todo/tool_result.ts.inc"), read_payload("todo/empty_tool_result.ts.inc")),
    ],
}

# Match exactly what the legacy injector installs, without owning its backend.
# Only notification expressions below change; no persistence code is copied here.
CLEAR_BLOCK = Path(__file__).with_name("todos_clear_block.ts.inc").read_text().rstrip("\n")
CLEAR_STYLED = CLEAR_BLOCK.replace(
    'c.ui.notify(quiet ? "All todos done — cleared" : `Cleared ${before} todo${before === 1 ? "" : "s"}`, "info");',
    'c.ui.notify(formatCommandHeading(quiet ? "All todos done — cleared" : `Cleared ${before} todo${before === 1 ? "" : "s"}`, c.ui.theme), "info");',
).replace(
    'c.ui.notify("No todos to clear", "info");',
    'c.ui.notify(formatCommandHeading("No todos to clear", c.ui.theme), "info");',
)

EDITS = {
    "index.ts": [
        ('import type { TodoOverlay } from "./todo-overlay.js";',
         'import type { TodoOverlay } from "./todo-overlay.js";\n'
         'import { formatCommandHeading } from "./view/format.js"; // configs:rpiv-todo-ui-v1'),
        (CLEAR_BLOCK, CLEAR_STYLED),
    ],
    "view/format.ts": [
        ('import { Text } from "@earendil-works/pi-tui";',
         'import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";'),
        ('export { formatStatusLabel };', 'export { formatStatusLabel };\n\n' + LAYOUT),
        (''' * Color palette for the renderResult status echo. `deleted` uses `muted` so a
 * successful delete is visually distinct from the error branch (which uses
 * `error` + `✗`). Mirrors pre-refactor `todo.ts:444-450`.''',
         ''' * Shared status colors: active work is accented, settled and pending states
 * are quiet. Execution failures retain the separate error color and × mark.'''),
        (''' * Glyph for the persistent overlay's per-task row. Differs from `STATUS_GLYPH`
 * for `completed` (`✓` vs `●`) and `deleted` (`✗` vs `⊘`) because the
 * overlay caller never renders a `deleted` row but uses `✗` in its
 * error-toned palette. Mirrors pre-refactor `todo-overlay.ts:23-33`.''',
         ''' * Use the same geometric state vocabulary in the widget, notifications,
 * and tool results. The overlay's existing filtering still hides tombstones.'''),
        (''' * Format a single task line for the `/todos` slash command (no glyph color,
 * indented bullet prefix). Pre-refactor `todo.ts:670-674`.''',
         ''' * Format a notification tree row; retain the plain legacy formatter for
 * callers without a theme. Command IDs remain visible independently of widget IDs.'''),
        (''' * `TaskState` (resolved by the caller via `getState()`). Returns a `Text`
 * node identical to pre-refactor `todo.ts:507-525`.''',
         ''' * `TaskState` (resolved by the caller via `getState()`). Self-shell layout
 * wraps the full label and reads theme colors again on invalidation.'''),
        (''' * fall back to plain `✓`). Identical visual output to pre-refactor
 * `todo.ts:533-565`.''',
         ''' * fall back to plain `✓`). Failures show their sanitized explanation,
 * and self-shell layout keeps the native tool box from painting a background.'''),
        ('''export const STATUS_GLYPH: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "○",
	completed: "●",
	deleted: "⊘",
};''', '''export const STATUS_GLYPH: Record<TaskStatus, string> = {
	pending: "◇",
	in_progress: "◈",
	completed: "✓",
	deleted: "⊘",
};'''),
        ('''export const STATUS_COLOR: Record<TaskStatus, "dim" | "warning" | "success" | "muted"> = {
	pending: "dim",
	in_progress: "warning",
	completed: "success",
	deleted: "muted",
};''', '''export const STATUS_COLOR: Record<TaskStatus, "accent" | "muted"> = {
	pending: "muted",
	in_progress: "accent",
	completed: "muted",
	deleted: "muted",
};'''),
        ('''export function overlayStatusGlyph(status: TaskStatus, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg("thinkingText", "○");
		case "in_progress":
			return theme.fg("thinkingText", "○");
		case "completed":
			return theme.fg("dim", "✓");
		case "deleted":
			return theme.fg("dim", "✗");
	}
}''', '''export function overlayStatusGlyph(status: TaskStatus, theme: Theme): string {
	return theme.fg(STATUS_COLOR[status], STATUS_GLYPH[status]);
}'''),
        (SUBJECT, '''	const finished = t.status === "completed" || t.status === "deleted";
	const subjectColor = finished ? "muted" : "text";'''),
        ('''export function formatCommandTaskLine(t: Task, glyph: string): string {
	const form = t.status === "in_progress" && t.activeForm ? ` (${sanitizeTerminalText(t.activeForm)})` : "";
	return `  ${glyph} #${t.id} ${sanitizeTerminalText(t.subject)}${form}`;
}''', '''export function formatCommandTaskLine(t: Task, glyph: string, theme?: Theme, last = true): string {
	if (theme) {
		const branch = theme.fg("dim", last ? "╰─" : "├─");
		return `${branch} ${formatOverlayTaskLine(t, theme, true)}`;
	}
	const form = t.status === "in_progress" && t.activeForm ? ` (${sanitizeTerminalText(t.activeForm)})` : "";
	return `  ${glyph} #${t.id} ${sanitizeTerminalText(t.subject)}${form}`;
}'''),
        ('''): Text {
	const glyph = ACTION_GLYPH[args.action] ?? args.action;
	let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", glyph);

	if (args.action === "create" && args.subject) {
		text += ` ${theme.fg("dim", sanitizeTerminalText(args.subject))}`;
	} else if (
		(args.action === "update" || args.action === "get" || args.action === "delete") &&
		args.id !== undefined
	) {
		const subject = selectTaskSubjectById(state, args.id);
		text += ` ${theme.fg("accent", subject ? sanitizeTerminalText(subject) : `#${args.id}`)}`;
	} else if (args.action === "list" && args.status) {
		text += ` ${theme.fg("muted", formatStatusLabel(args.status))}`;
	}
	return new Text(text, 0, 0);
}''', read_payload('todo/tool_call.ts.inc')),
        ('''export function renderTodoResult(result: { details?: unknown }, theme: Theme): Text {
	const details = result.details as TaskDetails | undefined;
	let status: TaskStatus | undefined;
	if (details) {
		const params = details.params as TaskMutationParams;
		switch (details.action) {
			case "create":
				status = details.tasks[details.tasks.length - 1]?.status;
				break;
			case "update":
				status = params.status ?? details.tasks.find((t) => t.id === params.id)?.status;
				break;
			case "delete":
				status = details.tasks.find((t) => t.id === params.id)?.status;
				break;
			case "list":
			case "get":
			case "clear":
				break;
		}
	}
	if (status) {
		return new Text(theme.fg(STATUS_COLOR[status], `${STATUS_GLYPH[status]} ${formatStatusLabel(status)}`), 0, 0);
	}
	return new Text(theme.fg("success", "✓"), 0, 0);
}''', read_payload('todo/tool_result.ts.inc')),
    ],
    "todo-overlay.ts": [
        ('import { formatOverlayTaskLine } from "./view/format.js";',
         'import { formatOverlayTaskLine, todoGutter } from "./view/format.js"; // configs:rpiv-todo-ui-v1'),
        ('const truncate = (line: string): string => truncateToWidth(line, width, "…");',
         '''const gutter = todoGutter(width);
		const truncate = (line: string): string =>
			" ".repeat(gutter) + truncateToWidth(line, Math.max(0, width - gutter * 2), "…");'''),
        ('''const headingColor = "accent";
		const headingIcon = hasActive ? "●" : "○";
		const headingText = `${t("overlay.heading", OVERLAY_HEADING)} (${counts.completed}/${counts.total})`;
		const heading = truncate(`${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, headingText)}`);''', '''const titleTone = hasActive ? "accent" : "muted";
		const headingIcon = hasActive ? "◈" : "◇";
		const headingText = `${t("overlay.heading", OVERLAY_HEADING)} (${counts.completed}/${counts.total})`;
		const heading = truncate(`${theme.fg(titleTone, headingIcon)} ${theme.fg("muted", headingText)}`);'''),
        ('theme.fg("dim", "└─")', 'theme.fg("dim", "╰─")'),
        ('lines[last].replace("├─", "└─")', 'lines[last].replace("├─", "╰─")'),
    ],
    "todo.ts": [
        ('import { formatCommandTaskLine, renderTodoCall, renderTodoResult } from "./view/format.js";',
         'import { formatCommandHeading, formatCommandTaskLine, renderTodoCall, renderTodoResult } from "./view/format.js"; // configs:rpiv-todo-ui-v1'),
        ('\t\tparameters: TodoParamsSchema,', '\t\tparameters: TodoParamsSchema,\n\t\trenderShell: "self",'),
        ('return renderTodoResult(result, theme);', 'return renderTodoResult(result, theme, _context.isError);'),
        ('ctx.ui.notify(t("command.no_todos", MSG_NO_TODOS), "info");',
         'ctx.ui.notify(formatCommandHeading(t("command.no_todos", MSG_NO_TODOS), ctx.ui.theme), "info");'),
        ('const lines: string[] = [header.join(" · ")];',
         'const lines: string[] = [formatCommandHeading(header.join(" · "), ctx.ui.theme)];'),
    ],
}
for group, glyph, section in [("pending", "○", "PENDING"), ("inProgress", "◐", "IN_PROGRESS"), ("completed", "✓", "COMPLETED")]:
    key = "in_progress" if group == "inProgress" else group
    EDITS["todo.ts"].extend([
        (f'lines.push(t("command.section.{key}", SECTION_{section}));',
         f'lines.push(formatCommandHeading(t("command.section.{key}", SECTION_{section}), ctx.ui.theme));'),
        (f'for (const task of groups.{group}) lines.push(formatCommandTaskLine(task, "{glyph}"));',
         f'groups.{group}.forEach((task, index, tasks) =>\n'
         f'\t\t\t\t\tlines.push(formatCommandTaskLine(task, "{glyph}", ctx.ui.theme, index === tasks.length - 1)));'),
    ])

# Two identical final-branch expressions occur in the original overlay.
COUNTS = {("todo-overlay.ts", 'theme.fg("dim", "└─")'): 2}


# Compact changes form a second complete stage over the exact prior UI. This
# preserves both its backend-aware clear replay and its existing anchor policy.
COMPACT_EDITS = {
    "view/format.ts": [(LAYOUT, read_payload('todo/format_layout.ts.inc'))],
    "todo-overlay.ts": [
        ('\t\tconst overlayState = { tasks: overlayTasks, nextId: snapshot.nextId };',
         '''\t\t// configs:rpiv-todo-compact-budget-v1
		const activityTui = this.tui as (TUI & { configsActivityRows?: () => number }) | undefined;
		const previewRows = activityTui?.configsActivityRows?.() ?? Infinity;
		const overlayState = { tasks: overlayTasks, nextId: snapshot.nextId };'''),
        ('\t\tconst heading = truncate(`${theme.fg(titleTone, headingIcon)} ${theme.fg("muted", headingText)}`);',
         '''\t\tconst headingContent = `${theme.fg(titleTone, headingIcon)} ${theme.fg("muted", headingText)}`;
		const heading = truncate(headingContent);'''),
        ('\t\t\treturn this.withTrailingSpacer([heading, truncate(`${theme.fg("dim", "╰─")} ${theme.fg("dim", hint)}`)]);',
         '''\t\t\tif (Number.isFinite(previewRows)) {
				return previewRows === 1
					? [truncate(`${headingContent} · ${theme.fg("dim", hint)}`)]
					: [heading, truncate(`${theme.fg("dim", "╰─")} ${theme.fg("dim", hint)}`)];
			}
			return this.withTrailingSpacer([heading, truncate(`${theme.fg("dim", "╰─")} ${theme.fg("dim", hint)}`)]);'''),
        ('\t\tif (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) {',
         read_payload('todo/compact_preview.ts.inc') + '\n\t\tif (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) {'),
    ],
}


def patch_legacy_sources(sources: dict[str, str]) -> dict[str, str]:
    normalized = dict(sources)
    normalized["view/format.ts"] = SUBJECT_PATTERN.sub(lambda _: SUBJECT, normalized["view/format.ts"])
    # A single old-gray pass used accent before a later replay made it gray.
    normalized["view/format.ts"] = normalized["view/format.ts"].replace(
        'case "in_progress":\n\t\t\treturn theme.fg("accent", "○");',
        'case "in_progress":\n\t\t\treturn theme.fg("thinkingText", "○");',
    )
    states = {}
    for name, edits in EDITS.items():
        source = normalized[name]
        remainder = source
        for old, new in edits:
            count = COUNTS.get((name, old), 1)
            if source.count(new) == count:
                remainder = remainder.replace(new, "")
        for old, new in edits:
            count = COUNTS.get((name, old), 1)
            if source.count(new) == count and old not in remainder:
                states[name, old] = "patched"
            elif source.count(new) == 0 and source.count(old) == count:
                states[name, old] = "legacy"
            else:
                raise ValueError(f"{name}: unknown/modified Todo UI anchor: {old[:70]}")
    legacy = {key for key, state in states.items() if state == "legacy"}
    if not legacy:
        return sources
    if len(legacy) != len(states) and legacy != {("index.ts", CLEAR_BLOCK)}:
        raise ValueError("mixed Todo UI installation; inspect before reapplying")
    result = dict(normalized)
    for name, edits in EDITS.items():
        for old, new in edits:
            if (name, old) in legacy:
                result[name] = result[name].replace(old, new)
    return result


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Migrate only complete UI stages; never write partial ones."""
    normalized = dict(sources)
    tool_row = any(new in sources[name] for name, edits in TOOL_ROW_EDITS.items() for _, new in edits)
    if tool_row:
        for name, edits in TOOL_ROW_EDITS.items():
            for old, new in edits:
                if sources[name].count(new) != 1 or sources[name].count(old) != 0:
                    raise ValueError(f"{name}: mixed/modified Todo tool renderer")
                normalized[name] = normalized[name].replace(new, old, 1)
    elif any(old in sources[name] for name, edits in TOOL_ROW_EDITS.items() for old, _ in edits):
        for name, edits in TOOL_ROW_EDITS.items():
            for old, new in edits:
                if sources[name].count(old) != 1 or sources[name].count(new) != 0:
                    raise ValueError(f"{name}: mixed/modified Todo tool renderer")

    compact = any(new in normalized[name] for name, edits in COMPACT_EDITS.items() for _, new in edits)
    if compact:
        for name, edits in COMPACT_EDITS.items():
            remainder = normalized[name]
            for old, new in edits:
                if remainder.count(new) != 1:
                    raise ValueError(f"{name}: mixed/modified compact Todo UI")
                remainder = remainder.replace(new, "")
            for old, _ in edits:
                if old in remainder:
                    raise ValueError(f"{name}: residual compact Todo UI anchor")
            for old, new in edits:
                normalized[name] = normalized[name].replace(new, old)
    result = patch_legacy_sources(normalized)
    # Prior-stage validation must finish across every file before migration.
    result = dict(result)
    for name, edits in COMPACT_EDITS.items():
        for old, new in edits:
            if result[name].count(old) != 1:
                raise ValueError(f"{name}: unknown compact Todo UI anchor: {old[:70]}")
            result[name] = result[name].replace(old, new)

    for name, edits in TOOL_ROW_EDITS.items():
        for old, new in edits:
            if result[name].count(new) == 1 and result[name].count(old) == 0:
                continue
            if result[name].count(old) != 1 or result[name].count(new) != 0:
                raise ValueError(f"{name}: unknown Todo tool renderer anchor")
            result[name] = result[name].replace(old, new, 1)
    return result


def main() -> None:
    root = Path(os.environ.get("RPIV_TODO_ROOT", Path.home() / ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo")).expanduser()
    if not root.exists():
        print("rpiv-todo not installed; skipping Todo UI")
        return
    package = json.loads((root / "package.json").read_text())
    if package.get("name") != "@juicesharp/rpiv-todo" or package.get("version") != "2.9.0":
        raise ValueError("Todo UI patch requires @juicesharp/rpiv-todo 2.9.0; review upstream first")
    sources = {name: (root / name).read_text() for name in EDITS}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "rpiv-todo-ui-")
        print(f"Todo UI backup: {backup}")
        write_sources(root, patched)
    print("Todo UI ready; reload Pi to apply")


if __name__ == "__main__":
    main()
