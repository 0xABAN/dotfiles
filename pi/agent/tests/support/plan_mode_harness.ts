import { mock } from "bun:test";

mock.module("@earendil-works/pi-tui", () => ({ Key: { ctrlAlt: (key: string) => `ctrl+alt+${key}` } }));
const { default: planMode } = await import("../../extensions/plan-mode/index.ts");

export function planModeHarness(entries: unknown[] = [], initialTools = ["read", "write", "custom", "todo"]) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const messages: any[] = [];
  const states: any[] = [];
  const statuses = new Map<string, string>();
  let activeTools = initialTools;
  const ctx = {
    hasUI: true,
    thinkingLevel: "medium",
    sessionManager: { getEntries: () => entries },
    ui: {
      setStatus: (key: string, value: string) => statuses.set(key, value),
      select: async () => "Execute the plan",
    },
  };
  planMode({
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: Function }) => commands.set(name, command),
    registerFlag() {}, registerShortcut() {}, getFlag: () => false,
    getActiveTools: () => activeTools, setActiveTools: (tools: string[]) => { activeTools = tools; },
    appendEntry: (_name: string, state: any) => states.push(state),
    sendMessage: (message: any) => messages.push(message),
  } as never);
  return {
    ctx, messages, states, statuses,
    tools: () => activeTools,
    event: (name: string, event: any = {}) => handlers.get(name)!(event, ctx),
    toggle: () => commands.get("plan")!.handler("", ctx),
  };
}
