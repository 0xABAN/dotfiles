#!/usr/bin/env python3
"""Install the transcript and UI-only tool metrics into Pi 1.0.0; restart to apply.

Preserve native tool execution and model-visible output. Timings share the
existing result-entry write, outside its message. Refuse partial/unknown hosts
before writing; back up every changed source and leave unrelated installed edits alone.
"""
import json
from pathlib import Path

from patch_support import (
    read_payload,
    discover_pi_root as discover_root,
    backup_sources,
    write_sources,
)


BASE = "dist/modes/interactive/"
MODULE = BASE + "components/transcript.js"
MODULE_SOURCE = read_payload('host/transcript.js.inc')
PRE_ROW_CACHE_MODULE_SOURCE = read_payload('host/legacy/transcript_before_row_cache.js.inc')
LEGACY_MODULE_SOURCE = read_payload('host/legacy/transcript.js.inc')
PRE_COMPACT_MODULE_SOURCE = read_payload('host/legacy/transcript_before_compact.js.inc')
PRE_YELLOW_ICON_MODULE_SOURCE = read_payload('host/legacy/transcript_before_yellow_icon.js.inc')
PRE_METRICS_MODULE_SOURCE = read_payload('host/legacy/transcript_before_metrics.js.inc')
PRE_TOOL_ROWS_MODULE_SOURCE = read_payload('host/legacy/transcript_before_tool_rows.js.inc')
PRE_NATIVE_PADDING_MODULE_SOURCE = read_payload('host/legacy/transcript_before_native_padding.js.inc')
PRE_INLINE_METRICS_MODULE_SOURCE = read_payload('host/legacy/transcript_before_inline_metrics.js.inc')
PRE_USER_SEPARATOR_MODULE_SOURCE = read_payload('host/legacy/transcript_before_user_separator.js.inc')
PRE_SEPARATOR_PADDING_MODULE_SOURCE = read_payload('host/legacy/transcript_before_separator_padding.js.inc')
PRE_SOURCE_READ_MODULE_SOURCE = read_payload('host/legacy/transcript_before_source_read.js.inc')
PRE_UNIVERSAL_TOOLS_MODULE_SOURCE = read_payload('host/legacy/transcript_before_universal_tools.js.inc')
PRE_INTERCOM_LABEL_MODULE_SOURCE = read_payload('host/legacy/transcript_before_intercom_label.js.inc')
PRE_CHAT_ICON_MODULE_SOURCE = read_payload('host/legacy/transcript_before_chat_icon.js.inc')
PRE_SINGLE_ACTION_MODULE_SOURCE = read_payload('host/legacy/transcript_before_single_action.js.inc')
PRE_DASH_REMOVAL_MODULE_SOURCE = read_payload('host/legacy/transcript_before_single_action_dash_removal.js.inc')
# Derive the exact older background helpers from the frozen separator revision,
# not the current renderer: later layout changes must not alter migration inputs.
_USER_BACKGROUND_IMPORTS = '''import { DynamicBorder } from "./dynamic-border.js";\n\nconst USER_SEPARATOR = new DynamicBorder(line => theme.fg("toolOutput", line));\n'''
_USER_SEPARATOR_RENDER = '''            lines.push(...nativeLines);\n            if (child.transcriptRole === "pi") speaker = "pi";\n            else if (child.transcriptRole === "user") {\n                speaker = "user";\n                // Like the textarea, use the shared viewport without a second gutter.\n                lines.push(...USER_SEPARATOR.render(width));\n            }\n            else if (child.transcriptRole !== "tool") speaker = undefined;'''
_USER_BACKGROUND_RENDER = '''            lines.push(...(child.transcriptRole === "user"\n                ? nativeLines.map(line => userMessageBackground(line, width))\n                : nativeLines));\n            if (child.transcriptRole === "pi") speaker = "pi";\n            else if (child.transcriptRole === "user") speaker = "user";\n            else if (child.transcriptRole !== "tool") speaker = undefined;'''
_USER_BACKGROUND_HELPER = '''function userMessageBackground(line, width) {
    return theme.bg("userMessageBg", line + " ".repeat(Math.max(0, width - visibleWidth(line))));
}
'''
_USER_BACKGROUND_RESET_HELPER = '''function userMessageBackground(line, width) {
    const background = theme.getBgAnsi("userMessageBg");
    const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
    // chalk.bold may emit a full reset; reopen the row background after it.
    return theme.bg("userMessageBg", padded.replaceAll("\\x1b[0m", `\\x1b[0m${background}`));
}
'''
if PRE_SINGLE_ACTION_MODULE_SOURCE.count(_USER_BACKGROUND_IMPORTS) != 1 or PRE_SINGLE_ACTION_MODULE_SOURCE.count(_USER_SEPARATOR_RENDER) != 1:
    raise ValueError("transcript separator source changed; inspect before migrating background removal")

