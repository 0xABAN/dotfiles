import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const patcher = fileURLToPath(new URL("../patches/pi_markdown_code.py", import.meta.url));
const {
  MARKDOWN,
  THEME,
  EDITS,
  LEGACY_MARKER_DECL,
  LEGACY_CODE_CASE,
  LEGACY_CODE_CASE_WITH_PADDING,
  LEGACY_WRAP,
  LEGACY_CONTENT,
  LEGACY_ROUNDED_CONTENT,
  LEGACY_CONTAINED_CONTENT,
  LEGACY_OUTLINED_CONTENT,
  LEGACY_THEME,
  LEGACY_FORCED_DIM_THEME,
} = describePatch<{
  MARKDOWN: string;
  THEME: string;
  EDITS: Record<string, [string, string][]>;
  LEGACY_MARKER_DECL: string;
  LEGACY_CODE_CASE: string;
  LEGACY_CODE_CASE_WITH_PADDING: string;
  LEGACY_WRAP: string;
  LEGACY_CONTENT: string;
  LEGACY_ROUNDED_CONTENT: string;
  LEGACY_CONTAINED_CONTENT: string;
  LEGACY_OUTLINED_CONTENT: string;
  LEGACY_THEME: string;
  LEGACY_FORCED_DIM_THEME: string;
}>(patcher, "{'MARKDOWN':m['MARKDOWN'],'THEME':m['THEME'],'EDITS':m['EDITS'],'LEGACY_MARKER_DECL':m['LEGACY_MARKER_DECL'],'LEGACY_CODE_CASE':m['LEGACY_CODE_CASE'],'LEGACY_CODE_CASE_WITH_PADDING':m['LEGACY_CODE_CASE_WITH_PADDING'],'LEGACY_WRAP':m['LEGACY_WRAP'],'LEGACY_CONTENT':m['LEGACY_CONTENT'],'LEGACY_ROUNDED_CONTENT':m['LEGACY_ROUNDED_CONTENT'],'LEGACY_CONTAINED_CONTENT':m['LEGACY_CONTAINED_CONTENT'],'LEGACY_OUTLINED_CONTENT':m['LEGACY_OUTLINED_CONTENT'],'LEGACY_THEME':m['LEGACY_THEME'],'LEGACY_FORCED_DIM_THEME':m['LEGACY_FORCED_DIM_THEME']}");
const temp = temporaryDirectory("pi-markdown-code-");
const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk && existsSync(join(sdk!, "node_modules/@earendil-works/pi-tui")));

function run(root: string) {
  return Bun.spawnSync(["python3", "-B", patcher], {
    env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
  });
}

function contents(root: string) {
  return Object.fromEntries(Object.keys(EDITS).map((name) => [name, readFileSync(join(root, name), "utf8")]));
}

function fixture(name: string) {
  if (!sdk) throw new Error("PI_SDK_ROOT is required");
  const root = join(temp, name);
  copySdk(sdk, root);
  for (const [name, edits] of Object.entries(EDITS)) {
    const path = join(root, name);
    let source = readFileSync(path, "utf8");
    for (const [old, next] of edits) source = source.replace(next, old);
    if (name === MARKDOWN) {
      source = source
        .replace(LEGACY_MARKER_DECL, edits[0]![0]!)
        .replace(LEGACY_CODE_CASE_WITH_PADDING, edits[1]![0]!)
        .replace(LEGACY_CODE_CASE, edits[1]![0]!)
        .replace(LEGACY_WRAP, edits[2]![0]!)
        .replace(LEGACY_CONTENT, edits[3]![0]!)
        .replace(LEGACY_ROUNDED_CONTENT, edits[3]![0]!)
        .replace(LEGACY_CONTAINED_CONTENT, edits[3]![0]!)
        .replace(LEGACY_OUTLINED_CONTENT, edits[3]![0]!);
    } else if (name === THEME) {
      source = source
        .replace(LEGACY_THEME, edits[0]![0]!)
        .replace(LEGACY_FORCED_DIM_THEME, edits[0]![0]!);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}

test("patches native Markdown code panels idempotently", () => {
  const root = fixture("valid");
  const before = contents(root);
  expect(run(root).exitCode).toBe(0);
  const after = contents(root);
  expect(after[MARKDOWN]).toContain("CODE_BLOCK_MARKER");
  expect(after[MARKDOWN]).toContain("codeBlockBgFn");
  expect(after[MARKDOWN]).not.toContain("codeBlockBorderFn");
  expect(after[THEME]).toContain('codeBlockBackground: (text) => theme.bg("userMessageBg", text)');
  expect(readdirSync(join(root, ".config/theme-backups"))).toHaveLength(1);
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)).toEqual(after);
  expect(before[MARKDOWN]).not.toBe(after[MARKDOWN]);
});

test("migrates both prior code panel layouts", () => {
  for (const [name, legacyCase] of [["legacy-no-padding", LEGACY_CODE_CASE], ["legacy-with-padding", LEGACY_CODE_CASE_WITH_PADDING]] as const) {
    const root = fixture(name);
    for (const [file, edits] of Object.entries(EDITS)) {
      const path = join(root, file);
      let source = readFileSync(path, "utf8");
      for (const [index, [old, next]] of edits.entries()) {
        const legacy = file === MARKDOWN
          ? index === 0 ? LEGACY_MARKER_DECL
            : index === 1 ? legacyCase
              : index === 2 ? LEGACY_WRAP
                : index === 3 ? LEGACY_CONTENT : next
          : file === THEME ? LEGACY_THEME : next;
        source = source.replace(old, legacy);
      }
      writeFileSync(path, source);
    }
    expect(run(root).exitCode).toBe(0);
    expect(contents(root)[MARKDOWN]).toContain('lines.push(renderCodeBorder("T"));');
    expect(readdirSync(join(root, ".config/theme-backups"))).toHaveLength(1);
  }
});

