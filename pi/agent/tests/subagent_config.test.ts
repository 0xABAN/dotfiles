import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("loads Oracle and Worker", () => {
	for (const name of ["oracle", "worker"]) {
		const agent = read(`agents/${name}.md`);
		expect(agent).toContain(`name: ${name}`);
		expect(agent).toContain("prompt_mode: append");
		expect(agent).toContain("inherit_context: true");
		expect(agent).toContain("extensions: false");
		expect(agent).toContain("skills: false");
		for (const unsupported of ["aliases:", "systemPromptMode:", "inheritProjectContext:", "inheritSkills:", "defaultContext:", "defaultReads:", "defaultProgress:"]) {
			expect(agent).not.toContain(unsupported);
		}
	}

	const description = read("agent-tool-description.md");
	expect(description).toContain("oracle —");
	expect(description).toContain("worker —");
	expect(description).not.toContain("no worker/delegate/oracle types");
	expect(read("agents/LICENSE.nicobailon_pi_subagents")).toContain("Copyright (c) 2026 Nico Bailon");
});
