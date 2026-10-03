#!/usr/bin/env python3
"""Re-apply rpiv-todo local tweaks after npm package install."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("HOME", "")) / ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo"
TYPES = ROOT / "tool/types.ts"
TODO = ROOT / "todo.ts"
SELECTORS = ROOT / "state/selectors.ts"
FMT = ROOT / "view/format.ts"
OV = ROOT / "todo-overlay.ts"
INDEX = ROOT / "index.ts"
REPLAY = ROOT / "state/replay.ts"
HERE = Path(__file__).resolve().parent
CLEAR_BLOCK = (HERE / "todos-clear-block.ts.inc").read_text()
CLEAR_MARKER = "/* configs:todos-clear */"
NUDGE_BLOCK = (HERE / "todo-nudge-block.ts.inc").read_text()
NUDGE_MARKER = "/* configs:todo-nudge */"


def patch_dependencies() -> None:
	if not all(path.exists() for path in (TYPES, TODO, SELECTORS, FMT)):
		return

	t = TYPES.read_text()
	t2 = re.sub(
		r"\n\t(?:blockedBy|addBlockedBy|removeBlockedBy): Type\.Optional\(\n\t\tType\.Array\(Type\.Number\(\), \{\n\t\t\tdescription: \"[^\"]+\",\n\t\t\}\),\n\t\),",
		"",
		t,
	)
	if t2 != t:
		TYPES.write_text(t2)
		print("patched", TYPES, "remove dependency schema")

	t = TODO.read_text()
	t2 = t.replace("change status/fields/dependencies", "change status/fields")
	t2 = t2.replace(
		'\t"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",\n',
		"",
	)
	old_execute = """\t\tasync execute(_toolCallId, params, _signal, _onUpdate, ctx) {
\t\t\tconst result = applyTaskMutation(getState(sid(ctx)), params.action, params as TaskMutationParams);
\t\t\tcommitState(sid(ctx), result.state);
\t\t\treturn buildToolResult(params.action, params as TaskMutationParams, result.state, result.op);
\t\t},"""
	new_execute = """\t\tasync execute(_toolCallId, params, _signal, _onUpdate, ctx) {
\t\t\tconst input = { ...params } as TaskMutationParams;
\t\t\tdelete input.blockedBy;
\t\t\tdelete input.addBlockedBy;
\t\t\tdelete input.removeBlockedBy;
\t\t\tconst result = applyTaskMutation(getState(sid(ctx)), params.action, input);
\t\t\tcommitState(sid(ctx), result.state);
\t\t\treturn buildToolResult(params.action, input, result.state, result.op);
\t\t},"""
	t2 = t2.replace(old_execute, new_execute)
	if t2 != t:
		TODO.write_text(t2)
		print("patched", TODO, "disable dependencies")

	t = SELECTORS.read_text()
	t2 = re.sub(
		r"/\*\*\n \* Whether any visible task carries a `blockedBy` reference\..*?export function selectShowTaskIds\(state: TaskState\): boolean \{\n\treturn .*?;\n\}",
		"/** Dependencies are disabled locally, so task ids have no overlay anchor. */\n"
		"export function selectShowTaskIds(_state: TaskState): boolean {\n\treturn false;\n}",
		t,
		count=1,
		flags=re.S,
	)
	if t2 != t:
		SELECTORS.write_text(t2)
		print("patched", SELECTORS, "hide dependency ids")


def patch_format() -> None:
	if not FMT.exists():
		return
	t = FMT.read_text()
	t2 = t
	# pending → dark gray; in_progress → white (accent); done → dim
	# in_progress glyph is ○ (same as pending), not ◐
	t2 = t2.replace('in_progress: "◐",', 'in_progress: "○",')
	for old, new in (
		(
			'\tif (t.blockedBy && t.blockedBy.length > 0) {\n'
			'\t\tline += ` ${theme.fg("muted", `⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`)}`;\n'
			'\t}\n',
			"",
		),
		(
			'\tconst block = t.blockedBy?.length ? `    ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";\n'
			'\treturn `  ${glyph} #${t.id} ${sanitizeTerminalText(t.subject)}${form}${block}`;',
			'\treturn `  ${glyph} #${t.id} ${sanitizeTerminalText(t.subject)}${form}`;',
		),
		(
			't.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "muted" : "text";',
			't.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";',
		),
		(
			't.status === "in_progress" ? "muted" : t.status === "completed" || t.status === "deleted" ? "dim" : "muted";',
			't.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";',
		),
		(
			't.status === "completed" || t.status === "deleted" ? "dim" : "syntaxString";',
			't.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";',
		),
		(
			't.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";',
			't.status === "in_progress" ? "accent" : t.status === "completed" || t.status === "deleted" ? "dim" : "thinkingText";',
		),
		('return theme.fg("dim", "○");', 'return theme.fg("thinkingText", "○");'),
		('return theme.fg("accent", "○");', 'return theme.fg("thinkingText", "○");'),
		('return theme.fg("syntaxString", "○");', 'return theme.fg("thinkingText", "○");'),
		('return theme.fg("warning", "◐");', 'return theme.fg("accent", "○");'),
		('return theme.fg("muted", "◐");', 'return theme.fg("accent", "○");'),
		('return theme.fg("syntaxString", "◐");', 'return theme.fg("accent", "○");'),
		('return theme.fg("thinkingText", "◐");', 'return theme.fg("accent", "○");'),
		('return theme.fg("success", "✓");', 'return theme.fg("dim", "✓");'),
		('return theme.fg("error", "✗");', 'return theme.fg("dim", "✗");'),
	):
		t2 = t2.replace(old, new)
	if t2 != t:
		FMT.write_text(t2)
		print("patched", FMT)


def patch_overlay() -> None:
	if not OV.exists():
		return
	o = OV.read_text()
	o2 = re.sub(r"const headingColor = [^;]+;", 'const headingColor = "accent";', o, count=1)
	# Bottom padding: empty "" can be stripped by the host; use two space rows.
	old_spacer = (
		"\tprivate withTrailingSpacer(lines: string[]): string[] {\n"
		"\t\tif (lines.length === 0) return lines;\n"
		"\t\tlines.push(\"\");\n"
		"\t\treturn lines;\n"
		"\t}"
	)
	new_spacer = (
		"\tprivate withTrailingSpacer(lines: string[]): string[] {\n"
		"\t\tif (lines.length === 0) return lines;\n"
		"\t\tlines.push(\" \", \" \");\n"
		"\t\treturn lines;\n"
		"\t}"
	)
	if old_spacer in o2:
		o2 = o2.replace(old_spacer, new_spacer, 1)
	elif 'lines.push(" ", " ");' not in o2 and 'lines.push("");' in o2:
		o2 = o2.replace('lines.push("");', 'lines.push(" ", " ");', 1)
	if o2 != o:
		OV.write_text(o2)
		print("patched", OV)


def patch_index_clear() -> None:
	if not INDEX.exists():
		return
	t = INDEX.read_text()

	if "applyTaskMutation" not in t:
		t = t.replace(
			'import { replayFromBranch } from "./state/replay.js";\n',
			'import { replayFromBranch } from "./state/replay.js";\n'
			'import { applyTaskMutation } from "./state/state-reducer.js";\n'
			'import { buildToolResult } from "./tool/response-envelope.js";\n',
		)
	if "commitState" not in t:
		t = t.replace("\treplaceState,\n", "\tcommitState,\n\tgetState,\n\treplaceState,\n")
	t = t.replace(
		'import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";',
		'import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";',
	)
	t = t.replace(
		'import { isKeyRelease, isKeyRepeat, matchesKey, type KeyId } from "@earendil-works/pi-tui";',
		'import type { KeyId } from "@earendil-works/pi-tui";',
	)

	if CLEAR_MARKER in t:
		t = re.sub(
			r"\n\t/\* configs:todos-clear \*/.*?(?=\n\t/\* configs:todo-nudge \*/|\n\t// Collapse/expand hotkey)",
			"\n",
			t,
			count=1,
			flags=re.S,
		)
	if NUDGE_MARKER in t:
		t = re.sub(
			r"\n\t/\* configs:todo-nudge \*/.*?(?=\n\t// Collapse/expand hotkey)",
			"\n",
			t,
			count=1,
			flags=re.S,
		)

	needle = "\tregisterTodosCommand(pi);\n"
	if needle not in t:
		print("skip clear inject: anchor missing")
		INDEX.write_text(t)
		return

	t = t.replace(needle, needle + "\n" + CLEAR_BLOCK + "\n" + NUDGE_BLOCK + "\n", 1)

	# Remove the old dd binding from installations patched by earlier versions.
	t = t.replace("\t\tbindClearChord(ctx);\n", "")
	t = t.replace(
		"\tpi.on(\"agent_start\", async (_event, ctx) => {\n"
		"\t\tif (ctx.hasUI) bindClearChord(ctx);\n"
		"\t\ttodoOverlay?.hideCompletedTasksFromPreviousTurn();\n"
		"\t});",
		"\tpi.on(\"agent_start\", async () => {\n"
		"\t\ttodoOverlay?.hideCompletedTasksFromPreviousTurn();\n"
		"\t});",
	)

	INDEX.write_text(t)
	print("patched", INDEX, "clear command + todo nudge")


def patch_replay() -> None:
	"""Replay custom rpiv-todo clear entries; never require orphan toolResults."""
	if not REPLAY.exists():
		return
	t = REPLAY.read_text()
	if 'customType === "rpiv-todo"' in t:
		return
	old = '''export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
	let result: TaskState = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
	for (const entry of ctx.sessionManager.getBranch()) {
		const e = entry as { type?: string; message?: { role?: string; toolName?: string; details?: unknown } };
		if (e.type !== "message") continue;
		const msg = e.message;
		if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
		if (!isTaskDetails(msg.details)) continue;
		result = {
			tasks: msg.details.tasks.map((t) => ({ ...t })),
			nextId: msg.details.nextId,
		};
	}
	return result;
}'''
	new = '''export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
	let result: TaskState = { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
	for (const entry of ctx.sessionManager.getBranch()) {
		const e = entry as {
			type?: string;
			customType?: string;
			data?: unknown;
			message?: { role?: string; toolName?: string; details?: unknown };
		};
		if (e.type === "custom" && e.customType === "rpiv-todo" && isTaskDetails(e.data)) {
			result = {
				tasks: e.data.tasks.map((t) => ({ ...t })),
				nextId: e.data.nextId,
			};
			continue;
		}
		if (e.type !== "message") continue;
		const msg = e.message;
		if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
		if (!isTaskDetails(msg.details)) continue;
		result = {
			tasks: msg.details.tasks.map((t) => ({ ...t })),
			nextId: msg.details.nextId,
		};
	}
	return result;
}'''
	if old not in t:
		print("skip replay patch: anchor missing")
		return
	REPLAY.write_text(t.replace(old, new, 1))
	print("patched", REPLAY)


def main() -> None:
	if not ROOT.exists():
		raise SystemExit(0)
	patch_dependencies()
	patch_format()
	patch_overlay()
	patch_index_clear()
	patch_replay()


if __name__ == "__main__":
	main()