def _previous_background_module(helper):
    source = PRE_SINGLE_ACTION_MODULE_SOURCE.replace(_USER_BACKGROUND_IMPORTS, "", 1)
    source = source.replace(_USER_SEPARATOR_RENDER, _USER_BACKGROUND_RENDER, 1)
    marker = "\nexport function speakerHeader"
    if source.count(marker) != 1:
        raise ValueError("transcript speaker header anchor changed; inspect before migrating background removal")
    return source.replace(marker, "\n" + helper + "\nexport function speakerHeader", 1)

PRE_USER_BACKGROUND_MODULE_SOURCE = _previous_background_module(_USER_BACKGROUND_HELPER)
PRE_USER_BACKGROUND_RESET_MODULE_SOURCE = _previous_background_module(_USER_BACKGROUND_RESET_HELPER)
PRE_METRICS_EDITS = json.loads(read_payload('host/legacy/transcript_edits_before_metrics.json'))
LEGACY_EDITS = json.loads(read_payload('host/legacy/transcript_edits_v1.json'))
EDITS = {
    BASE + "interactive-mode.js": [
        ('import { UserMessageComponent } from "./components/user-message.js";',
         'import { UserMessageComponent } from "./components/user-message.js";\n'
         'import { TranscriptContainer, startToolTiming, finishToolTiming, collectToolTimings } from "./components/transcript.js"; // configs:pi-transcript-v1'),
        ("        this.chatContainer = new Container();",
         "        this.chatContainer = new TranscriptContainer(() => this.outputPad, () => this.ui.terminal.rows);"),
        ('''    getRegisteredToolDefinition(toolName) {
        return withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName));
    }''', '''    getRegisteredToolDefinition(toolName) {
        const definition = withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName));
        if (!definition) return definition;
        // Only native and the installed pretty formatters opt into compact rows.
        // Do not replace arbitrary extensions' custom UI, even for built-in names.
        const owner = this.session.getAllTools().find(tool => tool.name === toolName)?.sourceInfo?.source;
        return { ...definition, configsTranscriptCompact:
            owner === "builtin" || /^npm:@heyhuynhgiabuu\\/pi-pretty(?:@|$)/.test(owner ?? "") };
    }'''),
        ("new UserMessageComponent(skillBlock.userMessage, this.getMarkdownThemeWithSettings(), this.outputPad, this.getMarkdownTransformers())",
         "new UserMessageComponent(skillBlock.userMessage, this.getMarkdownThemeWithSettings(), this.outputPad, this.getMarkdownTransformers(), message.timestamp)"),
        ("new UserMessageComponent(textContent, this.getMarkdownThemeWithSettings(), this.outputPad, this.getMarkdownTransformers())",
         "new UserMessageComponent(textContent, this.getMarkdownThemeWithSettings(), this.outputPad, this.getMarkdownTransformers(), message.timestamp)"),
        ("                component.markExecutionStarted();",
         "                startToolTiming(component);\n                component.markExecutionStarted();"),
        ("                    component.updateResult({ ...event.result, isError: event.isError });", '''                    const timing = finishToolTiming(component);
                    if (timing) this.sessionManager.configsToolTimings.set(event.toolCallId, timing);
                    component.updateResult({ ...event.result, isError: event.isError });'''),
        ("        const renderedPendingTools = new Map();",
         "        const renderedPendingTools = new Map();\n        const toolTimings = collectToolTimings(this.sessionManager.getBranch());"),
        ('                this.pendingTools.clear();\n                this.ui.requestRender();\n                break;\n            case "agent_settled":',
         '                this.pendingTools.clear();\n                this.sessionManager.configsToolTimings.clear();\n                this.ui.requestRender();\n                break;\n            case "agent_settled":'),
        ("                    component.updateResult(message);", '''                    const timing = toolTimings.get(message.toolCallId);
                    if (timing?.toolName === component.toolName) {
                        component.transcriptDurationMs = timing.durationMs;
                    }
                    component.updateResult(message);'''),
    ],
    BASE + "components/user-message.js": [
        ('import { createMarkdownTransform } from "./markdown-transform.js";',
         'import { createMarkdownTransform } from "./markdown-transform.js";\n'
         'import { speakerHeader, transcriptPadding } from "./transcript.js"; // configs:pi-transcript-v1'),
        ("    text;", '    transcriptRole = "user";\n    timestamp;\n    text;'),
        ("constructor(text, markdownTheme = getMarkdownTheme(), outputPad = 1, markdownTransformers = [])",
         "constructor(text, markdownTheme = getMarkdownTheme(), outputPad = 1, markdownTransformers = [], timestamp)"),
        ("        this.outputPad = outputPad;", "        this.outputPad = outputPad + 2;\n        this.transcriptBasePad = outputPad;\n        this.timestamp = timestamp;"),
        ("        this.outputPad = padding;", "        this.outputPad = padding + 2;\n        this.transcriptBasePad = padding;"),
        ('''        // The Markdown pads and colors its own background: a Box around it would keep a second full-width copy of every
        // line, with identical output.
        this.addChild(new Markdown(this.text, this.outputPad, 1, this.markdownTheme, {
            color: (content) => theme.fg("userMessageText", content),
            bgColor: (content) => theme.bg("userMessageBg", content),''',
         '''        // Keep upstream's single Markdown cache; transcript headers own spacing and separators.
        this.addChild(new Markdown(this.text, this.outputPad, 0, this.markdownTheme, {
            color: (content) => theme.fg("userMessageText", content),'''),
        ("        const lines = super.render(width);", '''        const padding = transcriptPadding(this.transcriptBasePad, width);
        if (this.outputPad !== padding) {
            this.outputPad = padding;
            this.rebuild();
        }
        const lines = super.render(width);
        lines.unshift(speakerHeader("You", this.timestamp, this.transcriptBasePad, width));
        if (!this.transcriptTight) lines.unshift("");'''),
    ],
    BASE + "components/assistant-message.js": [
        ('import { createMarkdownTransform } from "./markdown-transform.js";',
         'import { createMarkdownTransform } from "./markdown-transform.js";\n'
         'import { speakerHeader, transcriptPadding } from "./transcript.js"; // configs:pi-transcript-v1'),
        ("    contentContainer;", '    transcriptRole = "pi";\n    contentContainer;'),
        ("        this.outputPad = outputPad;", "        this.outputPad = outputPad + 2;\n        this.transcriptBasePad = outputPad;"),
        ("        this.outputPad = padding;", "        this.outputPad = padding + 2;\n        this.transcriptBasePad = padding;"),
        ("        const lines = super.render(width);", '''        const padding = transcriptPadding(this.transcriptBasePad, width);
        if (this.outputPad !== padding) {
            this.outputPad = padding;
            if (this.lastMessage) this.updateContent(this.lastMessage);
        }
        const lines = super.render(width);
        if (this.transcriptHeader !== false && (lines.length || this.hasToolCalls)) {
            if (lines[0] === "") lines.shift();
            lines.unshift(speakerHeader("Pi", this.lastMessage?.timestamp, this.transcriptBasePad, width));
            if (!this.transcriptTight) lines.unshift("");
        }'''),
    ],
    BASE + "components/tool-execution.js": [
        ("    contentBox;", '    transcriptRole = "tool"; // configs:pi-transcript-v1\n    contentBox;'),
    ],
    "dist/core/session-manager.js": [
        ("    leafId = null;", "    leafId = null;\n    configsToolTimings = new Map();"),
        ("    newSession(options) {", "    newSession(options) {\n        this.configsToolTimings.clear();"),
        ("    _buildIndex() {", "    _buildIndex() {\n        this.configsToolTimings.clear();"),
        ("    branch(branchFromId) {", "    branch(branchFromId) {\n        this.configsToolTimings.clear();"),
        ("    resetLeaf() {", "    resetLeaf() {\n        this.configsToolTimings.clear();"),
        ('''            message,
        };
        this._appendEntry(entry);''', '''            message,
        };
        // UI timing belongs to the entry wrapper, not model-visible messages.
        // Share the canonical result write: no independently failing metadata append.
        const timing = message.role === "toolResult" ? this.configsToolTimings.get(message.toolCallId) : undefined;
        if (timing && typeof timing.toolCallId === "string" && timing.toolCallId
            && typeof timing.toolName === "string" && timing.toolName
            && timing.toolCallId === message.toolCallId && timing.toolName === message.toolName
            && Number.isFinite(timing.durationMs) && timing.durationMs >= 0) {
            entry.configsToolTiming = {
                toolCallId: timing.toolCallId, toolName: timing.toolName, durationMs: timing.durationMs,
            };
        }
        this._appendEntry(entry);
        if (message.role === "toolResult") this.configsToolTimings.delete(message.toolCallId);'''),
    ],
    "dist/core/tools/read.js": [
        ('                            content = [{ type: "text", text: outputText }];', '''                            content = [{ type: "text", text: outputText }];
                            // Count source lines actually returned, before continuation notices.
                            details = { ...details, configsTranscript: { lines: truncation.outputLines } };'''),
    ],
    "dist/core/tools/write.js": [
        ('                    details: undefined,', '''                    details: { configsTranscript: {
                        lines: content.length === 0 ? 0 : content.split("\\n").length - Number(content.endsWith("\\n")),
                    } },'''),
    ],
    "dist/core/tools/edit.js": [
        ('                    details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine },',
         '                    details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine, configsTranscript: { edits: edits.length } },'),
    ],
}


