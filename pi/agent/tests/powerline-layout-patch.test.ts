import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { copyPowerline, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const patcher = fileURLToPath(new URL("../patches/powerline-layout.py", import.meta.url));
const { edits, compactEdits, align, meter, legacyAlign, legacySeparator, legacyMeter } = describePatch<{
  edits: Record<string, [string, string][]>; align: string; meter: string;
  legacyAlign: string; legacySeparator: string; legacyMeter: string;
  compactEdits: [string, string][];
}>(patcher, "{'edits':m['EDITS'],'compactEdits':m['COMPACT_EDITS'],'align':m['ALIGN'],'meter':m['METER'],'legacyAlign':m['LEGACY_ALIGN'],'legacySeparator':m['LEGACY_SEPARATOR'],'legacyMeter':m['LEGACY_METER']}", `
m['EDITS']['segments.ts'].append(m['UNSTAGED_EDIT'])
m['EDITS']['index.ts'].extend([m['SEPARATOR_JOIN_EDIT'], m['SEPARATOR_ARGUMENT_EDIT'], m['SEPARATOR_EDIT']])
`);
const root = temporaryDirectory("powerline-layout-");
const packageSource = process.env.PI_POWERLINE_ROOT ?? join(homedir(), ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path,
  !!process.env.PI_SDK_ROOT && existsSync(packageSource));
let fixture: string | undefined;
function source(file: string) {
  fixture ??= copyPowerline(join(root, "real"), packageSource, Object.keys(edits), patcher);
  return readFileSync(join(fixture, file), "utf8");
}

function sandbox(name: string) {
  const home = join(root, name);
  const dir = join(home, ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
  mkdirSync(dir, { recursive: true });
  for (const [file, replacements] of Object.entries(edits)) {
    const anchors = replacements.map(([old]) => old);
    if (file === "index.ts") anchors.push(...compactEdits.map(([old]) => old));
    writeFileSync(join(dir, file), anchors.join("\n") + "\n// existing DJ patch\n");
  }
  const run = () => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, HOME: home } });
  const contents = () => Object.fromEntries(Object.keys(edits).map(file => [file, readFileSync(join(dir, file), "utf8")]));
  return { dir, run, contents };
}

test("patch is repeatable and preserves existing changes", () => {
  const app = sandbox("valid");
  expect(app.run().exitCode).toBe(0);
  const patched = app.contents();
  expect(Object.values(patched).every(s => s.includes("// existing DJ patch"))).toBe(true);
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(patched);
});

test("existing layouts upgrade only the unstaged count color", () => {
  const app = sandbox("count-color");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const [oldCount, newCount] = edits["segments.ts"].at(-1)!;
  writeFileSync(join(app.dir, "segments.ts"), current["segments.ts"].replace(newCount, oldCount));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
  writeFileSync(join(app.dir, "segments.ts"), current["segments.ts"].replace(newCount, "unknown count renderer"));
  const before = app.contents();
  expect(app.run().exitCode).not.toBe(0);
  expect(app.contents()).toEqual(before);
});

test("existing layouts upgrade their chevron renderer", () => {
  const app = sandbox("chevron");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const [oldSeparator, newSeparator] = edits["index.ts"].at(-1)!;
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(newSeparator, oldSeparator));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
});

test("existing right-hand groups upgrade to the green ball separator", () => {
  const app = sandbox("context-ball");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const [oldArgument, newArgument] = edits["index.ts"].at(-2)!;
  const [, newSeparator] = edits["index.ts"].at(-1)!;
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"]
    .replace(align, legacyAlign).replace(newSeparator, legacySeparator).replace(newArgument, oldArgument));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
  for (const previous of ["95, 168, 118", "94, 158, 128", "94, 158, 170", "67, 145, 135"]) {
    const previousAlign = legacyAlign.replace(
      "const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style);",
      'const right = buildContentFromParts(parts.filter(p => p.right).map(p => p.content), style,\n'
        + `    ansi.getFgAnsi(${previous}) + "●" + ansi.reset);`,
    );
    writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(align, previousAlign));
    writeFileSync(join(app.dir, "segments.ts"), current["segments.ts"].replace(meter, legacyMeter));
    expect(app.run().exitCode).toBe(0);
    expect(app.contents()).toEqual(current);
  }
});

