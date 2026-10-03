import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProcess, patchModule, temporaryDirectory } from "./support/patch-fixtures";

const temp = temporaryDirectory("todo-clear-replay-");

test("persists cleared todos through the extension API", () => {
	const clearBlock = readFileSync(new URL("../patches/todos-clear-block.ts.inc", import.meta.url), "utf8");
	expect(clearBlock).toContain('pi.appendEntry("rpiv-todo", built.details)');
	expect(clearBlock).not.toContain('c.appendEntry("rpiv-todo", built.details)');
	expect(clearBlock).not.toContain("appendMessage");
});

test("replays custom clear entries alongside real todo results without resurrecting tasks", async () => {
	const replay = join(temp, "replay.ts");
	const patcher = fileURLToPath(new URL("../patches/rpiv-todo-gray.py", import.meta.url));
	// The supported pre-patch replay loop, with only its pure state dependencies.
	writeFileSync(replay, `
const EMPTY_STATE = { tasks: [], nextId: 1 };
type TaskState = { tasks: { id: number }[]; nextId: number };
function isTaskDetails(value: any): value is TaskState {
	return value && Array.isArray(value.tasks) && typeof value.nextId === "number";
}
export function replayFromBranch(ctx: { sessionManager: { getBranch(): Iterable<unknown> } }): TaskState {
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
}
`);
	const apply = () => checkProcess(patchModule(patcher,
		'm["patch_replay"].__globals__["REPLAY"] = pathlib.Path(sys.argv[2]); m["patch_replay"]()', [replay]));
	apply();
	const patched = readFileSync(replay, "utf8");
	expect(patched).toContain('customType === "rpiv-todo"');
	apply();
	expect(readFileSync(replay, "utf8")).toBe(patched);

	const { replayFromBranch } = await import(pathToFileURL(replay).href);
	const result = (details: unknown) => ({ type: "message", message: { role: "toolResult", toolName: "todo", details } });
	const before = { tasks: [{ id: 1 }], nextId: 2 };
	const cleared = { tasks: [], nextId: 2 };
	const after = { tasks: [{ id: 2 }], nextId: 3 };
	const entries = [result(before), { type: "custom", customType: "rpiv-todo", data: cleared }];
	const ctx = { sessionManager: { getBranch: () => entries } };
	expect(replayFromBranch(ctx)).toEqual(cleared);
	entries.push(result(after));
	expect(replayFromBranch(ctx)).toEqual(after);
	expect(before.tasks).toEqual([{ id: 1 }]);
});