# Keep the exact installed lookup as a migration input; only the registered
# intercom tool from the supported npm package joins the compact allowance.
PRE_INTERCOM_LOOKUP = EDITS[BASE + "interactive-mode.js"][2]
old_lookup, previous_lookup = PRE_INTERCOM_LOOKUP
EDITS[BASE + "interactive-mode.js"][2] = (old_lookup, previous_lookup.replace(
    '        // Only native and the installed pretty formatters opt into compact rows.',
    '        // Only native, installed pretty and the supported Intercom tool opt in.',
).replace(
    '.test(owner ?? "") };',
    '.test(owner ?? "")\n            || (toolName === "intercom"'
    ' && (owner === "npm:pi-intercom" || owner === "npm:pi-intercom@0.13.0")) };',
))

# Source reads use the existing generic Tool row, not a second package card.
PRE_SOURCE_READ_LOOKUP = EDITS[BASE + "interactive-mode.js"][2]
old_lookup, previous_lookup = PRE_SOURCE_READ_LOOKUP
EDITS[BASE + "interactive-mode.js"][2] = (old_lookup, previous_lookup.replace(
    '        // Only native, installed pretty and the supported Intercom tool opt in.',
    '        // Only native and explicitly supported package formatters opt in.',
).replace(
    ' };',
    '\n            || (toolName === "get_search_content"'
    ' && (owner === "npm:pi-web-access" || owner === "npm:pi-web-access@0.27.0")) };',
))

