    // configs:subagents-compact-widget-v1
    // The factory reads this allowance from its stable TUI on every render.
    // The manager's cached this.tui is cleared during native invalidation.
    if (compact || Number.isFinite(previewRows)) {
      const bodyRows = Math.max(1, Math.min(MAX_WIDGET_LINES, Math.floor(previewRows))) - 1;
      const unsuccessful = finished.filter(a => ERROR_STATUSES.has(a.status));
      // Prefer actual errors within the already-filtered linger window.
      const outcomes = [
        ...unsuccessful.filter(a => a.status === "error"),
        ...unsuccessful.filter(a => a.status !== "error"),
      ];
      const completed = finished.filter(a => !ERROR_STATUSES.has(a.status));

      // Keep running work first, but reserve one outcome row when both fit.
      const outcomeReserve = running.length > 0 && outcomes.length > 0 && bodyRows > 1 ? 1 : 0;
      const shown = running.slice(0, bodyRows - outcomeReserve);
      shown.push(...outcomes.slice(0, bodyRows - shown.length));
      shown.push(...completed.slice(0, bodyRows - shown.length));
      // Queued agents are represented by their exact heading count, not rows.
      const hidden = running.length + finished.length - shown.length;

      const counts: Array<{ count: number; label: string; short: string; color: string }> = [
        { count: running.length, label: "running", short: "r", color: "accent" },
        { count: queued.length, label: "queued", short: "q", color: "muted" },
        { count: outcomes.filter(a => a.status === "error").length, label: "error", short: "err", color: "error" },
        { count: outcomes.filter(a => a.status === "aborted").length, label: "aborted", short: "ab", color: "warning" },
        { count: outcomes.filter(a => a.status === "steered").length, label: "turn limit", short: "lim", color: "warning" },
        { count: outcomes.filter(a => a.status === "stopped").length, label: "stopped", short: "stop", color: "muted" },
        { count: completed.length, label: "done", short: "✓", color: "muted" },
      ].filter(item => item.count > 0);
      const title = theme.fg(hasActive ? "accent" : "muted", headingIcon) + " " + theme.fg(headingColor, "Agents");
      const summary = (short: boolean) => counts.map(item =>
        theme.fg(item.color, short ? `${item.count}${item.short}` : `${item.count} ${item.label}`),
      ).join(" ");
      const overflow = hidden > 0 ? theme.fg("dim", ` +${hidden}`) : "";
      const headings = [
        `${title} · ${summary(false)}${overflow}`,
        `${title} ${summary(true)}${overflow}`,
        `${theme.fg(hasActive ? "accent" : "muted", headingIcon)} ${summary(true)}${overflow}`,
      ];
      const heading = headings.find(line => visibleWidth(line) <= w) ?? headings[2];
      const lines = [truncate(heading)];

      for (const [index, agent] of shown.entries()) {
        const branch = theme.fg("dim", index === shown.length - 1 ? "╰─" : "├─");
        const state = agentState(agent.status, theme, frame);
        const name = renderAgentName(agent.type, theme, { bold: agent.status === "running" });
        const color = agent.status === "completed" ? "dim" : "toolOutput";
        // Outcome text leads the description so clipping cannot conceal it.
        let description = agent.description;
        if (agent.status === "error") description = `error: ${agent.error || description}`;
        else if (agent.status === "steered") description = `turn limit · ${description}`;
        else if (agent.status === "aborted" || agent.status === "stopped") description = `${agent.status} · ${description}`;
        lines.push(truncate(`${branch} ${state} ${name} ${theme.fg(color, description)}`));
      }
      return lines;
    }
