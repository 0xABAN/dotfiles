    if (width < 80 || rows < 24) {
      const counts: string[] = [];
      if (summary.blockedCount) counts.push(`blocked ${summary.blockedCount}`);
      if (summary.queueCount) counts.push(`q ${summary.queueCount}`);
      if (summary.ideaCount) counts.push(`ideas ${summary.ideaCount}`);
      if (!counts.length && !summary.leadingText) return [];
      const state = summary.compacting ? "compact" : summary.leadingStatus === "delivering" ? "sending" : "";
      const label = [...counts, state].filter(Boolean).join(" · ");
      const preview = summary.leadingText?.replace(/\s+/g, " ").trim();
      const content = `${label}${preview ? `: ${preview}` : ""}`;
      return [truncateToWidth(` ${theme.fg(summary.blockedCount ? "warning" : "dim", content)}`, width, "…")];
    }
