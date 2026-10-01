import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { copyPowerline, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/powerline-editor.py", import.meta.url));
const { edits, border, legacyBorder, badgeImport, legacyPrompt, preVisibleRows, gitLabel, badgeBudget, renderHeight, previousDouble, previousPadded, whiteOutline, roseEdits } = describePatch<{
  edits: Record<string, [string, string][]>;
  border: [string, string];
  legacyBorder: [string, string];
  badgeImport: [string, string];
  legacyPrompt: string;
  preVisibleRows: string;
  gitLabel: [string, string];
  badgeBudget: [string, string];
  renderHeight: [string, string];
  previousDouble: string;
  previousPadded: string;
  whiteOutline: [string, string][];
  roseEdits: [string, string, number][];
}>(patcher, "{'edits':m['EDITS'],'border':m['BORDER_EDIT'],'legacyBorder':m['LEGACY_BORDER_EDIT'],'badgeImport':m['BADGE_IMPORT'],'legacyPrompt':m['LEGACY_PROMPT'],'preVisibleRows':m['PRE_VISIBLE_ROWS'],'gitLabel':m['GIT_LABEL_EDIT'],'badgeBudget':m['BADGE_BUDGET_EDIT'],'renderHeight':m['RENDER_HEIGHT_EDIT'],'previousDouble':m['PREVIOUS_DOUBLE_PADDING_RENDER_HEIGHT'],'previousPadded':m['PREVIOUS_PADDED_INPUT_ROW'],'whiteOutline':m['WHITE_OUTLINE_EDITS'],'roseEdits':m['THEME_COLOR_EDITS']}",
  "m['EDITS']['index.ts'].append(m['PROMPT_EDIT'])");
const withRosePine = (source: string) => roseEdits.reduce((text, [old, next]) => text.replace(old, next), source);
const withoutRosePine = (source: string) => roseEdits.reduce((text, [old, next]) => text.replace(next, old), source);
// The frame migrations still use their exact old anchors; assertions inspect
// the final color overlay that runs after those guards.
border[1] = withRosePine(border[1]);
whiteOutline[0][1] = withRosePine(whiteOutline[0][1]);
edits["index.ts"].at(-1)![1] = withRosePine(edits["index.ts"].at(-1)![1]);

const root = temporaryDirectory("powerline-editor-");
const sdk = process.env.PI_SDK_ROOT;
const installed = process.env.PI_POWERLINE_ROOT ?? join(homedir(), ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk && existsSync(installed));
let fixture: string | undefined;
function source(file: string) {
  fixture ??= copyPowerline(join(root, "real"), installed, Object.keys(edits), patcher);
  return readFileSync(join(fixture, file), "utf8");
}

function sandbox(name: string) {
  const home = join(root, name);
  const dir = join(home, ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
  for (const [file, replacements] of Object.entries(edits)) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, replacements.map(([old]) => old).join("\n")
      + (file === "index.ts" ? `\n${badgeImport[0]}\n` : "") + "\n// preserve footer layout\n");
  }
  return {
    dir,
    contents: () => Object.fromEntries(Object.keys(edits).map(file => [file, readFileSync(join(dir, file), "utf8")])),
    run: () => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, HOME: home } }),
  };
}

test("powerline owns the final editor after pi-pretty installs its prompt", () => {
  const settings = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8"));
  const packages = settings.packages.map((entry: string | { source: string }) =>
    typeof entry === "string" ? entry : entry.source);
  const pretty = packages.findIndex((source: string) => source.startsWith("npm:@heyhuynhgiabuu/pi-pretty"));
  const powerline = packages.findIndex((source: string) => source.includes("nicobailon/pi-powerline-footer"));
  expect(pretty).toBeGreaterThanOrEqual(0);
  expect(powerline).toBeGreaterThan(pretty);
  expect(settings.powerline.layout.left).toEqual(["model", "custom:thinking"]);
  expect(Object.values(settings.powerline.layout).flat()).not.toContain("custom:mode");
});

test("editor patch is idempotent and preserves unrelated changes", () => {
  const app = sandbox("valid");
  expect(app.run().exitCode).toBe(0);
  const patched = app.contents();
  expect(patched["index.ts"]).toContain("// preserve footer layout");
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(patched);
});

