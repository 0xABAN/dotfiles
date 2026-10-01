import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import theme from "../themes/everforest-dark-medium.json";
import hard from "../themes/everforest-dark-hard.json";
import { formatPlanStatus } from "../extensions/plan-mode/status";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("the imported terminal and Pi themes use the same Dark Medium palette", () => {
  const terminal = readFileSync(new URL("../../../ghostty/themes/everforest-dark-medium", import.meta.url), "utf8");
  const values = Object.fromEntries(terminal.split("\n").filter(line => line.includes(" = "))
    .map(line => line.split(" = ")));
  const normalize = (color: string) => color.replace("#", "").toLowerCase();
  expect(theme.name).toBe("everforest-dark-medium");
  expect(theme.vars.bg0).toBe("#2D353B");
  for (const [terminalRole, color] of Object.entries({
    background: theme.vars.bg0,
    foreground: theme.vars.fg,
    "cursor-color": theme.vars.fg,
    "selection-background": theme.vars.bg_visual,
    "selection-foreground": theme.vars.fg,
  })) {
    expect(normalize(values[terminalRole])).toBe(normalize(color));
  }
  for (const [index, color] of [theme.vars.red, theme.vars.green, theme.vars.yellow,
    theme.vars.blue, theme.vars.purple, theme.vars.aqua].entries()) {
    expect(terminal).toContain(`palette = ${index + 1}=${color}`);
    expect(terminal).toContain(`palette = ${index + 9}=${color}`);
  }
});

test("Hard uses darker surfaces without changing semantic color roles", () => {
  expect(hard.vars.bg0).toBe("#272E33");
  expect(hard.vars.bg_dim).toBe("#1E2326");
  expect(hard.vars.bg_visual).toBe("#4C3743");
  expect(hard.colors).toEqual(theme.colors);
});

test.each([theme, hard])("$name mode gradients reuse the palette without altering labels", (theme) => {
  for (const enabled of [false, true]) {
    const status = formatPlanStatus(enabled, "medium", theme.name);
    expect(plain(status.mode)).toBe(plain(formatPlanStatus(enabled, "medium").mode));
    expect(plain(status.thinking)).toBe("think:med");
    const colors = [...status.thinking.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map(match => match[1]);
    expect(colors[0]).toBe("211;198;170");
    expect(colors[4]).toBe(enabled ? "214;153;182" : "167;192;128");
    expect(colors.at(-1)).toBe("219;188;127");
  }
});
