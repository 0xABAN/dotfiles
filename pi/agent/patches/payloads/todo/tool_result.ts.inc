export function renderTodoResult(
	result: { details?: unknown; content?: { type: string; text?: string }[] },
	theme: Theme,
	isError = false,
): Component {
	return todoText(() => {
		const branch = theme.fg("dim", "╰─ ");
		if (isError) {
			const message = result.content?.filter(item => item.type === "text")
				.map(item => sanitizeTerminalText(item.text ?? "")).join(" ") || "Todo failed";
			return branch + theme.fg("error", `× ${message}`);
		}

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
			return branch + theme.fg(STATUS_COLOR[status], `${STATUS_GLYPH[status]} ${formatStatusLabel(status)}`);
		}
		return branch + theme.fg("muted", STATUS_GLYPH.completed);
	});
}