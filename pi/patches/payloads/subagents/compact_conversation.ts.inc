  /** Compact chrome keeps actions inside the overlay, not below its hard cap. */
  private compact(): boolean {
    return this.lastInnerW + 4 < 80 || this.tui.terminal.rows < 24;
  }

  private compactHints(): string[] {
    if (this.composer) return ["Enter send · Esc cancel"];
    const actions = ["Esc close"];
    if (this.canSteer()) actions.push("Enter steer");
    if (this.isStoppable()) actions.push(this.stopArmed ? "x again STOP" : "x stop");
    actions.push("↑↓ scroll", `m ${MARKDOWN_MODE_LABELS[this.markdownMode()]}`);
    const lines: string[] = [];
    for (const action of actions) {
      const previous = lines.length - 1;
      const joined = previous < 0 ? action : `${lines[previous]} · ${action}`;
      if (visibleWidth(joined) <= this.lastInnerW && previous >= 0) lines[previous] = joined;
      else lines.push(truncateToWidth(action, Math.max(1, this.lastInnerW)));
    }
    return lines;
  }

  private renderCompact(width: number): string[] {
    const th = this.theme;
    const inner = width - 4;
    const row = (text: string) => th.fg("borderMuted", "│ ")
      + truncateToWidth(text, inner, "…", true) + th.fg("borderMuted", " │");
    const lines = [th.fg("borderMuted", `╭${"─".repeat(width - 2)}╮`)];
    lines.push(row(`${agentState(this.record.status, th)} ${renderAgentName(this.record.type, th, { bold: true })} ${th.fg("toolOutput", this.record.description)}`));
    const invocation = this.invocationLine();
    if (invocation) lines.push(row(invocation));

    const content = this.buildContentLines(inner);
    const height = this.viewportHeight();
    const maxScroll = Math.max(0, content.length - height);
    this.scrollOffset = this.autoScroll ? maxScroll : Math.min(this.scrollOffset, maxScroll);
    for (let i = 0; i < height; i++) lines.push(row(content[this.scrollOffset + i] ?? ""));

    if (this.composer) lines.push(row(this.composer.render(inner)[0] ?? ""));
    for (const hint of this.compactHints()) lines.push(row(th.fg(this.stopArmed ? "error" : "dim", hint)));
    lines.push(th.fg("borderMuted", `╰${"─".repeat(width - 2)}╯`));
    return lines;
  }