# Universal rows need provenance for protocol-specific names/errors, not a card allowlist.
PRE_UNIVERSAL_TOOLS_LOOKUP = EDITS[BASE + "interactive-mode.js"][2]
EDITS[BASE + "interactive-mode.js"][2] = (old_lookup, '''    getRegisteredToolDefinition(toolName) {
        const definition = withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName));
        if (!definition) return definition;
        const origin = this.session.getAllTools().find(tool => tool.name === toolName)?.sourceInfo;
        const source = origin?.source === "builtin" ? origin.path : origin?.source;
        return { ...definition, configsTranscriptSource: source };
    }''')

# Keep the supported layout/helper migrations, but require the native renderer
# lookup in every revision. An old host method must not drop built-in renderers.
for previous_edits in (PRE_METRICS_EDITS, LEGACY_EDITS):
    previous_edits[BASE + "interactive-mode.js"][2] = EDITS[BASE + "interactive-mode.js"][2]

# All tool state setters and renderer invalidations converge on updateDisplay().
# Preserve the exact pre-cache host edits so the hook and helper migrate together.
PRE_ROW_CACHE_EDITS = {name: list(edits) for name, edits in EDITS.items()}
EDITS[BASE + "components/tool-execution.js"].append((
    "    updateDisplay() {",
    "    updateDisplay() {\n        this.transcriptRevision = (this.transcriptRevision ?? 0) + 1;",
))