test("legacy outline migrates exactly and incomplete white outlines refuse writes", () => {
  const app = sandbox("white-outline");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const previous = whiteOutline.reduce((text, [old, replacement]) => text.replace(replacement, old), current["index.ts"]);
  writeFileSync(join(app.dir, "index.ts"), previous);
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);

  const [[oldRender, whiteRender], [oldBorder, whiteBorder]] = whiteOutline;
  for (const broken of [
    current["index.ts"].replace(whiteRender, oldRender),
    current["index.ts"].replace(whiteBorder, oldBorder),
    current["index.ts"].replace("ansi.getFgAnsi(255, 255, 255)", "ansi.getFgAnsi(254, 255, 255)"),
    current["index.ts"] + whiteRender,
    current["index.ts"] + oldRender,
  ]) {
    writeFileSync(join(app.dir, "index.ts"), broken);
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
});

test("older editor palettes migrate exactly and modified color overlays refuse writes", () => {
  const app = sandbox("rose-pine-colors");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const mediumOnly = current["index.ts"].replaceAll(', "everforest-dark-hard"', "");
  const roseOnly = mediumOnly.replaceAll(
    '["rose-pine", "everforest-dark-medium"].includes(ctx?.ui?.theme?.name ?? "")',
    'ctx?.ui?.theme?.name === "rose-pine"',
  );
  for (const previous of [withoutRosePine(current["index.ts"]), roseOnly, mediumOnly]) {
    writeFileSync(join(app.dir, "index.ts"), previous);
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
  }

  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace('ctx.ui.theme.fg("text", s)', 'ctx.ui.theme.fg("error", s)'));
  const before = app.contents();
  expect(app.run().exitCode).not.toBe(0);
  expect(app.contents()).toEqual(before);
});

test("existing editor height migrates from 30% to 40%", () => {
  const app = sandbox("legacy-height");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(
    edits["index.ts"][3][1], preVisibleRows,
  ));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
});

test("existing padded editor rows migrate to no padding", () => {
  const previousSingle = previousDouble
    .replace("visibleRowLimit - 2", "visibleRowLimit - 1")
    .replace("        lines.splice(2 + contentRows, 0, blankRow);\n        inputLineCount = contentRows + 2;", "        inputLineCount = contentRows + 1;");
  for (const [name, previousRender] of [["double", previousDouble], ["single", previousSingle]] as const) {
    const app = sandbox(`legacy-${name}-padding`);
    expect(app.run().exitCode).toBe(0);
    const current = app.contents();
    const previous = current["index.ts"]
      .replace(renderHeight[1], previousRender)
      .replace(edits["index.ts"][5][1], previousPadded);
    writeFileSync(join(app.dir, "index.ts"), previous);
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
  }
});

test("existing editor inset migrates without double-padding the shared viewport", () => {
  const app = sandbox("legacy-inset");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(
    "const margin = 0; // The Pi host owns the shared outer inset.",
    "const margin = Math.max(2, Math.floor(width * 0.04));",
  ));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
});

test("existing framed prompt upgrades to a diamond and rejects unknown prompts", () => {
  const app = sandbox("legacy-prompt");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const [oldPrompt, newPrompt] = edits["index.ts"].at(-1)!;
  const previousTeal = withoutRosePine(newPrompt).replace("ansi.getFgAnsi(67, 145, 135)", "ansi.getFgAnsi(94, 158, 128)");
  for (const previous of [oldPrompt, legacyPrompt, previousTeal]) {
    writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(newPrompt, previous));
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
  }
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(newPrompt, "unknown prompt"));
  const before = app.contents();
  expect(app.run().exitCode).not.toBe(0);
  expect(app.contents()).toEqual(before);
});

test("existing plain border upgrades without disturbing other source", () => {
  const app = sandbox("legacy-border");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  for (const previous of [border[0], legacyBorder[1], legacyBorder[1].replace('join(" ❯ ")', 'join(" · ")')]) {
    writeFileSync(join(app.dir, "index.ts"), current["index.ts"]
      .replace(gitLabel[1], gitLabel[0])
      .replace(border[1], previous).replace(badgeImport[1], badgeImport[0]));
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
  }
});

