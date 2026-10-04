import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applySdkPatches, checkProcess, copyPackageSources, copyPowerline, copySdk, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const sdkSource = process.env.PI_SDK_ROOT;
const todoSource = process.env.RPIV_TODO_TEST_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo");
const agentsSource = process.env.PI_SUBAGENTS_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/@tintinweb/pi-subagents");
const powerlineSource = process.env.PI_POWERLINE_ROOT ?? join(homedir(), ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
const { nativeTest: test } = nativeSuite(import.meta.path,
  !!sdkSource && [todoSource, agentsSource, powerlineSource].every(existsSync), { FORCE_COLOR: "1" });
const home = temporaryDirectory("pi-compact-stack-");
const sdk = join(home, "sdk");
const patcher = (name: string) => fileURLToPath(new URL(`../patches/${name}.py`, import.meta.url));

function link(root: string, name: string, source: string) {
  const target = join(root, "node_modules", name);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target);
}

function peers(root: string) {
  for (const name of ["pi-coding-agent", "pi-tui", "pi-ai", "pi-agent-core"]) {
    link(root, `@earendil-works/${name}`, name === "pi-coding-agent" ? sdk : join(sdk, "node_modules/@earendil-works", name));
  }
}

test("real activity factories preserve the input cursor and both summaries in a constrained native dock", async () => {
  copySdk(sdkSource!, sdk);
  applySdkPatches(sdk, ["pi_horizontal_inset", "pi_transcript", "pi_compact_layout"]);
  const todo = join(home, ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo");
  const agents = join(home, "agents");
  copyPackageSources(todoSource, todo);
  copyPackageSources(agentsSource, agents);
  for (const name of ["rpiv_todo_gray", "rpiv_todo_ui", "subagents_ui"]) {
    checkProcess(Bun.spawnSync(["python3", "-B", patcher(name)], {
      env: { ...process.env, HOME: home, RPIV_TODO_ROOT: todo, PI_SUBAGENTS_ROOT: agents },
    }));
  }
  peers(todo);
  peers(agents);
  link(todo, "@juicesharp/rpiv-config", join(dirname(todoSource), "rpiv-config"));
  link(todo, "typebox", join(dirname(dirname(todoSource)), "typebox"));
  for (const name of ["@sinclair", "croner", "nanoid", "typebox"]) link(agents, name, join(dirname(dirname(agentsSource)), name));
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  const load = (path: string) => import(pathToFileURL(path).href);
  const host = await load(join(sdk, "dist/modes/interactive/interactive-mode.js"));
  const { CompactFooter } = await load(join(sdk, "dist/modes/interactive/components/compact-layout.js"));
  const tui = await load(join(sdk, "node_modules/@earendil-works/pi-tui/dist/index.js"));
  const colors = await load(join(sdk, "dist/modes/interactive/theme/theme.js"));
  colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
  const { TodoOverlay } = await load(join(todo, "todo-overlay.ts"));
  const store = await load(join(todo, "state/store.ts"));
  const { AgentWidget } = await load(join(agents, "src/ui/agent-widget.ts"));
  const { formatPlanStatus } = await import("../extensions/plan-mode/status");
  const { TuiBase } = await load(join(sdk, "node_modules/@earendil-works/pi-tui/dist/tui.js"));
  TuiBase.prototype.requestRender = () => {};

  const powerline = copyPowerline(home, powerlineSource,
    ["index.ts", "segments.ts", "types.ts", "powerline-config.ts", "bash-mode/editor.ts"], patcher("powerline_layout"));
  checkProcess(Bun.spawnSync(["python3", "-B", patcher("powerline_editor")], { env: { ...process.env, HOME: home } }));
  const editorSource = readFileSync(join(powerline, "index.ts"), "utf8");
  const frame = editorSource.slice(editorSource.indexOf("      // configs:powerline-editor-v1"), editorSource.indexOf("\n      return editor;", editorSource.indexOf("      // configs:powerline-editor-v1")));
  const wrapEditor = new Function("editor", "tui", "getFgAnsiCode", "ansi", "bashModeActive", "isSigilIdeaDraft", "captureSigilGlyph", "footerDataRef", "visibleWidth", "truncateToWidth", "sliceByColumn", "currentCtx", "ctx",
    new Bun.Transpiler({ loader: "ts" }).transformSync(frame) + "\nreturn editor;");
  const status = formatPlanStatus(false, "medium");
  const footerData = { getExtensionStatuses: () => new Map([["agent-mode", status.mode], ["agent-thinking", status.thinking]]) };
  const terminal = { columns: 40, rows: 12, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const app = Object.create(host.InteractiveMode.prototype);
  app.options = {};
  app.renderer = host.createInteractiveTui({ tuiMode: "regular", terminal });
  app.ui = host.createInteractiveTuiReference(() => app.renderer);
  app.extensionWidgetsAbove = new Map();
  app.extensionWidgetsBelow = new Map();
  for (const name of ["documentContainer", "pendingMessagesContainer", "statusContainer", "widgetContainerAbove", "widgetContainerBelow", "editorContainer", "footerContainer"]) app[name] = new tui.Container();
  app.footerContainer = new CompactFooter(app.ui);
  app.runtimeHost = { session: { settingsManager: {
    getFullscreenScrollbar: () => "always", getFullscreenCopyOnSelect: () => false,
  } } };
  app.documentContainer.addChild(new tui.Text(Array(30).fill("Conversation history").join("\n"), 0, 0));
  app.statusContainer.addChild(new tui.Text("Working", 0, 0));
  app.editor = wrapEditor(new tui.Editor(app.ui, { borderColor: (s: string) => s, selectList: {} }, { paddingX: 1 }),
    app.ui, () => "\x1b[38;2;67;145;135m", { reset: "\x1b[0m", getFgAnsi: () => "\x1b[38;2;67;145;135m" }, false, () => false, () => "+", footerData,
    tui.visibleWidth, tui.truncateToWidth, tui.sliceByColumn, { model: { name: "Fixture Model" } }, { ui: { theme: colors.theme } });
  app.editor.focused = true;
  app.editorContainer.addChild(app.editor);
  // The real powerline factories have their own integration suite. Represent
  // their single compact primary row and intentionally blank native footer here.
  app.setExtensionWidget("powerline-top", () => new tui.Text("Model ● 52%", 0, 0), { placement: "belowEditor" });
  app.footerContainer.addChild({ render: () => [""], invalidate() {} });
  const uiContext = { setWidget: app.setExtensionWidget.bind(app), setStatus() {}, theme: colors.theme, getToolsExpanded: () => true };
  store.__resetState();
  store.setActiveRenderSession("compact-test");
  store.replaceState("compact-test", { nextId: 9, tasks: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, status: i === 0 ? "in_progress" : "pending", subject: `Todo ${i + 1}`, activeForm: "Checking" })) });
  const todoWidget = new TodoOverlay();
  todoWidget.setUICtx(uiContext);
  todoWidget.update();
  const records = ["running", "error", "queued"].map((status, index) => ({ id: String(index), type: "Explore", status, description: `Agent ${index}`, startedAt: 1, completedAt: status === "error" ? 2 : undefined, error: status === "error" ? "Denied" : undefined, toolUses: 0 }));
  const agentWidget = new AgentWidget({ listAgents: () => records }, new Map());
  agentWidget.setUICtx(uiContext);
  agentWidget.update();
  const source = readFileSync(join(sdk, "dist/modes/interactive/interactive-mode.js"), "utf8");
  const composition = source.slice(source.indexOf("        this.renderWidgets(); // Initialize with default spacer"), source.indexOf("        // Accept text while startup completes"));
  const { createChatViewport } = await load(join(sdk, "dist/modes/interactive/chat-viewport.js"));
  new Function("createChatViewport", "theme", composition).call(app, createChatViewport, colors.theme);

  try {
    for (const mode of ["regular", "fullscreen", "regular"]) {
      expect(app.switchTuiMode(mode, false, false)).toBe(true);
      if (mode === "fullscreen") app.renderer.altScreenActive = true;
      let cursor: any;
      const extract = app.renderer.extractCursorPosition.bind(app.renderer);
      app.renderer.extractCursorPosition = (lines: string[], height: number) => cursor = extract(lines, height);
      for (const [width, rows] of [[40, 12], [50, 16], [60, 20], [120, 12], [40, 40], [120, 40]]) {
        terminal.columns = width;
        terminal.rows = rows;
        for (const text of ["Hello 界", "Long input 界 ".repeat(50)]) {
          app.editor.setText(text);
          app.ui.renderNow();
          const screen = (mode === "regular" ? app.renderer.previousLines.slice(-rows) : app.renderer.previousScreen);
          const visible = screen.map(tui.stripTerminalSequences).join("\n");
          expect(visible).toContain("Conversation history");
          expect(visible).toContain("Todos");
          expect(visible).toContain("Agents");
          expect(visible).toContain("Model");
          expect(cursor).not.toBeNull();
          expect(screen.every((line: string) => tui.visibleWidth(line) <= width)).toBe(true);
          expect(app.editor.getText()).toBe(text);
        }
      }
    }
  } finally {
    todoWidget.dispose();
    agentWidget.dispose();
    store.__resetState();
  }
});
