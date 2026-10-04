import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../../rpiv-todo/config.json", import.meta.url), "utf8"));
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const guidance = [config.guidance.promptSnippet, ...config.guidance.promptGuidelines, agents].join("\n");

test("reserves todos for long-running work", () => {
	expect(guidance).not.toContain("2+ steps");
	expect(guidance).toContain("coordination across many turns");
	expect(guidance).toContain("routine inspect-edit-test-commit work");
	expect(guidance).not.toContain("blockedBy");
});
