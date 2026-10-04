): Component {
	return todoText(() => {
		const glyph = ACTION_GLYPH[args.action] ?? sanitizeTerminalText(args.action ?? "");
		let text = theme.fg("accent", "▧") + theme.fg("muted", " Todo ") + theme.fg("accent", glyph);

		if (args.action === "create" && args.subject) {
			text += ` ${theme.fg("toolOutput", sanitizeTerminalText(args.subject))}`;
		} else if (
			(args.action === "update" || args.action === "get" || args.action === "delete") &&
			args.id !== undefined
		) {
			const subject = selectTaskSubjectById(state, args.id);
			text += ` ${theme.fg("toolOutput", subject ? sanitizeTerminalText(subject) : `#${args.id}`)}`;
		} else if (args.action === "list" && args.status) {
			text += ` ${theme.fg("muted", formatStatusLabel(args.status))}`;
		}
		return text;
	});
}