test("complete pre-compact layouts migrate, partial compact layouts refuse writes", () => {
  const app = sandbox("compact-migration");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  let previous = current["index.ts"];
  for (const [old, next] of compactEdits) previous = previous.replace(next, old);
  writeFileSync(join(app.dir, "index.ts"), previous);
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);

  for (const [old, next] of compactEdits) {
    writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace(next, old));
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
  writeFileSync(join(app.dir, "index.ts"), current["index.ts"].replace("width < 60", "width < 61"));
  const modified = app.contents();
  expect(app.run().exitCode).not.toBe(0);
  expect(app.contents()).toEqual(modified);
});

test("changed or partial anchors refuse all writes", () => {
  for (const partial of [false, true]) {
    const app = sandbox(String(partial));
    const file = join(app.dir, "types.ts");
    writeFileSync(file, partial ? edits["types.ts"][0][1] : "unknown upstream source");
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
});

const transpiler = new Bun.Transpiler({ loader: "ts" });
const helpers = new Function("visibleWidth", "buildContentFromParts", "ansi", transpiler.transformSync(align + meter) +
  "\nreturn { buildAlignedContent, contextMeter };")(
  Bun.stringWidth,
  (parts: string[], _style: string, separator = "·") => parts.length ? " " + parts.join(separator === "" ? " " : ` ${separator} `) + " " : "",
  { getFgAnsi: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`, reset: "\x1b[0m" },
);

test("groups align by visible width without stripping gradients", () => {
  const left = "\x1b[38;2;95;168;118m模型\x1b[0m";
  const parts = [{ content: left, right: false }, { content: "20%", right: true }];
  const row = helpers.buildAlignedContent(parts, "dot", 40);
  expect(Bun.stringWidth(row)).toBe(40);
  expect(row).toContain(left);
  expect(row.endsWith("20% ")).toBe(true);
  expect(helpers.buildAlignedContent([], "dot", 0)).toBe("");
  expect(helpers.buildAlignedContent([parts[0]], "dot", 40)).toBe(` ${left} `);
  expect(Bun.stringWidth(helpers.buildAlignedContent([parts[1]], "dot", 40))).toBe(40);
  expect(Bun.stringWidth(helpers.buildAlignedContent(parts, "dot", 12))).toBe(12);
});

test("cost stays neutral while the ball and context use blue-green", () => {
  const reset = "\x1b[0m";
  const green = "\x1b[38;2;67;145;135m";
  const cost = `\x1b[38;2;133;135;126m$52.14${reset}`;
  const context = `${green}● [▰▰▰▱▱] 52% context${reset}`;
  const row = helpers.buildAlignedContent([
    { content: "model", right: false },
    { content: cost, right: true },
    { content: context, right: true },
  ], "chevron", 80);
  expect(row).toContain(`${cost} ${context}`);
  expect(Bun.stringWidth(row)).toBe(80);
});

test("context meter clamps fill and preserves unknown and approximate usage", () => {
  const meter = helpers.contextMeter;
  expect(meter(0, false)).toBe("● [▱▱▱▱▱] 0% context");
  expect(meter(20, false)).toBe("● [▰▱▱▱▱] 20% context");
  expect(meter(100, false)).toBe("● [▰▰▰▰▰] 100% context");
  expect(meter(120, true)).toBe("● [▰▰▰▰▰] ~120% context");
  expect(meter(-20, false)).toBe("● [▱▱▱▱▱] -20% context");
  expect(meter(null, false)).toBe("● [-----] ? context");
  expect(meter(NaN, false)).toBe("● [-----] ? context");
});

// Exercise checkout-patched package sources, not a second implementation of packing.
realTest("configured chevron uses the requested glyph without changing other styles", () => {
  const settings = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8"));
  expect(settings.powerline.separator).toBe("chevron");
  const text = source("index.ts");
  const start = text.indexOf("function buildContentFromParts(");
  const end = text.indexOf("\n}\n", start) + 2;
  const render = new Function("getSeparator", "getFgAnsiCode", "ansi",
    transpiler.transformSync(text.slice(start, end)) + "\nreturn buildContentFromParts;")(
    (style: string) => ({ left: style === "chevron" ? "›" : "·" }), () => "", { reset: "" },
  );
  expect(render(["model", "main"], settings.powerline.separator)).toBe(" model ❯ main ");
  expect(render(["model", "main"], "dot")).toBe(" model · main ");
});

realTest("ball and meter share the real context segment color at every threshold", () => {
  const text = source("segments.ts");
  const start = text.indexOf("// configs:powerline-meter-v1");
  const end = text.indexOf("const contextTotalSegment", start);
  const codes = {
    context: "\x1b[38;2;67;145;135m",
    contextWarn: "\x1b[38;2;95;168;118m",
    contextError: "\x1b[38;2;199;131;124m",
  };
  const segment = new Function("getIcons", "color", "withIcon", "formatTokens",
    transpiler.transformSync(text.slice(start, end)) + "\nreturn contextPctSegment;")(
    () => ({}), (_ctx: unknown, name: keyof typeof codes, text: string) => `${codes[name]}${text}\x1b[0m`,
    (_icon: string, text: string) => text, String,
  );
  for (const [percent, expected] of [[null, "context"], [52, "context"], [70, "context"],
    [71, "contextWarn"], [90, "contextWarn"], [91, "contextError"], [100, "contextError"]] as const) {
    const ctx = { options: { context: { format: "meter" } }, contextPercent: percent,
      contextTokens: percent === null ? null : 1000, contextWindow: 10000, contextApproximate: true };
    const { content, visible } = segment.render(ctx);
    expect(visible).toBe(true);
    expect(content).toStartWith(`${codes[expected]}● [`);
    expect(content).toEndWith("\x1b[0m");
    expect(content.match(/\x1b\[38;2;/g)).toHaveLength(1);
    expect(content).toContain(percent === null ? "? context" : `~${percent}% context`);
    expect(segment.render({ ...ctx, customCompactionEnabled: true }).visible).toBe(false);
  }
});

realTest("patched unstaged count uses sage without changing its label", () => {
  const count = source("segments.ts").split("\n").find(line => line.includes('`*${gitStatus.unstaged}`'))!;
  const indicators: string[] = [];
  new Function("indicators", "applyColor", "ctx", "gitStatus", count)(
    indicators, (_theme: unknown, color: string, text: string) => `${color}:${text}`, { theme: {} }, { unstaged: 3 },
  );
  expect(indicators).toEqual(["muted:*3"]);
});
realTest("patched layout preserves right alignment with a single compact row", async () => {
  const text = source("index.ts");
  const start = text.indexOf("// configs:powerline-compact-v1");
  const end = text.indexOf("// Extension\n", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const js = transpiler.transformSync(text.slice(start, end));
  const config = { separator: "dot" };
  const { truncateToWidth } = await import(`${process.env.PI_SDK_ROOT}/node_modules/@earendil-works/pi-tui/dist/index.js`);
  const compute = new Function("config", "renderSegment", "visibleWidth", "getSeparator", "getFgAnsiCode", "ansi", "mergeSegmentsWithCustomItems", "truncateToWidth",
    js + "\nreturn computeResponsiveLayout;")(
    config, (id: string) => ({ visible: id !== "hidden", content: id === "meter" ? "● meter" : id }), Bun.stringWidth,
    () => ({ left: "·" }), () => "", { reset: "" },
    () => ({ leftSegments: ["model", "branch", "hidden"], rightSegments: ["cost", "meter"], secondarySegments: ["mode"] }),
    truncateToWidth,
  );
  const wide = compute({}, {}, 80);
  expect(wide.topContent).toBe(" model · branch · mode" + " ".repeat(45) + "cost ● meter ");
  expect(Bun.stringWidth(wide.topContent)).toBe(80);
  for (const width of [0, 7, 16, 25, 40]) {
    const rows = compute({}, {}, width);
    expect(Bun.stringWidth(rows.topContent)).toBeLessThanOrEqual(width);
    expect(Bun.stringWidth(rows.secondaryContent)).toBeLessThanOrEqual(width);
  }
  expect(compute({}, {}, 16).secondaryContent).toBe("");
  expect(compute({}, {}, 16).topContent).toContain("model");
  expect(compute({}, {}, 80, 12).secondaryContent).toBe("");
  expect(compute({}, {}, 80, 30)).toEqual(wide);
});
