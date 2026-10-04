import { expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySdkPatches, copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const patcher = fileURLToPath(new URL("../patches/pi_editor_gap.py", import.meta.url));
const {
  HOST,
  SOURCE,
  LEGACY_SOURCE,
  EDITOR_ORIGINAL,
  WIDGET_ORIGINAL,
  MARKER,
  LEGACY_MARKER,
} = describePatch<{
  HOST: string;
  SOURCE: string;
  LEGACY_SOURCE: string;
  EDITOR_ORIGINAL: string;
  WIDGET_ORIGINAL: string;
  MARKER: string;
  LEGACY_MARKER: string;
}>(
  patcher,
  "{'HOST':m['HOST'],'SOURCE':m['SOURCE'],'LEGACY_SOURCE':m['LEGACY_SOURCE'],'EDITOR_ORIGINAL':m['EDITOR_ORIGINAL'],'WIDGET_ORIGINAL':m['WIDGET_ORIGINAL'],'MARKER':m['MARKER'],'LEGACY_MARKER':m['LEGACY_MARKER']}",
);
const sdk = process.env.PI_SDK_ROOT;
const temp = temporaryDirectory("pi-editor-gap-");
const { nativeTest: test } = nativeSuite(import.meta.path, !!sdk);

function run(root: string) {
  return Bun.spawnSync(["python3", "-B", patcher], {
    env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
  });
}

function fixture(name: string, legacy = false) {
  if (!sdk) throw new Error("PI_SDK_ROOT is required");
  const root = join(temp, name);
  copySdk(sdk, root);
  applySdkPatches(root, ["pi_compact_layout"]);
  const path = join(root, HOST);
  let source = readFileSync(path, "utf8");
  source = source.replace(SOURCE, WIDGET_ORIGINAL).replace(LEGACY_SOURCE, EDITOR_ORIGINAL);
  if (legacy) source = source.replace(EDITOR_ORIGINAL, LEGACY_SOURCE);
  writeFileSync(path, source);
  return root;
}

test("adds one idle separator and suppresses it during compaction", () => {
  const root = fixture("valid");
  expect(run(root).exitCode).toBe(0);
  const patched = readFileSync(join(root, HOST), "utf8");
  expect(patched).toContain(MARKER);
  expect(patched).toContain("spacerWhenEmpty && !this.session.isCompacting");
  expect(patched).not.toContain(LEGACY_MARKER);
  expect(run(root).exitCode).toBe(0);
  expect(readFileSync(join(root, HOST), "utf8")).toBe(patched);
});

test("migrates the previous editor-render patch", () => {
  const root = fixture("legacy", true);
  expect(run(root).exitCode).toBe(0);
  const patched = readFileSync(join(root, HOST), "utf8");
  expect(patched).toContain(MARKER);
  expect(patched).not.toContain(LEGACY_MARKER);
  expect(patched).toContain(EDITOR_ORIGINAL);
});

test("rejects a partial editor gap patch", () => {
  const root = fixture("partial");
  const path = join(root, HOST);
  writeFileSync(path, readFileSync(path, "utf8").replace(WIDGET_ORIGINAL, WIDGET_ORIGINAL + "\n" + MARKER));
  const before = readFileSync(path, "utf8");
  expect(run(root).exitCode).not.toBe(0);
  expect(readFileSync(path, "utf8")).toBe(before);
});
