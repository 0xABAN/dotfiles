        // Read live extension statuses, retaining their original gradient bytes.
        const statuses = footerDataRef?.getExtensionStatuses();
        const mode = statuses?.get("agent-mode") ?? "";
        const thinking = statuses?.get("agent-thinking") ?? "";
        // Pi 0.85.1 centers scroll hints. Restore their left slot so badges keep
        // their existing budget, moving only border cells, not label/ANSI bytes.
        const leading = /^─+(?= ↑ \d+ more )/.exec(lines[0].replace(/\x1b\[[0-9;]*m/g, ""))?.[0].length ?? 0;
        const shift = Math.max(0, leading - 3);
        const border = shift > 0
          ? sliceByColumn(lines[0], shift, visibleWidth(lines[0]) - shift) + bc("─".repeat(shift))
          : lines[0];
        const topBorder = bc("╭───") + border;
        const hintWidth = visibleWidth(border.replace(/\x1b\[[0-9;]*m/g, "").replace(/─+$/, ""));
        const badgeBudget = boxWidth - hintWidth - 9;

        const primary = [mode, thinking].filter(Boolean).join(" ❯ ");
        const responseTime = statuses?.get("agent-response-time") ?? "";
        // Warm beige on deep jade keeps the filled badge readable (5.16:1 contrast).
        const responseBadge = responseTime
          ? ansi.getBgAnsi(50, 109, 101) + ansi.getFgAnsi(243, 238, 223) + ` ${responseTime} ` + ansi.reset
          : "";
        let badges = [responseBadge, primary].filter(Boolean).join("   ");
        // Drop response time, then thinking; never abbreviate the mode or its icon.
        if (visibleWidth(badges) > badgeBudget) badges = primary;
        if (visibleWidth(badges) > badgeBudget) badges = mode;

        const badgeWidth = visibleWidth(badges);
        // Scroll hints and input are never clipped to make room for decoration.
        if (badges && badgeWidth <= badgeBudget) {
          result.push(inset + truncateToWidth(topBorder, boxWidth - badgeWidth - 5, "")
            + " " + badges + " " + bc("──╮"));
        } else {
          result.push(inset + topBorder + bc("╮"));
        }
