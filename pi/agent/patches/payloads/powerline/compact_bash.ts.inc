    if (width < 80 || rows < 24) {
      const command = snapshot.commands[snapshot.commands.length - 1];
      const failed = snapshot.commands.filter(item => item.exitCode !== null && item.exitCode !== 0).length;
      const state = command.exitCode === null ? "running" : command.exitCode === 0 ? "ok" : `exit ${command.exitCode}`;
      const color = command.exitCode === null ? "accent" : command.exitCode === 0 ? "success" : "error";
      const failures = failed > 0 ? theme.fg("error", ` · ${failed} failed`) : "";
      const suffix = ` (${theme.fg(color, state)})${failures}`;
      const prompt = theme.fg("accent", (shellSession?.state.shellName ?? "shell") === "fish" ? ">" : "$");
      const commandWidth = Math.max(0, width - visibleWidth(suffix) - 3);
      const title = ` ${prompt} ${truncateToWidth(command.command.replace(/\s+/g, " ").trim(), commandWidth, "…")}${suffix}`;
      // Keep the command outcome above its output; do not slice away error status.
      const outputRows = rows < 16 ? 1 : 2;
      return [truncateToWidth(title, width, "…"), ...command.output.slice(-outputRows)
        .map(line => truncateToWidth(` ${line}`, width, "…"))];
    }