def source_state(sources: dict[str, str], replacements: dict) -> str:
    """Classify a whole known source revision, including overlapping setters."""
    states = []
    for name, edits in replacements.items():
        source = sources[name]
        # New render blocks can legitimately contain an old setter statement.
        # Exclude all recognized replacements before looking for stray originals.
        remainder = source
        for _, new in edits:
            if source.count(new) == 1:
                remainder = remainder.replace(new, "", 1)
        for old, new in edits:
            if source.count(new) == 1 and old not in remainder:
                states.append("patched")
            elif source.count(new) == 0 and source.count(old) == 1:
                states.append("original")
            else:
                raise ValueError(f"{name}: transcript anchor changed or duplicated: {old[:70]}")
    if len(set(states)) != 1:
        raise ValueError("partial transcript patch; inspect before reapplying")
    return states[0]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Accept complete current/original sources or an exact supported revision."""
    previous_helpers = (
        PRE_ROW_CACHE_MODULE_SOURCE, PRE_CHAT_ICON_MODULE_SOURCE, PRE_INTERCOM_LABEL_MODULE_SOURCE,
        PRE_UNIVERSAL_TOOLS_MODULE_SOURCE, PRE_SOURCE_READ_MODULE_SOURCE,
        PRE_DASH_REMOVAL_MODULE_SOURCE, PRE_SINGLE_ACTION_MODULE_SOURCE,
        PRE_TOOL_ROWS_MODULE_SOURCE, PRE_NATIVE_PADDING_MODULE_SOURCE,
        PRE_INLINE_METRICS_MODULE_SOURCE, PRE_USER_SEPARATOR_MODULE_SOURCE,
        PRE_SEPARATOR_PADDING_MODULE_SOURCE, PRE_USER_BACKGROUND_MODULE_SOURCE,
        PRE_USER_BACKGROUND_RESET_MODULE_SOURCE,
    )
    try:
        state = source_state(sources, EDITS)
    except ValueError as current_error:
        revisions = [
            (EDITS, (MODULE_SOURCE, *previous_helpers)),
            (PRE_ROW_CACHE_EDITS, previous_helpers),
            (PRE_METRICS_EDITS, (PRE_METRICS_MODULE_SOURCE, PRE_YELLOW_ICON_MODULE_SOURCE)),
            (LEGACY_EDITS, (LEGACY_MODULE_SOURCE, PRE_COMPACT_MODULE_SOURCE)),
        ]
        # Accept earlier layouts with known lookups, but still validate the
        # entire matching source set and helper before changing anything.
        variants = []
        for revision, helpers in revisions:
            variants.append((revision, helpers))
            for lookup in (PRE_UNIVERSAL_TOOLS_LOOKUP, PRE_SOURCE_READ_LOOKUP, PRE_INTERCOM_LOOKUP):
                previous = {name: list(edits) for name, edits in revision.items()}
                previous[BASE + "interactive-mode.js"][2] = lookup
                variants.append((previous, helpers))
        for previous_edits, helpers in variants:
            if sources.get(MODULE) not in helpers:
                continue
            # Old host edits and their helper migrate together. Never repair a
            # mixed installation just because its helper is recognizable.
            try:
                if source_state(sources, previous_edits) != "patched":
                    continue
            except ValueError:
                continue
            original = dict(sources)
            del original[MODULE]
            for name, edits in previous_edits.items():
                for old, new in reversed(edits):
                    original[name] = original[name].replace(new, old, 1)
            return patch_sources(original)
        raise current_error
    if state == "patched":
        if sources.get(MODULE) in previous_helpers:
            return {**sources, MODULE: MODULE_SOURCE}
        if sources.get(MODULE) != MODULE_SOURCE:
            raise ValueError("transcript module changed or missing; inspect before reapplying")
        return sources
    if MODULE in sources:
        raise ValueError("unexpected transcript module alongside unpatched host")
    result = dict(sources)
    for name, edits in EDITS.items():
        for old, new in edits:
            result[name] = result[name].replace(old, new, 1)
    result[MODULE] = MODULE_SOURCE
    return result


def main() -> None:
    root = discover_root()
    if root is None or not root.exists():
        print("Pi host not installed; skipping transcript preview")
        return
    version = json.loads((root / "package.json").read_text())["version"]
    if version != "1.0.0":
        raise ValueError(f"transcript patch requires Pi 1.0.0, found {version}; review upstream first")
    sources = {name: (root / name).read_text() for name in EDITS}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(
            root, sources, "pi-transcript-", added_files=sorted(set(patched) - set(sources)),
        )
        print(f"Pi transcript backup: {backup}")
        write_sources(root, patched)
    print("Pi transcript preview ready; restart Pi to apply")


if __name__ == "__main__":
    main()