test("migrates the prior rounded panel background", () => {
  const root = fixture("legacy-rounded");
  for (const [file, edits] of Object.entries(EDITS)) {
    const path = join(root, file);
    let source = readFileSync(path, "utf8");
    for (const [index, [old, next]] of edits.entries()) {
      const legacy = file === MARKDOWN
        ? index === 3 ? LEGACY_ROUNDED_CONTENT : next
        : file === THEME ? LEGACY_THEME : next;
      source = source.replace(old, legacy);
    }
    writeFileSync(path, source);
  }
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[THEME]).toContain('codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text)');
  expect(contents(root)[MARKDOWN]).toContain("if (codeBlockMarker && codeBlockBgFn)");
});

test("migrates the prior contained panel and forced border", () => {
  const root = fixture("legacy-contained");
  const markdownPath = join(root, MARKDOWN);
  const themePath = join(root, THEME);
  writeFileSync(markdownPath, readFileSync(markdownPath, "utf8").replace(EDITS[MARKDOWN]![3]![1]!, LEGACY_CONTAINED_CONTENT));
  writeFileSync(themePath, readFileSync(themePath, "utf8").replace(EDITS[THEME]![0]![1]!, LEGACY_FORCED_DIM_THEME));
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[MARKDOWN]).toContain("if (codeBlockMarker && codeBlockBgFn)");
  expect(contents(root)[MARKDOWN]).not.toContain("const panelContent = lineWithoutMarker");
  expect(contents(root)[THEME]).toContain('codeBlockBackground: (text) => theme.bg("userMessageBg", text)');
});

test("migrates the prior outlined panel", () => {
  const root = fixture("legacy-outlined");
  const path = join(root, MARKDOWN);
  writeFileSync(path, readFileSync(path, "utf8").replace(EDITS[MARKDOWN]![3]![1]!, LEGACY_OUTLINED_CONTENT));
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[MARKDOWN]).toContain("if (codeBlockMarker && codeBlockBgFn)");
  expect(contents(root)[MARKDOWN]).not.toContain("codeBlockBorderFn");
});

test("rejects partial Markdown code patches without writing", () => {
  const root = fixture("partial");
  const path = join(root, MARKDOWN);
  const [old, next] = EDITS[MARKDOWN]![0]!;
  writeFileSync(path, readFileSync(path, "utf8").replace(old, next));
  const before = contents(root);
  expect(run(root).exitCode).not.toBe(0);
  expect(contents(root)).toEqual(before);
});

realTest("native Markdown hides fences and adds padded code rows", async () => {
  const root = fixture("real");
  expect(run(root).exitCode).toBe(0);
  const { Markdown, stripTerminalSequences, visibleWidth } = await import(
    pathToFileURL(join(root, "node_modules/@earendil-works/pi-tui/dist/index.js")).href,
  );
  const syntax = "\x1b[38;2;95;168;118m";
  const border = "\x1b[38;2;68;71;77m";
  const background = "\x1b[48;2;24;26;32m";
  const theme = {
    heading: (text: string) => text,
    link: (text: string) => text,
    linkUrl: (text: string) => text,
    code: (text: string) => text,
    codeBlock: (text: string) => text,
    codeBlockBorder: (text: string) => `${border}${text}\x1b[39m`,
    codeBlockBackground: (text: string) => `${background}${text}\x1b[49m`,
    quote: (text: string) => text,
    quoteBorder: (text: string) => text,
    hr: (text: string) => text,
    listBullet: (text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
    underline: (text: string) => text,
    highlightCode: (code: string) => code.split("\n").map((line) => `${syntax}${line}\x1b[39m`),
  };
  const lines = new Markdown("```ts\nconst value = 42;\n\n```", 1, 0, theme).render(40);
  const codeLines = lines.filter((line: string) => line.includes(background));
  const plainCodeLines = codeLines.map((line: string) => stripTerminalSequences(line));
  expect(lines.join("\n")).not.toContain("```");
  expect(lines.join("\n")).not.toContain("ts");
  expect(codeLines).toHaveLength(4);
  expect(codeLines.every((line: string) => visibleWidth(line) === 40)).toBe(true);
  expect(codeLines.every((line: string) => !line.includes(border))).toBe(true);
  expect(plainCodeLines[0]).toBe(" ".repeat(40));
  expect(plainCodeLines[3]).toBe(" ".repeat(40));
  expect(plainCodeLines[1]).toContain("const value = 42;");
  expect(codeLines[1]).toContain(syntax);
  expect(codeLines[0].indexOf(background)).toBe(0);

  const wrapped = new Markdown("```ts\nconst " + "x".repeat(80) + "\n```", 0, 0, theme).render(40);
  const wrappedCodeLines = wrapped.filter((line: string) => line.includes(background));
  expect(wrappedCodeLines.length).toBeGreaterThan(2);
  expect(wrappedCodeLines.every((line: string) => visibleWidth(line) === 40)).toBe(true);
  expect(wrappedCodeLines.every((line: string) => !line.includes(border))).toBe(true);
});
