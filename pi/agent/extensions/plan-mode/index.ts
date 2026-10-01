/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Shift+Tab to toggle
 * - Bash restricted to allowlisted read-only commands
 * - On execute: remind to seed an rpiv-todo list (no hard gate)
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { extractPlanSteps, isSafeCommand } from "./utils.ts";
import { formatPlanStatus } from "./status.ts";

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeState {
	enabled: boolean;
	toolsBeforePlanMode?: string[];
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		const status = formatPlanStatus(planModeEnabled, ctx.thinkingLevel, ctx.ui.theme?.name);
		ctx.ui.setStatus("agent-mode", status.mode);
		ctx.ui.setStatus("agent-thinking", status.thinking);
	}

	function withTodo(toolNames: string[]): string[] {
		// keep rpiv-todo's tool available across mode switches
		return [...new Set([...toolNames, "todo"])];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return withTodo([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return withTodo([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(withTodo(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools())));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			toolsBeforePlanMode,
		});
	}

	function setPlanMode(enabled: boolean, ctx: ExtensionContext): void {
		planModeEnabled = enabled;

		if (planModeEnabled) {
			enablePlanModeTools();
		} else {
			restoreNormalModeTools();
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => setPlanMode(!planModeEnabled, ctx),
	});

	pi.registerShortcut("shift+tab", {
		description: "Toggle plan mode",
		handler: async (ctx) => setPlanMode(!planModeEnabled, ctx),
	});

	// Keep Ctrl+Alt+P as a backup (doesn't steal thinking cycle)
	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => setPlanMode(!planModeEnabled, ctx),
	});

	// Block destructive bash in plan mode
	pi.on("tool_call", async (event, _ctx) => {
		if (planModeEnabled && event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
				};
			}
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		// Status strings contain ANSI colors; refresh after a theme selection.
		if (ctx.hasUI) updateStatus(ctx);
		if (!planModeEnabled) return;
		return {
			message: {
				customType: "plan-mode-context",
				content:
					'Plan mode: read-only. Explore, ask questions, then output a numbered plan under a "Plan:" header. Do not modify files.',
				display: false,
			},
		};
	});

	// After a Plan: section, offer execute / stay / refine
	pi.on("agent_end", async (event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) return;

		const lastAssistant = event.messages.findLast(isAssistantMessage);
		if (!lastAssistant) return;

		const steps = extractPlanSteps(getTextContent(lastAssistant));
		if (steps.length === 0) return;

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			setPlanMode(false, ctx);

			const list = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content: `Execute the plan.

Reminder: seed these as todos first (one create per step), then work them in order.

${list}`,
					display: true,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		if (ctx.hasUI) updateStatus(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries.findLast(
			(e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode",
		) as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}
