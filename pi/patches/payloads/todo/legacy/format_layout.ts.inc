// configs:rpiv-todo-ui-v1
/** Match the transcript body gutter; leave room for text in narrow panes. */
export function todoGutter(width: number): number {
	return Math.min(3, Math.max(0, Math.floor((width - 2) / 2)));
}

/** Self-shell tools wrap rather than discard details, without painting a box. */
function todoText(content: () => string): Component {
	return {
		render(width) {
			if (width <= 0) return [];
			return new Text(content(), todoGutter(width), 0).render(width)
				.map(line => truncateToWidth(line, width, ""));
		},
		invalidate() {}, // Content and theme tokens are read afresh on every render.
	};
}

/** Native notifications own the gutter, including wrapped continuation lines. */
export function formatCommandHeading(label: string, theme: Theme): string {
	const title = sanitizeTerminalText(label).replace(/^─+\s*|\s*─+$/g, "");
	return `${theme.fg("accent", "◇")} ${theme.fg("muted", title)}`;
}
