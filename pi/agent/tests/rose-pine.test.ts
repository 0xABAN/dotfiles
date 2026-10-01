import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import rose from "../themes/rose-pine.json";
import osaka from "../themes/osaka-jade.json";
import footer from "../extensions/powerline-footer/theme.json";
import { formatPlanStatus } from "../extensions/plan-mode/status";
import { nativeSuite } from "./support/native-suite";

const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest } = nativeSuite(import.meta.path, !!sdk);
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

const resolve = (theme: { vars: Record<string, string>; colors: Record<string, string> }, role: string) =>
  theme.vars[theme.colors[role]] ?? theme.colors[role];

test("Rosé Pine preserves transparent surfaces and uses readable punctuation", () => {
  expect(rose.vars.base).toBe("#191724");
  expect(resolve(rose, "accent")).toBe("#ebbcba");
  expect(resolve(rose, "syntaxPunctuation")).toBe("#908caa");
  expect(resolve(rose, "borderMuted")).toBe("#6e6a86");
  for (const role of ["customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]) {
    expect(resolve(rose, role)).toBe("");
  }
});

test("footer roles preserve Osaka Jade colors while following Rosé Pine", () => {
  const oldColors = ["#D8DAD8", "#5FA876", "#dedec5", "#dedec5", "#dedec5", "#62656a", "#85877e",
    "#439187", "#439187", "#439187", "#5FA876", "#c7837c", "#85877e", "#85877e", "#439187", "#62656a", "#326d65"];
  expect(Object.values(footer.colors).map(role => resolve(osaka, role))).toEqual(oldColors);
  expect(resolve(rose, footer.colors.context)).toBe(rose.vars.rose);
  expect(resolve(rose, footer.colors.model)).toBe(rose.vars.text);
  expect(Object.values(footer.colors).every(role => role in rose.colors)).toBe(true);
});

test("mode gradients use the selected palette without changing labels or the legacy theme", () => {
  for (const enabled of [false, true]) {
    const legacy = formatPlanStatus(enabled, "medium");
    const themed = formatPlanStatus(enabled, "medium", "rose-pine");
    expect(plain(themed.mode)).toBe(plain(legacy.mode));
    expect(plain(themed.thinking)).toBe("think:med");
    expect(themed.mode).toStartWith("\x1b[38;2;224;222;244m");
    expect(themed.mode).toEndWith("\x1b[38;2;235;188;186me\x1b[0m");
    expect(formatPlanStatus(enabled, "medium", "osaka-jade")).toEqual(legacy);
  }
});

nativeTest("both themes validate against Pi 0.87.1 and supply every footer role", async () => {
  const colors = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/theme/theme.js")).href);
  const { validateThemeJson } = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/theme/theme-json.js")).href);
  for (const name of ["rose-pine", "osaka-jade"]) {
    const path = fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url));
    validateThemeJson(name, JSON.parse(readFileSync(path, "utf8")));
    const theme = colors.loadThemeFromPath(path, "truecolor");
    for (const role of Object.values(footer.colors)) {
      expect(plain(theme.fg(role, "footer"))).toBe("footer");
    }
  }
});
