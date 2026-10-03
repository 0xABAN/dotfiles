	/* configs:todos-clear */
	let lastUiCtx: ExtensionContext | undefined;
	const clearAllTodos = async (ctx?: ExtensionContext, quiet = false) => {
		const c = ctx ?? lastUiCtx;
		if (!c) {
			if (!quiet) uiCtx?.notify("/todos-clear needs an interactive session", "error");
			return;
		}
		const sessionId = sid(c);
		const before = getState(sessionId).tasks.length;
		const result = applyTaskMutation(getState(sessionId), "clear", {});
		commitState(sessionId, result.state);
		const built = buildToolResult("clear", {}, result.state, result.op);
		// Custom entry — never a fake toolResult. Codex rejects orphan call_ids.
		pi.appendEntry("rpiv-todo", built.details);
		if (c.hasUI) {
			todoOverlay?.dispose();
			todoOverlay = undefined;
			c.ui.setWidget("rpiv-todos", undefined);
			if (before > 0) {
				c.ui.notify(quiet ? "All todos done — cleared" : `Cleared ${before} todo${before === 1 ? "" : "s"}`, "info");
			} else if (!quiet) {
				c.ui.notify("No todos to clear", "info");
			}
		}
	};
	// When the last open todo is completed, wipe the list (and overlay).
	pi.on("tool_execution_end", async (event, ctx) => {
		if (event.toolName !== TOOL_NAME || event.isError) return;
		const tasks = getState(sid(ctx)).tasks.filter((t) => t.status !== "deleted");
		if (tasks.length === 0 || tasks.some((t) => t.status !== "completed")) return;
		lastUiCtx = ctx;
		await clearAllTodos(ctx, true);
	});
	pi.registerCommand("todos-clear", {
		description: "Clear all todos and hide the overlay",
		handler: async (_args, ctx) => {
			lastUiCtx = ctx;
			await clearAllTodos(ctx);
		},
	});
