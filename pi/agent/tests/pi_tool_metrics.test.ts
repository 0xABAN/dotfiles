import { expect } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applySdkPatches, copySdk, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const sdk = process.env.PI_SDK_ROOT;
const temp = temporaryDirectory("pi-tool-metrics-");
const { nativeTest: test } = nativeSuite(import.meta.path, !!sdk);
let loaded: Promise<any> | undefined;

function real() {
  return loaded ??= (async () => {
    const root = join(temp, "sdk");
    copySdk(sdk!, root);
    applySdkPatches(root, ["pi_horizontal_inset", "pi_transcript"]);
    const load = (path: string) => import(pathToFileURL(join(root, path)).href);
    const colors = await load("dist/modes/interactive/theme/theme.js");
    colors.setThemeInstance(colors.loadThemeFromPath(
      fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    return {
      ...await load("dist/modes/interactive/components/transcript.js"),
      ...await load("dist/core/tools/read.js"),
      ...await load("dist/core/tools/write.js"),
      ...await load("dist/core/tools/edit.js"),
      tui: await load("node_modules/@earendil-works/pi-tui/dist/index.js"),
      colors,
    };
  })();
}

function component(extra: Record<string, any> = {}): any {
  return {
    toolCallId: "read-a", toolName: "read", args: { path: "src/session.ts" },
    argsComplete: true, isPartial: false,
    result: { content: [{ type: "text", text: "file content" }], isError: false },
    ...extra,
  };
}

function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  return root;
}

test("explicit execution clocks isolate parallel same-name calls and finalize only once", async () => {
  const m = await real();
  const first = component({ toolCallId: "parallel-a", result: undefined });
  const second = component({ toolCallId: "parallel-b", result: undefined });
  m.startToolTiming(first, 0);
  m.startToolTiming(second, 200);
  expect(first.transcriptDurationMs).toBeUndefined();
  expect(second.transcriptDurationMs).toBeUndefined();

  expect(m.finishToolTiming(second, 500)).toEqual({ toolCallId: "parallel-b", toolName: "read", durationMs: 300 });
  expect(m.finishToolTiming(first, 1200)).toEqual({ toolCallId: "parallel-a", toolName: "read", durationMs: 1200 });
  expect(first.transcriptDurationMs).toBe(1200);
  expect(second.transcriptDurationMs).toBe(300);
  expect(m.finishToolTiming(first, 9000)).toBeUndefined();
  expect(first.transcriptDurationMs).toBe(1200);
});

test("streamed arguments, timestamps and historical results never manufacture timings", async () => {
  const m = await real();
  for (const call of [
    component({ argsComplete: false, result: undefined }),
    component({ executionStarted: true, isPartial: true }),
    component({ timestamp: 1000, result: { timestamp: 5000, content: [{ type: "text", text: "152 lines in 4.0s" }] } }),
  ]) {
    call.args = { path: "before.ts", content: "one\ntwo\n" };
    m.actionLines(call, 120);
    call.args = { path: "after.ts", content: "one\ntwo\nthree\n" };
    expect(m.finishToolTiming(call, 6000)).toBeUndefined();
    expect(call.transcriptDurationMs).toBeUndefined();
    const row = m.tui.stripTerminalSequences(m.actionLines(call, 120)[0]);
    expect(row).not.toMatch(/\d+(?:\.\d+)?s\b|\d+ lines\b/);
  }
});

test("collectToolTimings accepts only matching result-entry metadata", async () => {
  const m = await real();
  expect(m.TOOL_TIMING_FIELD).toBe("configsToolTiming");
  const record = { toolCallId: "a", toolName: "read", durationMs: 1200 };
  const entry = (data: any, extra = {}) => ({ type: "message", configsToolTiming: data,
    message: { role: "toolResult", toolCallId: data?.toolCallId, toolName: data?.toolName }, ...extra });
  const zero = { toolCallId: "b", toolName: "read", durationMs: 0 };
  const invalid = [
    null, undefined, {}, entry(undefined), entry(null), entry([]),
    entry(record, { type: "custom" }), entry(record, { type: "custom_message" }),
    entry(record, { configsToolTiming: undefined, unrelatedTiming: record }),
    entry(record, { message: { role: "assistant", toolCallId: "a", toolName: "read" } }),
    entry(record, { message: { role: "toolResult", toolCallId: "different", toolName: "read" } }),
    entry(record, { message: { role: "toolResult", toolCallId: "a", toolName: "edit" } }),
    entry({ ...record, toolCallId: "" }), entry({ ...record, toolCallId: 1 }),
    entry({ ...record, toolName: "" }), entry({ ...record, toolName: null }),
    ...[-1, NaN, Infinity, -Infinity, "1200", null, undefined].map(durationMs => entry({ ...record, durationMs })),
  ];
  const timings = m.collectToolTimings([entry(record), ...invalid, entry(zero)]);
  expect(timings).toBeInstanceOf(Map);
  expect([...timings.entries()]).toEqual([["a", record], ["b", zero]]);
  expect(m.collectToolTimings([]).size).toBe(0);
});

test("metrics follow short statements with one space rather than filling the row", async () => {
  const m = await real();
  for (const [toolName, args, statement, stats, suffix] of [
    ["read", { path: "README.md" }, "README.md", { lines: 152 }, "152 lines · 1.2s"],
    ["read", { path: "AGENTS.md" }, "AGENTS.md", undefined, "1.2s"],
    ["write", { path: "out.txt" }, "out.txt", { lines: 0 }, "0 lines · 1.2s"],
    ["edit", { path: "app.ts" }, "app.ts", { edits: 2 }, "2 edits · 1.2s"],
    ["bash", { command: "git status" }, "git status", undefined, "1.2s"],
    ["intercom", {}, "intercom()", undefined, "1.2s"],
  ] as const) {
    const call = component({ toolName, args, transcriptDurationMs: 1200,
      result: { isError: false, content: [], details: { configsTranscript: stats } } });
    for (const width of [70, 120, 200]) {
      const row = m.tui.stripTerminalSequences(m.actionLines(call, width)[0]);
      expect(row.endsWith(`${statement} ${suffix}`), row).toBe(true);
      expect(m.tui.visibleWidth(row)).toBeLessThan(width);
    }
  }
});

test("metrics retain room when truncating Unicode and unsafe targets", async () => {
  const m = await real();
  const call = component({
    args: { path: "界🙂/\x1b[31mcolored\x1b[0m\x1b]0;injected-title\x07\n\t" + "long-path/".repeat(20) },
    transcriptDurationMs: 1200,
    result: { isError: false, content: [], details: { configsTranscript: { lines: 152 } } },
  });
  const wide = m.actionLines(call, 120);
  for (const width of [120, 70, 40, 24, 20, 12, 8, 4, 1]) {
    const rows = m.actionLines(call, width);
    expect(rows).toHaveLength(1);
    expect(m.tui.visibleWidth(rows[0])).toBeLessThanOrEqual(width);
    const plain = m.tui.stripTerminalSequences(rows[0]);
    expect(plain.startsWith("✓"), `success status at width ${width}: ${plain}`).toBe(true);
    expect(plain).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(rows[0]).not.toContain("injected-title");
    expect(rows[0]).not.toContain("\x1b[31m");
    if (width >= 8) expect(plain.endsWith("1.2s")).toBe(true);
    if (width >= 70) {
      expect(plain.endsWith("152 lines · 1.2s")).toBe(true);
      expect(rows[0]).toContain(m.colors.theme.fg("muted", "152 lines · 1.2s"));
    }
    if (width === 24 || width === 20) expect(plain.endsWith("152L 1.2s")).toBe(true);
    if (width === 12 || width === 8) expect(plain).not.toContain("152");
  }
  expect(m.actionLines(call, 120)).toEqual(wide);
  expect(call.transcriptDurationMs).toBe(1200);

  // Rendering receives the inset viewport width, not the terminal's global width.
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  try {
    Object.defineProperty(process.stdout, "columns", { configurable: true, get() { throw new Error("terminal-global width read"); } });
    expect(m.actionLines(call, 120)).toEqual(wide);
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    else Reflect.deleteProperty(process.stdout, "columns");
  }
});

test("tiny rows drop decoration before a duration that fits beside status", async () => {
  const m = await real();
  for (const isError of [false, true]) {
    for (const [durationMs, duration] of [[1200, "1.2s"], [20, "<0.1s"]] as const) {
      const call = component({ transcriptDurationMs: durationMs,
        result: { isError, content: [], details: { configsTranscript: { lines: 152 } } } });
      for (const width of [6, 7, 8, 9]) {
        const row = m.tui.stripTerminalSequences(m.actionLines(call, width)[0]);
        expect(row.startsWith(isError ? "×" : "✓")).toBe(true);
        expect(m.tui.visibleWidth(row)).toBeLessThanOrEqual(width);
        if (duration.length + 2 <= width) {
          expect(row.endsWith(duration)).toBe(true);
          expect(m.tui.visibleWidth(row)).toBe(width);
        }
      }
    }
  }
});

test("duration formatting covers zero and sub-100ms; read, write and edit counts abbreviate", async () => {
  const m = await real();
  for (const [durationMs, suffix] of [[0, "<0.1s"], [99, "<0.1s"], [100, "0.1s"], [1200, "1.2s"]] as const) {
    const row = m.actionLines(component({ transcriptDurationMs: durationMs }), 70)[0];
    expect(m.tui.stripTerminalSequences(row).endsWith(`src/session.ts ${suffix}`)).toBe(true);
    expect(m.tui.visibleWidth(row)).toBeLessThan(70);
  }
  for (const [toolName, stats, full, compact] of [
    ["read", { lines: 152 }, "152 lines", "152L"],
    ["write", { lines: 0 }, "0 lines", "0L"],
    ["edit", { edits: 2 }, "2 edits", "2ed"],
  ] as const) {
    const call = component({ toolName, transcriptDurationMs: 1200,
      result: { isError: false, content: [], details: { configsTranscript: stats } } });
    expect(m.tui.stripTerminalSequences(m.actionLines(call, 120)[0]).endsWith(`${full} · 1.2s`)).toBe(true);
    expect(m.tui.stripTerminalSequences(m.actionLines(call, 20)[0]).endsWith(`${compact} 1.2s`)).toBe(true);
    delete call.transcriptDurationMs;
    expect(m.tui.stripTerminalSequences(m.actionLines(call, 120)[0]).endsWith(full)).toBe(true);
  }
});

test("counts require valid final success metadata; completed errors retain timing and detail", async () => {
  const m = await real();
  for (const stats of [undefined, null, {}, { lines: -1 }, { lines: 1.5 }, { lines: Infinity }, { lines: NaN }, { lines: "152" }, { edits: 2 }]) {
    const call = component({ transcriptDurationMs: 1200,
      result: { isError: false, content: [{ type: "text", text: "152 lines returned" }], details: { configsTranscript: stats } } });
    const row = m.tui.stripTerminalSequences(m.actionLines(call, 120)[0]);
    expect(row.endsWith("1.2s")).toBe(true);
    expect(row).not.toMatch(/\d+ (?:lines|edits)\b|NaN|Infinity/);
  }
  for (const durationMs of [-1, NaN, Infinity, "1200", null]) {
    const row = m.tui.stripTerminalSequences(m.actionLines(component({ transcriptDurationMs: durationMs }), 120)[0]);
    expect(row).not.toMatch(/\d+(?:\.\d+)?s\b|NaN|Infinity/);
  }
  for (const toolName of ["grep", "find", "custom_search"]) {
    const call = component({ toolName, transcriptDurationMs: 1200,
      result: { isError: false, content: [], details: { configsTranscript: { lines: 152, edits: 2 } } } });
    const row = m.tui.stripTerminalSequences(m.actionLines(call, 120)[0]);
    expect(row.endsWith("1.2s")).toBe(true);
    expect(row).not.toMatch(/\d+ (?:lines|edits)\b/);
  }
  const partial = component({ isPartial: true, executionStarted: true, transcriptDurationMs: 1200,
    result: { isError: false, content: [], details: { configsTranscript: { lines: 152 } } } });
  const partialRow = m.tui.stripTerminalSequences(m.actionLines(partial, 120)[0]);
  expect(partialRow).not.toContain("152");
  expect(partialRow).not.toContain("1.2s");

  const failed = component({ transcriptDurationMs: 1200,
    result: { isError: true, content: [{ type: "text", text: "Permission denied\nNative detail" }],
      details: { configsTranscript: { lines: 152 } } } });
  for (const width of [120, 70, 40, 24, 20, 12, 8, 4, 1]) {
    const rows = m.actionLines(failed, width);
    expect(rows).toHaveLength(2);
    expect(rows.every((row: string) => m.tui.visibleWidth(row) <= width)).toBe(true);
    const plain = rows.map(m.tui.stripTerminalSequences);
    expect(plain[0].startsWith("×"), `error status at width ${width}: ${plain[0]}`).toBe(true);
    expect(plain[0]).not.toContain("152");
    if (width >= 8) expect(plain[0].endsWith("1.2s")).toBe(true);
    if (width >= 20) expect(plain[1]).toContain("Permission denied");
  }
});

test("native read counts returned lines, excluding continuation notices and final newline", async () => {
  const m = await real();
  const root = sandbox("read-lines");
  const read = m.createReadToolDefinition(root);
  for (const [name, text, lines] of [
    ["empty", "", 0], ["single", "界🙂", 1], ["terminated", "one\ntwo\n", 2],
    ["blank", "\n", 1], ["blank-tail", "one\n\n", 2], ["crlf", "one\r\ntwo\r\n", 2],
  ] as const) {
    writeFileSync(join(root, name), text);
    const result = await read.execute(name, { path: name });
    expect(result.content).toEqual([{ type: "text", text }]);
    expect(result.details, name).toEqual({ configsTranscript: { lines } });
  }
  writeFileSync(join(root, "limited"), "one\ntwo\nthree\nfour\nfive");
  const limited = await read.execute("limited", { path: "limited", offset: 2, limit: 2 });
  expect(limited.content).toEqual([{ type: "text", text: "two\nthree\n\n[2 more lines in file. Use offset=4 to continue.]" }]);
  expect(limited.details).toEqual({ configsTranscript: { lines: 2 } });
});

test("native read preserves truncation details and counts only file lines actually returned", async () => {
  const m = await real();
  const root = sandbox("read-truncation");
  const read = m.createReadToolDefinition(root);
  for (const [name, text, lines, reason, returned] of [
    ["line-limit", Array.from({ length: 2001 }, (_, i) => `line ${i + 1}`).join("\n"), 2000, "lines",
      Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n")],
    ["byte-limit", Array(6).fill("x".repeat(10000)).join("\n"), 5, "bytes", Array(5).fill("x".repeat(10000)).join("\n")],
    ["oversized-line", "界".repeat(20000), 0, "bytes", ""],
  ] as const) {
    writeFileSync(join(root, name), text);
    const result = await read.execute(name, { path: name });
    expect(result.details.configsTranscript).toEqual({ lines });
    expect(Object.keys(result.details).sort()).toEqual(["configsTranscript", "truncation"]);
    expect(result.details.truncation).toMatchObject({
      truncated: true, truncatedBy: reason, outputLines: lines, content: returned,
      totalBytes: Buffer.byteLength(text), outputBytes: Buffer.byteLength(returned),
      firstLineExceedsLimit: lines === 0, maxBytes: 51200, maxLines: 2000,
    });
    if (lines > 0) {
      expect(result.content[0].text.startsWith(returned + "\n\n[Showing lines ")).toBe(true);
      expect(result.content[0].text).toContain(`Use offset=${lines + 1} to continue.`);
    } else {
      expect(result.content[0].text).toContain("exceeds 50.0KB limit");
    }
  }
});

test("native image reads never report text-note line counts", async () => {
  const m = await real();
  const root = sandbox("read-image");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
  writeFileSync(join(root, "pixel.png"), Buffer.from(png, "base64"));
  const result = await m.createReadToolDefinition(root, { autoResizeImages: false }).execute("image", { path: "pixel.png" });
  expect(result.content.some((part: any) => part.type === "image")).toBe(true);
  expect(result.content[0].text).toContain("Read image file [image/png]");
  expect(result.details?.configsTranscript?.lines).toBeUndefined();
});

test("native write reports written Unicode/newline counts without changing text or file bytes", async () => {
  const m = await real();
  const root = sandbox("write-lines");
  const write = m.createWriteToolDefinition(root);
  for (const [content, lines] of [["", 0], ["界🙂", 1], ["界🙂\nsecond\n", 2], ["\n", 1], ["one\n\n", 2], ["one\r\ntwo\r\n", 2]] as const) {
    const path = "nested/output.txt";
    const result = await write.execute("write", { path, content });
    expect(readFileSync(join(root, path), "utf8")).toBe(content);
    // Preserve 0.85.1's success text; line counts belong only in UI metadata.
    expect(result.content).toEqual([{ type: "text", text: `Successfully wrote to ${path}` }]);
    expect(result.details).toEqual({ configsTranscript: { lines } });
  }
});

test("native edit counts successful disjoint blocks, preserving diffs and atomic failure", async () => {
  const m = await real();
  const root = sandbox("edit-blocks");
  const edit = m.createEditToolDefinition(root);
  const path = "source.txt";
  writeFileSync(join(root, path), "alpha\nkeep\nomega\n");
  const result = await edit.execute("edit", { path, edits: [
    { oldText: "alpha", newText: "first" }, { oldText: "omega", newText: "last" },
  ] });
  expect(readFileSync(join(root, path), "utf8")).toBe("first\nkeep\nlast\n");
  expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 2 block(s) in source.txt." }]);
  expect(result.details.configsTranscript).toEqual({ edits: 2 });
  expect(Object.keys(result.details).sort()).toEqual(["configsTranscript", "diff", "firstChangedLine", "patch"]);
  expect(result.details.firstChangedLine).toBe(1);
  expect(result.details.diff).toContain("alpha");
  expect(result.details.diff).toContain("last");
  expect(result.details.patch).toContain("-alpha");
  expect(result.details.patch).toContain("+first");
  expect(result.details.patch).toContain("-omega");
  expect(result.details.patch).toContain("+last");

  const failure = await edit.execute("failed-edit", { path, edits: [
    { oldText: "first", newText: "must not write" }, { oldText: "missing", newText: "no match" },
  ] }).then(() => { throw new Error("Edit unexpectedly succeeded"); }, (error: any) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.details?.configsTranscript).toBeUndefined();
  expect(readFileSync(join(root, path), "utf8")).toBe("first\nkeep\nlast\n");
});
