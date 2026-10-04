        // Read live extension statuses, retaining their original gradient bytes.
        const statuses = footerDataRef?.getExtensionStatuses();
        const mode = statuses?.get("agent-mode") ?? "";
        const thinking = statuses?.get("agent-thinking") ?? "";
        const compact = width < 80 || tui.terminal.rows < 24;
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

        // Slice by display columns, not bytes: our gradient paints every letter.
        const plainMode = mode.replace(/\x1b\[[0-9;]*m/g, "");
        const modeMatch = /(?:build|plan) mode$/.exec(plainMode);
        const shortMode = modeMatch
          ? sliceByColumn(mode, visibleWidth(plainMode.slice(0, modeMatch.index)), modeMatch[0].length - 5) + ansi.reset
          : mode;
        let primary = [compact ? shortMode : mode, thinking].filter(Boolean).join(" ❯ ");
        if (compact && visibleWidth(primary) > badgeBudget) {
          const plainThinking = thinking.replace(/\x1b\[[0-9;]*m/g, "");
          const shortThinking = plainThinking.startsWith("think:")
            ? sliceByColumn(thinking, 6, visibleWidth(thinking) - 6) + ansi.reset : thinking;
          primary = [shortMode, shortThinking].filter(Boolean).join(" ❯ ");
        }
        const throughput = statuses?.get("agent-tps") ?? "";
        // Warm beige on deep jade keeps the filled badge readable (5.16:1 contrast).
        const tps = throughput
          ? ansi.getBgAnsi(50, 109, 101) + ansi.getFgAnsi(243, 238, 223) + ` ${throughput} ` + ansi.reset
          : "";
        let badges = [tps, primary].filter(Boolean).join("   ");
        // Drop throughput first: mode, effort, scroll hints and input take priority.
        if (visibleWidth(badges) > badgeBudget) badges = primary;

        const badgeWidth = visibleWidth(badges);
        // Scroll hints and input are never clipped to make room for decoration.
        if (badges && badgeWidth <= badgeBudget) {
          result.push(inset + truncateToWidth(topBorder, boxWidth - badgeWidth - 5, "")
            + " " + badges + " " + bc("──╮"));
        } else {
          result.push(inset + topBorder + bc("╮"));
        }
