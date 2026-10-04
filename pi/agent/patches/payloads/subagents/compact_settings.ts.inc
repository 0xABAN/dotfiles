/** Keep the native list and its selection; budget its rows before descriptions. */
function renderAgentSettings(container: Container, list: SettingsList, tui: any, width: number, normalRows: number): string[] {
  const rows = tui.terminal?.rows ?? 40;
  if (width >= 80 && rows >= 24) {
    Reflect.set(list, "maxVisible", normalRows);
    return renderAgentBody(width, inner => container.render(inner));
  }
  return renderAgentBody(width, inner => {
    const headings = container.children.filter(child => child !== list && !(child instanceof Spacer))
      .flatMap(child => child.render(inner));
    // This non-overlay replaces the editor. Leave room for the surrounding dock.
    const available = Math.max(3, rows - 4 - headings.length);
    const hints = wrapTextWithAnsi("Enter/Space change · Esc cancel", inner);
    // Pi 0.84.2 has no setter. Its native window already follows selectedIndex;
    // changing the limit preserves callbacks, item identity and keyboard state.
    Reflect.set(list, "maxVisible", Math.max(1, Math.min(normalRows, available - hints.length - 2)));
    const native = list.render(inner);
    const content = native.slice(0, -2); // Replace only native blank + key-hint rows.
    const budget = Math.max(1, available - hints.length);
    const visible = content.length > budget
      ? [...content.slice(0, Math.max(1, budget - 1)), agentSettingsTheme().hint("…")]
      : content;
    return [...headings, ...visible, ...hints.map(hint => agentSettingsTheme().hint(hint))];
  });
}
