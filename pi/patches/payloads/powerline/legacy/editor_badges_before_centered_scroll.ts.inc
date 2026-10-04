        // Read live extension statuses, retaining their original gradient bytes.
        const statuses = footerDataRef?.getExtensionStatuses();
        const mode = statuses?.get("agent-mode") ?? "";
        const thinking = statuses?.get("agent-thinking") ?? "";
        const compact = width < 80 || tui.terminal.rows < 24;
        const topBorder = bc("╭───") + lines[0];
        const hintWidth = visibleWidth(lines[0].replace(/\x1b\[[0-9;]*m/g, "").replace(/─+$/, ""));
        const badgeBudget = boxWidth - hintWidth - 9;

        // Slice by display columns, not bytes: our gradient paints every letter.
        const plainMode = mode.replace(/\x1b\[[0-9;]*m/g, "");
        const modeMatch = /(?:build|plan) mode$/.exec(plainMode);
        const shortMode = modeMatch
          ? sliceByColumn(mode, visibleWidth(plainMode.slice(0, modeMatch.index)), modeMatch[0].length - 5) + ansi.reset
          : mode;
        let badges = [compact ? shortMode : mode, thinking].filter(Boolean).join(" ❯ ");
        if (compact && visibleWidth(badges) > badgeBudget) {
          const plainThinking = thinking.replace(/\x1b\[[0-9;]*m/g, "");
          const shortThinking = plainThinking.startsWith("think:")
            ? sliceByColumn(thinking, 6, visibleWidth(thinking) - 6) + ansi.reset : thinking;
          badges = [shortMode, shortThinking].filter(Boolean).join(" ❯ ");
        }

        const badgeWidth = visibleWidth(badges);
        // Scroll hints and input are never clipped to make room for decoration.
        if (badges && badgeWidth <= badgeBudget) {
          result.push(inset + truncateToWidth(topBorder, boxWidth - badgeWidth - 5, "")
            + " " + badges + " " + bc("──╮"));
        } else {
          result.push(inset + topBorder + bc("╮"));
        }
