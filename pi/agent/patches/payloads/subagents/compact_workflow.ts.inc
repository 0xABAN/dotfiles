/** Compact hints still advertise only actions wired by the caller. */
function compactWorkflowHints(input: WorkflowDialogInput): string[] {
  const view = resolveWorkflowDialog(input);
  const can = (action: keyof WorkflowDialogActions) => input.available?.[action] ?? true;
  const hints = [input.state.level === "phases" ? "Esc close" : "Esc back", "↑↓ select"];
  if (input.state.level === "phases") {
    if (view.visibleAgents.length) hints.push("Enter open");
    hints.push("f filter");
  } else {
    hints.push("PgUp/Dn detail");
    if (previewLines(view.selectedEntry?.promptPreview).length > PROMPT_COLLAPSED_LINES) hints.push("Enter prompt");
    const actions = agentActions(view.selectedEntry, view.workflowActive);
    if (actions.skip && can("onSkipAgent")) hints.push("s skip");
    if (actions.retry && can("onRetryAgent")) hints.push("r retry");
  }
  if (view.paused && can("onResume")) hints.push("p resume");
  else if (view.workflowActive && can("onPause")) hints.push("p pause");
  if (view.workflowActive && can("onKill")) hints.push("x stop");
  if (view.selectedEntry?.recordId !== undefined && can("onOpenAgent")) hints.push("c convo");
  const width = Math.max(1, workflowDialogContentWidth(input.width ?? DEFAULT_WIDTH) - 1);
  const lines: string[] = [];
  for (const hint of hints) {
    const previous = lines.length - 1;
    const joined = previous < 0 ? hint : `${lines[previous]} · ${hint}`;
    if (visibleWidth(joined) <= width && previous >= 0) lines[previous] = joined;
    else lines.push(truncateToWidth(hint, width));
  }
  return lines;
}
