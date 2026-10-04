		// configs:rpiv-todo-compact-preview-v1
		if (Number.isFinite(previewRows)) {
			const compactRows = Math.min(previewRows, bodyBudget + 1);
			// The native selector reserves a summary row, but its tail slicing is
			// not a strict cap at tiny budgets. Reserve overflow in the heading
			// instead and keep active work ahead of pending/completed previews.
			const prioritized = [
				...overlayTasks.filter(task => task.status === "in_progress"),
				...overlayTasks.filter(task => task.status === "pending"),
				...overlayTasks.filter(task => task.status === "completed"),
			];
			const compactLayout = selectOverlayLayout(
				{ tasks: prioritized, nextId: snapshot.nextId }, Math.max(2, compactRows),
			);
			const visible = compactLayout.visible.slice(0, Math.max(1, compactRows - 1));
			const hidden = overlayTasks.length - visible.length;
			const more = hidden > 0 ? theme.fg("muted", ` · +${hidden} ${t("overlay.more", OVERLAY_MORE)}`) : "";
			const title = theme.fg(titleTone, headingIcon) + " " + theme.fg("muted", t("overlay.heading", OVERLAY_HEADING));
			if (compactRows === 1) {
				return [truncate(`${title}${more} · ${formatOverlayTaskLine(visible[0], theme, showIds)}`)];
			}
			return [
				truncate(`${headingContent}${more}`),
				...visible.map((task, index) => truncate(
					`${theme.fg("dim", index === visible.length - 1 ? "╰─" : "├─")} ${formatOverlayTaskLine(task, theme, showIds)}`,
				)),
			];
		}
