import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";

const temp = temporaryDirectory("patch-fixtures-");

test("patch descriptors resolve sibling helpers without importing from the test working directory", () => {
  const directory = join(temp, "patches");
  mkdirSync(directory);
  writeFileSync(join(directory, "fixture_helper.py"), "VALUE = 'sibling helper'\n");
  const patcher = join(directory, "patch.py");
  writeFileSync(patcher, "from fixture_helper import VALUE\n");
  expect(describePatch(patcher, "m['VALUE']")).toBe("sibling helper");
});

test("SDK fixtures own patched host and TUI files while linking only read-only dependencies", () => {
  const source = join(temp, "source");
  const fixture = join(temp, "fixture");
  const tui = "node_modules/@earendil-works/pi-tui";
  for (const directory of ["dist", tui + "/dist", tui + "/node_modules", "node_modules/other"]) {
    mkdirSync(join(source, directory), { recursive: true });
  }
  writeFileSync(join(source, "package.json"), '{"type":"module","version":"0.84.2"}');
  writeFileSync(join(source, "dist/host.js"), "original host");
  writeFileSync(join(source, tui, "dist/tui.js"), "original TUI");
  writeFileSync(join(source, "node_modules/other/index.js"), "dependency");

  copySdk(source, fixture);
  writeFileSync(join(fixture, "dist/host.js"), "patched host");
  writeFileSync(join(fixture, tui, "dist/tui.js"), "patched TUI");
  expect(readFileSync(join(source, "dist/host.js"), "utf8")).toBe("original host");
  expect(readFileSync(join(source, tui, "dist/tui.js"), "utf8")).toBe("original TUI");
  expect(realpathSync(join(fixture, "node_modules/other"))).toBe(realpathSync(join(source, "node_modules/other")));
});