for (const helper of [
  "editor-badges-before-centered-scroll.ts.inc",
  "editor-badges-before-tps.ts.inc",
  "editor-badges-before-leading-tps.ts.inc",
  "editor-badges-before-full-mode.ts.inc",
  "editor-badges-before-response-time.ts.inc",
  "editor-badges-before-model-branch.ts.inc",
  "editor-badges-before-sage-timer.ts.inc",
]) {
  test(`${helper} migrates exactly; partial or modified predecessors refuse writes`, () => {
    const app = sandbox(helper);
    expect(app.run().exitCode).toBe(0);
    const current = app.contents();
    const previousBorder = readFileSync(new URL(
      `../patches/payloads/powerline/legacy/${helper}`, import.meta.url), "utf8").trimEnd();
    const previous = current["index.ts"]
      .replace(gitLabel[1], gitLabel[0])
      .replace(border[1], previousBorder);
    writeFileSync(join(app.dir, "index.ts"), previous);
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);

    for (const mode of ["missing-import", "modified-payload", "duplicate-payload", "mixed-payload", "partial-frame"]) {
      let index = previous;
      if (mode === "missing-import") index = index.replace(badgeImport[1], badgeImport[0]);
      if (mode === "modified-payload") index = previousBorder.includes("const compact = width < 80")
        ? index.replace("const compact = width < 80", "const compact = width < 81")
        : previousBorder.includes("const responseTime = statuses?.get(\"agent-response-time\") ?? \"\";")
          ? index.replace("const responseTime = statuses?.get(\"agent-response-time\") ?? \"\";",
            "const responseTime = statuses?.get(\"agent-response-time\") ?? \"modified\";")
          : index.replace("const throughput = statuses?.get(\"agent-tps\") ?? \"\";",
            "const throughput = statuses?.get(\"agent-tps\") ?? \"modified\";");
      if (mode === "duplicate-payload") index += previousBorder;
      if (mode === "mixed-payload") index += border[1];
      writeFileSync(join(app.dir, "index.ts"), index);
      writeFileSync(join(app.dir, "bash-mode/editor.ts"), mode === "partial-frame"
        ? current["bash-mode/editor.ts"].replace(edits["bash-mode/editor.ts"][0][1], edits["bash-mode/editor.ts"][0][0])
        : current["bash-mode/editor.ts"]);
      const before = app.contents();
      expect(app.run().exitCode, mode).not.toBe(0);
      expect(app.contents()).toEqual(before);
    }
  });
}

