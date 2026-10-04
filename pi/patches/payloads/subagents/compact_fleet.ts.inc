    if (compactWidth || terminalRows < 24) {
      // Window the real roster (including main) around its existing selection.
      // A short dock must leave the editor and conversation room to render.
      const cap = terminalRows < 24 ? Math.max(2, Math.min(5, Math.floor(terminalRows / 4))) : MAX_AGENT_ROWS + 2;
      const visible = Math.min(cap - 1, rows.length + 1);
      const start = Math.max(0, sel - visible + 1);
      const end = Math.min(rows.length + 1, start + visible);
      const hint = this.active ? "↑↓ select · Enter view · Esc back" : "←/↓ agents · Esc interrupt";
      const lines = [truncateToWidth(theme.fg("dim", hint), width)];
      for (let i = start; i < end; i++) {
        const entry = i === 0 ? undefined : rows[i - 1];
        const label = !entry ? "main" : entry.kind === "workflow"
          ? `◈ ${entry.workflow.name}`
          : `${renderAgentName(entry.record.type, theme)} ${entry.record.description}`;
        const position = i === sel ? theme.fg("dim", ` ${i + 1}/${rows.length + 1}`) : "";
        lines.push(rightAlign(`${this.bullet(i, sel, theme)} ${label}`, position, width));
      }
      return lines;
    }
