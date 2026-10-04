import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settings = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8"));

test("disables the selected standalone and package skills", () => {
	expect(new Set(settings.skills)).toEqual(new Set([
		"-skills/brand",
		"-skills/brief",
		"-skills/test-driven-development",
		"-skills/use-railway",
		"-skills/watch",
	]));

	const packages = settings.packages.filter((entry: unknown) => typeof entry === "object" && entry !== null);
	expect(packages.find((entry: { source: string }) => entry.source === "npm:@dietrichgebert/ponytail")?.skills).toEqual(["ponytail"]);
});
