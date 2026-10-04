	/* configs:todo-nudge */
	// Re-surface open todos every turn so the model actually updates them.
	pi.on("before_agent_start", async (_event, ctx) => {
		const open = getState(sid(ctx)).tasks.filter(
			(t) => t.status === "pending" || t.status === "in_progress",
		);
		if (open.length === 0) return;
		const lines = open.map((t) => `#${t.id} [${t.status}] ${t.subject}`).join("\n");
		return {
			message: {
				customType: "todo-nudge",
				content:
					`Open todos — call the todo tool this turn as you progress:\n${lines}\n` +
					"Mark the task you are about to do in_progress (with activeForm) BEFORE other tools. " +
					"Mark it completed IMMEDIATELY when done. Exactly one in_progress. Never leave the list stale.",
				display: false,
			},
		};
	});
