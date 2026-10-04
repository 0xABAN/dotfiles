        const rawBottomBorder = lines[bottomBorderIndex];
        const bottomLeading = /^─+(?= ↓ \d+ more )/.exec(rawBottomBorder.replace(/\x1b\[[0-9;]*m/g, ""))?.[0].length ?? 0;
        const bottomShift = Math.max(0, bottomLeading - 3);
        const bottomBorder = bottomShift > 0
          ? sliceByColumn(rawBottomBorder, bottomShift, visibleWidth(rawBottomBorder) - bottomShift) + bc("─".repeat(bottomShift))
          : rawBottomBorder;
        const bottomHintWidth = visibleWidth(bottomBorder.replace(/\x1b\[[0-9;]*m/g, "").replace(/─+$/, ""));
        const bottomBadgeBudget = boxWidth - bottomHintWidth - 9;
        const bottomBadgeWidth = visibleWidth(secondary);
        if (secondary && bottomBadgeWidth <= bottomBadgeBudget) {
          const bottomFrame = bc("╰───") + bottomBorder;
          result.push(inset + truncateToWidth(bottomFrame, boxWidth - bottomBadgeWidth - 5, "")
            + " " + secondary + " " + bc("──╯"));
        } else {
          result.push(inset + bc("╰───") + bottomBorder + bc("╯"));
        }
