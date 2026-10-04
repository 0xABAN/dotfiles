import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXCLUDED_TOOLS = new Set(["find_files", "fff_multi_grep", "process"]);

export default function toolFilter(pi: ExtensionAPI): void {
	const removeExcludedTools = () => {
		const activeTools = pi.getActiveTools();
		const filteredTools = activeTools.filter((name) => !EXCLUDED_TOOLS.has(name));
		if (filteredTools.length !== activeTools.length) pi.setActiveTools(filteredTools);
	};

	pi.on("session_start", removeExcludedTools);
	pi.on("before_agent_start", removeExcludedTools);
}
