import { expect, test } from "bun:test";

test("injects the Angular commit policy once per active session", async () => {
	const extension = await import("../extensions/commit_policy");

	const handlers = new Map<string, Function>();
	const entries: unknown[] = [];
	const messages: Array<{ customType: string; content: string; display: boolean }> = [];
	extension.default({
		on(event: string, handler: Function) {
			handlers.set(event, handler);
		},
		sendMessage(message: (typeof messages)[number]) {
			messages.push(message);
			entries.push({ type: "custom_message", ...message });
		},
	} as never);

	const sessionStart = handlers.get("session_start");
	expect(sessionStart).toBeDefined();
	const context = { sessionManager: { buildContextEntries: () => entries } };
	await sessionStart!({}, context);
	await sessionStart!({}, context);

	expect(messages).toHaveLength(1);
	const message = messages[0]!;
	expect(message.customType).toBe("commit-policy");
	expect(message.display).toBe(false);
	expect(message.content).toContain("do not wait for the user to ask");
	expect(message.content).toContain("<type>(<optional scope>): <summary>");
	expect(message.content).toContain("build, chore, ci, docs, feat, fix, perf, refactor, test");
	expect(message.content).toContain("imperative, present tense");
	expect(message.content).toContain("feat(auth): add passkey sign-in");
	expect(message.content).toContain("fix(router): preserve query params on redirect");
	expect(message.content).toContain("docs: explain autonomous commit boundaries");
	expect(message.content.match(/^  (?:feat|fix|docs)(?:\([^)]*\))?:/gm)).toHaveLength(3);
	expect(message.content).toContain("never use `git add .`, `git add -A`, or `git commit -a`");
});
