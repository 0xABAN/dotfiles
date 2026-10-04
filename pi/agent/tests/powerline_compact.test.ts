import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nativeSuite } from "./support/native_suite";
import { copyPowerline, describePatch, temporaryDirectory } from "./support/patch_fixtures";

const patcher = new URL("../patches/powerline_layout.py", import.meta.url).pathname;
const { edits } = describePatch<{ edits: [string, string][] }>(patcher, "{'edits':m['COMPACT_EDITS']}");
const sdk = process.env.PI_SDK_ROOT;
const installed = process.env.PI_POWERLINE_ROOT ?? join(homedir(), ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
const { nativeTest: test } = nativeSuite(import.meta.path, !!sdk && existsSync(installed));
const root = temporaryDirectory("powerline-compact-");
const transpiler = new Bun.Transpiler({ loader: "ts" });
let fixture: string | undefined;
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

async function harness(previous = false) {
  fixture ??= copyPowerline(root, installed, ["index.ts", "segments.ts", "types.ts", "powerline-config.ts"], patcher);
  let source = readFileSync(join(fixture, "index.ts"), "utf8");
  if (previous) for (const [old, next] of edits) source = source.replace(next, old);
  const helpers = source.slice(source.indexOf(previous ? "/** Render a single segment" : "// configs:powerline-compact-v1"), source.indexOf("// Extension\n"));
  const widgets = source.slice(source.indexOf("  function getResponsiveLayout("), source.indexOf("  function setupCustomEditor("));
  const { visibleWidth, truncateToWidth } = await import(`${sdk}/node_modules/@earendil-works/pi-tui/dist/index.js`);
  const segmentSource = readFileSync(join(fixture, "segments.ts"), "utf8");
  const segmentCode = segmentSource.slice(segmentSource.indexOf("// configs:powerline-meter-v1"), segmentSource.indexOf("const contextTotalSegment"));
  const theme = { fg: (role: string, text: string) => `\x1b[38;2;${role === "error" || role === "contextError" ? "199;131;124" : role === "warning" || role === "contextWarn" ? "95;168;118" : "67;145;135"}m${text}\x1b[0m` };
  const context = new Function("getIcons", "color", "withIcon", "formatTokens", transpiler.transformSync(segmentCode) + "\nreturn contextPctSegment;")(
    () => ({}), (_ctx: unknown, role: string, text: string) => theme.fg(role, text), (_icon: string, text: string) => text, String,
  );
  const env = {
    tui: { terminal: { rows: 30 } }, calls: 0,
    ctx: { options: { context: { format: "meter" } }, contextPercent: 52 as number | null, contextTokens: 520 as number | null, contextWindow: 1000, contextApproximate: true },
    summary: { queueCount: 3, ideaCount: 2, blockedCount: 1, compacting: false, leadingText: "界🙂 task with a long description", leadingStatus: "failed", leadingIntent: "steer" },
    statuses: new Map<string, string>(),
    commands: [
      { command: "first", exitCode: 1 as number | null, output: ["old failure"] },
      { command: "界🙂".repeat(40), exitCode: 2, output: Array.from({ length: 8 }, (_, i) => `output ${i}`) },
    ],
    contents: new Map<string, string>([["model", "GPT-5.6 Sol"], ["git", "branch/" + "界".repeat(40)], ["cost", "$52.14"], ["shell_mode", "fish · run"]]),
  };
  const factories = new Map<string, any>();
  const ui = { setWidget: (name: string, factory: any) => factories.set(name, factory(env.tui, theme)) };
  const setup = `
    let currentCtx = {}, footerDataRef = { getExtensionStatuses: () => env.statuses };
    let lastLayoutWidth = 0, lastLayoutRows = Infinity, lastLayoutResult = null, lastLayoutTimestamp = 0;
    let layoutDirty = true, forceNextLayoutRecompute = false, lastEditorInputAt = 0;
    let isStreaming = false, bashModeActive = false, showLastPrompt = true, lastUserPrompt = 'previous prompt';
    const tuiRef = env.tui, enabled = true, powerlineCompacting = false;
    const STREAMING_LAYOUT_CACHE_TTL_MS = 1000, LAYOUT_CACHE_TTL_MS = 250, EDITOR_STATUS_DEFER_MS = 150;
    const config = { separator: 'chevron', preset: 'default', customItems: [], placement: 'below' };
    const getPreset = () => ({}), getQueueContext = () => ({});
    const collectHiddenExtensionStatusKeys = () => new Set();
    const getNotificationExtensionStatuses = (statuses) => [...statuses.values()];
    const isStaleExtensionContextError = () => false;
    const buildSegmentContext = () => { env.calls++; return env.ctx; };
    const queueStore = { summarize: () => env.summary };
    const bashTranscript = { getSnapshot: () => ({ commands: env.commands, truncatedCommands: 0 }) };
    const shellSession = { state: { shellName: 'fish' } };
    const requestStatusRender = () => {}, resetLayoutCache = () => { lastLayoutResult = null; };
    const pi = { events: { on() {}, emit() {} } };
  `;
  const api = new Function("env", "ui", "theme", "visibleWidth", "truncateToWidth", "renderSegment", "mergeSegmentsWithCustomItems", "getSeparator", "getFgAnsiCode", "ansi",
    transpiler.transformSync(setup + helpers + widgets) + `
    installPowerlineWidgets({ ui });
    return { setBash: value => { bashModeActive = value; }, typing: () => { lastEditorInputAt = Date.now(); } };
  `)(env, ui, theme, visibleWidth, truncateToWidth,
    (id: string) => id === "context_pct" ? context.render(env.ctx) : { content: env.contents.get(id) ?? "", visible: env.contents.has(id) },
    () => ({ leftSegments: ["model", "git"], rightSegments: ["cost", "context_pct"], secondarySegments: ["shell_mode", "queue"] }),
    () => ({ left: "›" }), () => "", { reset: "\x1b[0m" });
  return { env, api, factories, theme, render: (name: string, width: number) => factories.get(`powerline-${name}`).render(width) as string[] };
}

test("actual widget factories resize by live height without stale cached layouts", async () => {
  const app = await harness();
  const normal = app.render("top", 120);
  for (const rows of [12, 20, 30, 12]) {
    app.env.tui.terminal.rows = rows;
    app.api.typing();
    for (const width of [40, 55, 70, 120]) {
      const top = app.render("top", width);
      expect(top).toHaveLength(1);
      expect(Bun.stringWidth(top[0])).toBeLessThanOrEqual(width);
      if (width < 80 || rows < 24) {
        expect(plain(top[0])).toContain("GPT-5.6 Sol");
        expect(plain(top[0])).toContain("●");
        expect(plain(top[0])).toContain("~52%");
        expect(plain(top[0])).not.toContain("context");
        expect(app.render("secondary", width)).toEqual([]);
      }
      expect(app.render("last-prompt", width).length).toBe(rows < 24 ? 0 : 1);
    }
  }
  app.env.tui.terminal.rows = 30;
  expect(app.render("top", 120)).toEqual(normal);
  expect(app.env.calls).toBeGreaterThan(1);
});

test("short bash and queue previews retain failures, counts and outcomes", async () => {
  const app = await harness();
  app.api.setBash(true);
  for (const rows of [12, 20, 30]) {
    app.env.tui.terminal.rows = rows;
    for (const width of [40, 70, 120]) {
      const bash = app.render("bash-transcript", width);
      if (width < 80 || rows < 24) {
        expect(bash.length).toBeLessThanOrEqual(rows < 16 ? 2 : 3);
        expect(plain(bash[0])).toContain("exit 2");
        expect(plain(bash[0])).toContain("2 failed");
        expect(bash.join(" ")).toContain("199;131;124");
        expect(bash.every(line => Bun.stringWidth(line) <= width)).toBe(true);
        const queue = app.render("queue-preview", width);
        expect(queue).toHaveLength(1);
        expect(plain(queue[0])).toContain("q 3");
        expect(plain(queue[0])).toContain("ideas 2");
        expect(plain(queue[0])).toContain("blocked 1");
        expect(Bun.stringWidth(queue[0])).toBeLessThanOrEqual(width);
      }
    }
  }
  app.env.commands.at(-1)!.exitCode = null;
  expect(plain(app.render("bash-transcript", 40)[0])).toContain("running");
  app.env.statuses.set("failure", "[error] " + "界".repeat(80));
  const status = app.render("status", 40);
  expect(status).toHaveLength(1);
  expect(plain(status[0])).toContain("[error]");
  expect(Bun.stringWidth(status[0])).toBeLessThanOrEqual(40);
});

test("compact context keeps unknown/approximate values and threshold colors", async () => {
  const app = await harness();
  for (const [percent, color] of [[null, "67;145;135"], [52, "67;145;135"], [71, "95;168;118"], [91, "199;131;124"]] as const) {
    app.env.ctx.contextPercent = percent;
    app.env.ctx.contextTokens = percent === null ? null : percent * 10;
    app.factories.get("powerline-top").invalidate();
    for (const width of [40, 70]) {
      const [row] = app.render("top", width);
      expect(row).toContain(`\x1b[38;2;${color}m●`);
      expect(plain(row)).toContain(percent === null ? "?" : `~${percent}%`);
      expect(plain(row)).not.toContain("context");
      expect(plain(row).includes("[")).toBe(width >= 60);
    }
  }
});

test("layout and editor replay without changing the DJ-owned prompt factory", () => {
  const home = join(root, "replay");
  const target = copyPowerline(home, installed, ["index.ts", "segments.ts", "types.ts", "powerline-config.ts", "bash-mode/editor.ts"], patcher);
  const patches = ["powerline_editor", "powerline_dj", "powerline_layout"];
  const run = (name: string) => Bun.spawnSync(["python3", "-B", new URL(`../patches/${name}.py`, import.meta.url).pathname], {
    env: { ...process.env, HOME: home },
  });
  for (const name of patches) {
    const result = run(name);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  }
  const current = readFileSync(join(target, "index.ts"), "utf8");
  for (const name of patches) expect(run(name).exitCode).toBe(0);
  expect(readFileSync(join(target, "index.ts"), "utf8")).toBe(current);
});

test("full-size widgets remain byte-identical to the preceding layout", async () => {
  const app = await harness();
  const old = await harness(true);
  for (const bash of [false, true]) {
    app.api.setBash(bash);
    old.api.setBash(bash);
    for (const name of ["top", "secondary", "status", "queue-preview", "bash-transcript", "last-prompt"]) {
      expect(app.render(name, 180)).toEqual(old.render(name, 180));
    }
  }
});
