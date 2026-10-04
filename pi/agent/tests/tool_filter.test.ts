import { expect, test } from "bun:test";
import extension from "../extensions/tool_filter.ts";

test("keeps selected tools inactive across session and prompt hooks", async () => {
	const handlers = new Map<string, Function>();
	let activeTools = ["read", "find_files", "fff_multi_grep", "process", "todo"];

	extension({
		on(event: string, handler: Function) {
			handlers.set(event, handler);
		},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(toolNames: string[]) {
			activeTools = toolNames;
		},
	} as never);

	await handlers.get("session_start")!({});
	expect(activeTools).toEqual(["read", "todo"]);

	activeTools.push("process");
	await handlers.get("before_agent_start")!({});
	expect(activeTools).toEqual(["read", "todo"]);
});
