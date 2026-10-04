export function renderTodoResult(
	result: { details?: unknown; content?: { type: string; text?: string }[] },
	theme: Theme,
	isError = false,
): Component {
	// configs:rpiv-todo-empty-result-v1
	return { render: () => [], invalidate() {} };
}