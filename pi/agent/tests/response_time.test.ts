import { expect, spyOn, test } from "bun:test";
import responseTime, { formatDuration } from "../extensions/response_time";

function harness() {
	const handlers = new Map<string, Function>();
	const statuses = new Map<string, string>();
	const intervals = new Map<number, () => void>();
	let nextInterval = 0;
	const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number) => {
		expect(delay).toBe(1000);
		const id = ++nextInterval;
		if (typeof callback === "function") intervals.set(id, callback as () => void);
		return id as unknown as ReturnType<typeof setInterval>;
	}) as typeof setInterval);
	const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(((id: ReturnType<typeof setInterval>) => {
		intervals.delete(id as unknown as number);
	}) as typeof clearInterval);
	const ctx = { hasUI: true, ui: { setStatus(key: string, value?: string) {
		if (value === undefined) statuses.delete(key);
		else statuses.set(key, value);
	} } };
	responseTime({ on: (name: string, handler: Function) => handlers.set(name, handler) } as never);
	return {
		ctx,
		value: () => statuses.get("agent-response-time"),
		emit: (name: string, event = {}) => handlers.get(name)?.(event, ctx),
		tick: () => [...intervals.values()].forEach((callback) => callback()),
		intervalCount: () => intervals.size,
		restore: () => {
			intervalSpy.mockRestore();
			clearIntervalSpy.mockRestore();
		},
	};
}

const reply = (stopReason = "stop") => ({ message: {
	role: "assistant", stopReason, timestamp: 1,
	usage: { output: 100, input: 9000, reasoning: 60, totalTokens: 9100 },
} });

test("formats response durations compactly by unit", () => {
	expect(formatDuration(0.8)).toBe("0.8s");
	expect(formatDuration(12.4)).toBe("12s");
	expect(formatDuration(65)).toBe("1m 05s");
	expect(formatDuration(7320)).toBe("2h 02m");
	expect(formatDuration(0)).toBe("—");
	expect(formatDuration(Infinity)).toBe("—");
});

test("starts on accepted prompts, ticks every second, and keeps the latest completion", () => {
	let now = 0;
	const clock = spyOn(performance, "now").mockImplementation(() => now);
	const app = harness();
	try {
		app.emit("session_start");
		expect(app.value()).toBe("—");
		app.emit("before_agent_start");
		expect(app.value()).toBe("0.0s");
		expect(app.intervalCount()).toBe(1);
		now = 1000;
		app.tick();
		expect(app.value()).toBe("1.0s");
		app.emit("message_start", reply());
		app.emit("message_update", reply());
		app.emit("message_end", reply());
		app.emit("agent_end");
		expect(app.value()).toBe("1.0s");
		now = 2000;
		app.emit("agent_settled");
		expect(app.value()).toBe("2.0s");
		expect(app.intervalCount()).toBe(0);

		// Tool execution and the following assistant turn are part of one response.
		now = 100_000;
		app.emit("before_agent_start");
		now = 100_500;
		app.tick();
		expect(app.value()).toBe("0.5s");
		app.emit("message_end", reply("toolUse"));
		app.emit("message_end", { message: { role: "toolResult" } });
		now = 102_000;
		app.emit("message_end", reply());
		app.emit("agent_end");
		app.emit("agent_settled");
		expect(app.value()).toBe("2.0s");

		for (const reason of ["error", "aborted", "deferred", "pending"]) {
			app.emit("before_agent_start");
			now += 1000;
			app.emit("message_end", reply(reason));
			app.emit("agent_settled");
			expect(app.value()).toBe("2.0s");
		}
		app.emit("before_agent_start");
		now += 65_000;
		app.emit("message_end", reply("length"));
		app.emit("agent_settled");
		expect(app.value()).toBe("1m 05s");
		app.emit("before_agent_start");
		now += 1000;
		app.emit("message_end", reply());
		app.emit("agent_settled");
		expect(app.value()).toBe("1.0s");
	} finally {
		app.restore();
		clock.mockRestore();
	}
});

test("invalid clocks show unavailable; history and session boundaries never invent duration", () => {
	let now = 0;
	const clock = spyOn(performance, "now").mockImplementation(() => now);
	const app = harness();
	try {
		for (const elapsed of [0, -1, NaN, Infinity]) {
			now = 0;
			app.emit("before_agent_start");
			now = elapsed;
			app.emit("message_end", reply());
			app.emit("agent_settled");
			expect(app.value()).toBe("—");
		}

		now = 0;
		app.emit("before_agent_start");
		now = 1000;
		app.emit("message_end", reply());
		app.emit("agent_settled");
		expect(app.value()).toBe("1.0s");
		for (const boundary of ["session_start", "session_tree"]) {
			app.emit("before_agent_start");
			app.emit(boundary);
			now = 2000;
			app.emit("message_end", reply());
			app.emit("agent_settled");
			expect(app.value()).toBe("—");
			expect(app.intervalCount()).toBe(0);
		}
		app.emit("before_agent_start");
		app.emit("agent_end");
		now = 3000;
		app.emit("agent_settled");
		expect(app.value()).toBe("—");
		app.emit("before_agent_start");
		expect(app.intervalCount()).toBe(1);
		app.emit("session_shutdown");
		expect(app.value()).toBeUndefined();
		expect(app.intervalCount()).toBe(0);

		app.ctx.hasUI = false;
		app.ctx.ui.setStatus = () => { throw new Error("headless UI write"); };
		app.emit("session_start");
		app.emit("before_agent_start");
		now += 1000;
		app.emit("message_end", reply());
		app.emit("agent_settled");
		app.emit("session_tree");
		app.emit("session_shutdown");
	} finally {
		app.restore();
		clock.mockRestore();
	}
});