test("partial or modified editor badges refuse writes", () => {
  const app = sandbox("compact-partial");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const canonical = current["index.ts"].replace(gitLabel[1], gitLabel[0]);
  for (const index of [
    canonical.replace(badgeImport[1], badgeImport[0]),
    canonical.replace(border[1], legacyBorder[1]),
    canonical.replace(badgeBudget[1], badgeBudget[0].replace("- 9", "- 10")),
    canonical.replace("ansi.getBgAnsi(95, 168, 118)", "ansi.getBgAnsi(50, 109, 101)"),
    canonical.replace("ansi.getFgAnsi(18, 19, 25)", "ansi.getFgAnsi(243, 238, 223)"),
  ]) {
    writeFileSync(join(app.dir, "index.ts"), index);
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
});

test("partial or unknown editor sources fail before any write", () => {
  for (const partial of [false, true]) {
    const app = sandbox(String(partial));
    writeFileSync(join(app.dir, "bash-mode/editor.ts"), partial ? edits["bash-mode/editor.ts"][0][1] : "changed source");
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
});

// Opt-in native checks retain the real editor, but use checkout-patched wrapper sources.
const transpiler = new Bun.Transpiler({ loader: "ts" });
const marker = "\x1b_pi:c\x07";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replaceAll(marker, "");

function expectWhiteOutline(rows: string[]) {
  let borderCells = 0;
  for (const row of rows) {
    const cells = plain(row).match(/[─│╭╮╰╯]/g)?.length ?? 0;
    const whiteCells = [...row.matchAll(/\x1b\[38;2;255;255;255m([─│╭╮╰╯]+)/g)]
      .reduce((count, match) => count + match[1].length, 0);
    expect(whiteCells).toBe(cells);
    borderCells += cells;
  }
  expect(borderCells).toBeGreaterThan(0);
}

async function host() {
  return import(pathToFileURL(join(sdk!, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
}

realTest("real package resolver preserves editor ownership order", async () => {
  const { DefaultPackageManager } = await import(pathToFileURL(join(sdk!, "dist/core/package-manager.js")).href);
  const { SettingsManager } = await import(pathToFileURL(join(sdk!, "dist/core/settings-manager.js")).href);
  const settings = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8"));
  const packages = settings.packages.filter((entry: string | { source: string }) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return source.includes("pi-pretty") || source.includes("pi-powerline-footer");
  });
  const manager = new DefaultPackageManager({
    cwd: process.cwd(), agentDir: join(homedir(), ".pi/agent"),
    settingsManager: SettingsManager.inMemory({ packages }),
  });
  // Never install or update anything as part of a test.
  const resources = await manager.resolve(async () => "error");
  const paths = resources.extensions.filter((entry: { enabled: boolean; path: string }) =>
    entry.enabled && (entry.path.includes("pi-pretty") || entry.path.includes("pi-powerline-footer")))
    .map((entry: { path: string }) => entry.path);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toContain("pi-pretty");
  expect(paths[1]).toContain("pi-powerline-footer");
});

realTest("real editor fills the shared viewport through wrapping, scrolling, completion and paste", async () => {
  const { Editor, visibleWidth, truncateToWidth, sliceByColumn } = await host();
  const text = source("index.ts");
  const start = text.indexOf("      // configs:powerline-editor-v1");
  expect(start).toBeGreaterThan(0);
  const end = text.indexOf("\n      return editor;", start);
  const wrap = new Function("editor", "tui", "getFgAnsiCode", "ansi", "bashModeActive", "isSigilIdeaDraft", "captureSigilGlyph",
    "footerDataRef", "currentCtx", "ctx", "visibleWidth", "truncateToWidth", "sliceByColumn",
    "renderSegment", "buildSegmentContext",
    transpiler.transformSync(text.slice(start, end)) + "\nreturn editor;");
  const { formatPlanStatus } = await import("../extensions/plan-mode/status");
  const gradient = formatPlanStatus(false, "medium");
  const statuses = new Map([
    ["agent-mode", gradient.mode],
    ["agent-thinking", gradient.thinking],
  ]);
  const footer = { getExtensionStatuses: () => statuses, getGitBranch: () => "main" };
  const currentCtx = { model: { name: "gpt-5.4" } };
  const renderSegment = (id: string) => id === "git"
    ? { visible: true, content: "\uF126 main *4" }
    : { visible: false, content: "" };
  const buildSegmentContext = () => ({});
  const tui = { terminal: { rows: 30 }, requestRender() {} };
  const hostBorder = (s: string) => `\x1b[38;2;67;145;135m${s}\x1b[0m`;
  const uiContext = { ui: { theme: {} } };
  const editor = wrap(new Editor(tui, { borderColor: hostBorder, selectList: {} }, { paddingX: 1 }),
    tui, () => "\x1b[38;2;95;168;118m",
    {
      reset: "\x1b[0m",
      getFgAnsi: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
      getBgAnsi: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
    },
    false, () => false, () => "+", footer, currentCtx, uiContext, visibleWidth, truncateToWidth, sliceByColumn,
    renderSegment, buildSegmentContext);
  editor.focused = true;
  const nativeTopBorder = editor.renderTopBorder.bind(editor);
  editor.renderTopBorder = (width: number, hidden: number) => {
    // Embedded working indicators also read borderColor during render.
    expect(editor.borderColor("Working")).toBe(hostBorder("Working"));
    return nativeTopBorder(width, hidden);
  };
  for (const width of [9, 16, 80]) {
    expectWhiteOutline(editor.render(width));
    expect(editor.borderColor).toBe(hostBorder);
  }
  expect(editor.render(80)[1]).toContain("\x1b[38;2;67;145;135m◆\x1b[0m");
  for (const [bashMode, captureMode, glyph] of [[true, false, "$"], [false, true, "+"]] as const) {
    const special = wrap(new Editor(tui, { borderColor: (s: string) => s, selectList: {} }),
      tui, () => "\x1b[38;2;95;168;118m",
      { reset: "\x1b[0m", getFgAnsi: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m` },
      bashMode, () => captureMode, () => "+",
      undefined, undefined, undefined, visibleWidth, truncateToWidth, sliceByColumn,
      renderSegment, buildSegmentContext);
    const specialRows = special.render(80);
    expectWhiteOutline(specialRows);
    const row = specialRows[1];
    expect(plain(row)).toStartWith(`│ ${glyph} `);
    expect(row).toContain(`\x1b[38;2;${bashMode ? "200;200;200" : "95;168;118"}m${glyph}\x1b[0m`);
  }

  for (const text of ["", "hello", "界🙂".repeat(30), "───\nsecond line", Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")]) {
    editor.setText(text);
    for (const width of [16, 40, 80, 160]) {
      const rows = editor.render(width);
      const margin = 0;
      expect(plain(rows[0]).startsWith(" ".repeat(margin) + "╭")).toBe(true);
      expect(plain(rows.at(-1)).endsWith("╯")).toBe(true);
      expect(rows.every((s: string) => visibleWidth(s) <= width)).toBe(true);
      expect(visibleWidth(rows[0])).toBe(width - margin);
      expect(rows.join("").split(marker).length - 1).toBe(1);
      expect(editor.getText()).toBe(text);
    }
  }
  editor.setText(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
  expect(editor.render(80)).toHaveLength(14);
  editor.setText("");
  expect(editor.render(80)).toHaveLength(3);
  const top = editor.render(80)[0];
  expect(plain(top)).toEndWith(" build mode ❯  main *4 ──╮");
  expect(top).toContain(statuses.get("agent-mode")!);
  expect(plain(top)).not.toContain("think:med");
  expect(plain(editor.render(80).at(-1))).not.toContain("gpt-5.4 ❯ think:med");
  expect(visibleWidth(top)).toBe(80);
  expect(plain(editor.render(16)[0])).not.toContain("build mode");
  for (const height of [12, 20, 30, 12]) {
    tui.terminal.rows = height;
    for (const width of [40, 55, 70, 100, 40]) {
      editor.setText("界🙂".repeat(1000));
      const rows = editor.render(width);
      expectWhiteOutline(rows);
      expect(rows.every((row: string) => visibleWidth(row) <= width)).toBe(true);
      expect(rows.join("").split(marker)).toHaveLength(2);
      // Preserve the complete native count, not just an arrow left after clipping.
      const nativeBorder = Editor.prototype.renderTopBorder.call(editor, width - 5, editor.scrollOffset);
      const hint = plain(nativeBorder).match(/↑ \d+ more/)![0];
      expect(plain(rows[0])).toContain(hint);
      expect(plain(rows[0])).toStartWith("╭────── ↑ ");
      expect(plain(rows[0])).toContain("\uF121  build mode");
      expect(rows[0]).toContain(statuses.get("agent-mode")!);
      expect(plain(rows[0]).includes("main")).toBe(width > 40);
      const bottom = plain(rows.at(-1));
      expect(bottom.includes("think:med")).toBe(false);
      expect(rows[0].includes("\x1b[0m ❯ ")).toBe(width > 40);
      expect(rows[0].match(/\x1b\[38;2;/g)!.length).toBeGreaterThan(5);
      expect(editor.getText()).toBe("界🙂".repeat(1000));
    }
  }
  tui.terminal.rows = 30;
  editor.setText("");
  expect(editor.render(80)[0]).toBe(top);
  statuses.set("agent-thinking", formatPlanStatus(false, "xhigh").thinking);
  statuses.set("agent-response-time", "1m 05s");
  for (const width of [80, 120]) {
    const rows = editor.render(width);
    const row = rows[0];
    expect(plain(row)).toEndWith(" build mode ❯  main *4 ──╮");
    const paintedResponse = "\x1b[48;2;95;168;118m\x1b[38;2;18;19;25m 1m 05s \x1b[0m";
    expectWhiteOutline(rows);
    expect(row).toContain(paintedResponse + "   " + statuses.get("agent-mode"));
    expect(plain(row).match(/❯/g)).toHaveLength(1);
    expect(plain(rows.at(-1))).not.toContain("gpt-5.4 ❯ think:xhigh");
    expect(plain(row)).not.toContain("think:xhigh");
    expect(visibleWidth(row)).toBe(width);
  }
  statuses.set("agent-response-time", "—");
  expect(plain(editor.render(80)[0])).toContain(" —    \uF121  build mode ❯  main *4");
  statuses.set("agent-response-time", "1m 05s");
  editor.setText("界🙂".repeat(1000));
  for (const width of [40, 55, 80]) {
    const rows = editor.render(width);
    expectWhiteOutline(rows);
    const row = plain(rows[0]);
    expect(row).toContain("\uF121  build mode");
    expect(row.includes("main")).toBe(width > 40);
    const bottom = plain(rows.at(-1));
    expect(bottom.includes("xhigh")).toBe(false);
    expect(bottom.includes("think:")).toBe(false);
    const hint = plain(Editor.prototype.renderTopBorder.call(editor, width - 5, editor.scrollOffset)).match(/↑ \d+ more/)![0];
    expect(row).toContain(hint);
    expect(row.includes(" 1m 05s "), `width ${width}: ${row}`).toBe(width >= 55);
    expect(rows.every((line: string) => visibleWidth(line) <= width)).toBe(true);
    expect(rows.join("").split(marker)).toHaveLength(2);
  }
  statuses.delete("agent-response-time");
  editor.setText("");
  const plan = formatPlanStatus(true, "high");
  statuses.set("agent-mode", plan.mode);
  statuses.set("agent-thinking", plan.thinking);
  expectWhiteOutline(editor.render(80));
  expect(plain(editor.render(80)[0])).toEndWith(" plan mode ❯  main *4 ──╮");
  expect(plain(editor.render(80).at(-1))).not.toContain("gpt-5.4 ❯ think:high");
  tui.terminal.rows = 12;
  expect(editor.render(40)[0]).toContain(plan.mode);
  editor.setText(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
  expect(editor.render(9).every((s: string) => visibleWidth(s) <= 9)).toBe(true);
  expect(plain(editor.render(80)[0])).toContain("↑");

  editor.setText("/a");
  editor.autocompleteState = {};
  editor.autocompleteList = { render: () => ["completion", "───"] };
  for (const height of [12, 30]) {
    tui.terminal.rows = height;
    for (const width of [40, 80]) {
      const completed = editor.render(width).map(plain);
      const bottomBorderIndex = 2;
      expect(completed[bottomBorderIndex].endsWith("╯")).toBe(true);
      expect(completed[bottomBorderIndex + 1].trim()).toBe("completion");
      expect(completed[bottomBorderIndex + 2].trim()).toBe("───");
      // Four columns for the frame/prompt, plus native input padding.
      expect(completed[bottomBorderIndex + 1].indexOf("completion")).toBe(5);
    }
  }
  editor.autocompleteState = null;
  editor.autocompleteList = null;
  editor.setText("");
  editor.handleInput("\x1b[200~hello\nworld\x1b[201~");
  expect(editor.getExpandedText()).toBe("hello\nworld");
  expect(editor.render(40).join("")).toContain(marker);

  const layoutText = editor.layoutText;
  editor.layoutText = () => { throw new Error("render failed"); };
  for (const width of [9, 80]) {
    expect(() => editor.render(width)).toThrow("render failed");
    expect(editor.borderColor).toBe(hostBorder);
  }
  editor.layoutText = layoutText;

  // The same editor reads the selected theme live, without changing its geometry.
  const colors = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/theme/theme.js")).href);
  for (const name of ["rose-pine", "everforest-dark-medium", "everforest-dark-hard", "rose-pine"]) {
    const theme = colors.loadThemeFromPath(fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url)), "truecolor");
    uiContext.ui.theme = theme;
    editor.setText("");
    statuses.set("agent-response-time", "1.2s");
    statuses.set("agent-mode", formatPlanStatus(false, "medium", name).mode);
    const rows = editor.render(100);
    expect(rows[0]).toContain(theme.fg("text", "╭───"));
    expect(rows[0]).toContain(theme.inverse(theme.fg("accent", " 1.2s ")));
    expect(rows[1]).toContain(theme.getFgAnsi("accent") + "◆");
    expect(rows.join("\n")).not.toContain("\x1b[48;2;95;168;118m");
    expect(rows.every((row: string) => visibleWidth(row) <= 100)).toBe(true);
  }
  uiContext.ui.theme = {};
  expectWhiteOutline(editor.render(100));
});

realTest("bash ghost text preserves padded cursor and avoids overwriting wrapped input", async () => {
  const { Editor, visibleWidth, truncateToWidth } = await host();
  const text = source("bash-mode/editor.ts");
  const start = text.indexOf("  render(width: number): string[] {");
  const end = text.indexOf("  private isShellCompletionContext", start);
  const TestEditor = new Function("Editor", "visibleWidth", "truncateToWidth", transpiler.transformSync(
    `class TestEditor extends Editor { ghost = { value: 'echo hello' }; isShellCompletionContext() { return true; }\n${text.slice(start, end)}\n}`,
  ) + "\nreturn TestEditor;")(Editor, visibleWidth, truncateToWidth);
  const editor = new TestEditor({ terminal: { rows: 30 }, requestRender() {} }, { borderColor: (s: string) => s }, { paddingX: 1 });
  editor.focused = true;
  editor.setText("echo");
  const rows = editor.render(40);
  expect(rows[1]).toContain(marker);
  expect(plain(rows[1]).startsWith(" echo")).toBe(true);
  expect(plain(rows[1])).toContain("hello");
  expect(visibleWidth(rows[1])).toBe(40);
  editor.setText("echo ".repeat(20));
  editor.ghost.value = editor.getText() + "suffix";
  const wrapped = editor.render(25);
  expect(wrapped[1]).not.toContain("suffix");
  expect(wrapped.join("")).toContain(marker);
});
