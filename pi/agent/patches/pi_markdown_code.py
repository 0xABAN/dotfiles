#!/usr/bin/env python3
"""Render fenced Markdown code as full-width dark code panels in Pi."""
import json
from pathlib import Path

from patch_support import backup_sources, discover_pi_root, write_sources

MARKDOWN = "node_modules/@earendil-works/pi-tui/dist/components/markdown.js"
THEME = "dist/modes/interactive/theme/theme.js"
TUI_PACKAGE = "node_modules/@earendil-works/pi-tui/package.json"

PAYLOADS = Path(__file__).with_name("payloads")
CODE_CASE = (PAYLOADS / "tui/markdown_code_case.js.inc").read_text().rstrip("\n")
LEGACY_CODE_CASE = (PAYLOADS / "tui/legacy/markdown_code_case.js.inc").read_text().rstrip("\n")
LEGACY_CODE_CASE_WITH_PADDING = (PAYLOADS / "tui/legacy/markdown_code_case_with_padding.js.inc").read_text().rstrip("\n")
LEGACY_WRAP = (PAYLOADS / "tui/legacy/markdown_code_wrap.js.inc").read_text().rstrip("\n")
LEGACY_CONTENT = (PAYLOADS / "tui/legacy/markdown_code_content.js.inc").read_text().rstrip("\n")
LEGACY_ROUNDED_CONTENT = (PAYLOADS / "tui/legacy/markdown_code_content_rounded.js.inc").read_text().rstrip("\n")
LEGACY_CONTAINED_CONTENT = (PAYLOADS / "tui/legacy/markdown_code_content_contained.js.inc").read_text().rstrip("\n")
LEGACY_OUTLINED_CONTENT = (PAYLOADS / "tui/legacy/markdown_code_content_outlined.js.inc").read_text().rstrip("\n")
LEGACY_THEME = (PAYLOADS / "tui/legacy/markdown_code_theme.js.inc").read_text().rstrip("\n")
LEGACY_FORCED_DIM_THEME = (PAYLOADS / "tui/legacy/markdown_code_theme_forced_dim.js.inc").read_text().rstrip("\n")

LEGACY_MARKER_DECL = r'''const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
const CODE_BLOCK_MARKER = "\x1b_PiCodeBlock\x07";'''

EDITS = {
    MARKDOWN: [
        (r'''const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;''',
         r'''const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
const CODE_BLOCK_MARKER = "\x1b_PiCodeBlock\x07";
const CODE_BLOCK_TOP_MARKER = CODE_BLOCK_MARKER + "T";
const CODE_BLOCK_BOTTOM_MARKER = CODE_BLOCK_MARKER + "B";'''),
        (r'''            case "code": {
                const indent = this.theme.codeBlockIndent ?? "  ";
                lines.push(this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
                if (this.theme.highlightCode) {
                    const highlightedLines = this.theme.highlightCode(token.text, token.lang);
                    for (const hlLine of highlightedLines) {
                        lines.push(`${indent}${hlLine}`);
                    }
                }
                else {
                    // Split code by newlines and style each line
                    const codeLines = token.text.split("\n");
                    for (const codeLine of codeLines) {
                        lines.push(`${indent}${this.theme.codeBlock(codeLine)}`);
                    }
                }
                lines.push(this.theme.codeBlockBorder("```"));
                if (nextTokenType && nextTokenType !== "space") {
                    lines.push(""); // Add spacing after code blocks (unless space token follows)
                }
                break;
            }''', CODE_CASE),
        (r'''        for (const line of renderedLines) {
            if (isImageLine(line)) {
                wrappedLines.push(line);
            }
            else {
                for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
                    wrappedLines.push(wrappedLine);
                }
            }
        }''',
         r'''        for (const line of renderedLines) {
            if (isImageLine(line)) {
                wrappedLines.push(line);
            }
            else {
                const codeBlockMarker = line.startsWith(CODE_BLOCK_TOP_MARKER)
                    ? CODE_BLOCK_TOP_MARKER
                    : line.startsWith(CODE_BLOCK_BOTTOM_MARKER)
                        ? CODE_BLOCK_BOTTOM_MARKER
                        : line.startsWith(CODE_BLOCK_MARKER) ? CODE_BLOCK_MARKER : "";
                const lineWithoutMarker = codeBlockMarker ? line.slice(codeBlockMarker.length) : line;
                const wrapWidth = codeBlockMarker ? Math.max(1, contentWidth - 2) : contentWidth;
                for (const wrappedLine of wrapTextWithAnsi(lineWithoutMarker, wrapWidth)) {
                    wrappedLines.push(codeBlockMarker ? codeBlockMarker + wrappedLine : wrappedLine);
                }
            }
        }'''),
        (r'''        for (const line of wrappedLines) {
            if (isImageLine(line)) {
                contentLines.push(line);
                continue;
            }
            const lineWithMargins = leftMargin + line + rightMargin;
            if (bgFn) {
                contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
            }
            else {
                // No background - just pad to width
                const visibleLen = visibleWidth(lineWithMargins);
                const paddingNeeded = Math.max(0, width - visibleLen);
                contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
            }
        }''',
         r'''        const codeBlockBgFn = this.theme.codeBlockBackground;
        for (const line of wrappedLines) {
            if (isImageLine(line)) {
                contentLines.push(line);
                continue;
            }
            const codeBlockMarker = line.startsWith(CODE_BLOCK_TOP_MARKER)
                ? CODE_BLOCK_TOP_MARKER
                : line.startsWith(CODE_BLOCK_BOTTOM_MARKER)
                    ? CODE_BLOCK_BOTTOM_MARKER
                    : line.startsWith(CODE_BLOCK_MARKER) ? CODE_BLOCK_MARKER : "";
            const lineWithoutMarker = codeBlockMarker ? line.slice(codeBlockMarker.length) : line;
            const lineWithMargins = leftMargin + lineWithoutMarker + rightMargin;
            if (codeBlockMarker && codeBlockBgFn) {
                contentLines.push(applyBackgroundToLine(lineWithMargins, width, codeBlockBgFn));
            }
            else if (bgFn) {
                contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
            }
            else {
                // No background - just pad to width
                const visibleLen = visibleWidth(lineWithMargins);
                const paddingNeeded = Math.max(0, width - visibleLen);
                contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
            }
        }'''),
    ],
    THEME: [
        ('''        codeBlock: (text) => theme.fg("mdCodeBlock", text),
        codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),''',
         '''        codeBlock: (text) => theme.fg("mdCodeBlock", text),
        codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
        codeBlockBackground: (text) => theme.bg("userMessageBg", text),'''),
    ],
}


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    _, marker_new = EDITS[MARKDOWN][0]
    _, code_new = EDITS[MARKDOWN][1]
    _, wrap_new = EDITS[MARKDOWN][2]
    _, content_new = EDITS[MARKDOWN][3]
    _, theme_new = EDITS[THEME][0]
    legacy_cases = (LEGACY_CODE_CASE, LEGACY_CODE_CASE_WITH_PADDING)
    markdown = sources[MARKDOWN]
    theme = sources[THEME]

    # Migrate the previous bounded panel and forced light-gray border together.
    if (markdown.count(marker_new) == 1
            and markdown.count(code_new) == 1
            and markdown.count(wrap_new) == 1
            and markdown.count(LEGACY_CONTAINED_CONTENT) == 1
            and markdown.count(content_new) == 0
            and theme.count(LEGACY_FORCED_DIM_THEME) == 1
            and theme.count(theme_new) == 0):
        result = dict(sources)
        result[MARKDOWN] = markdown.replace(LEGACY_CONTAINED_CONTENT, content_new, 1)
        result[THEME] = theme.replace(LEGACY_FORCED_DIM_THEME, theme_new, 1)
        return result

    # Migrate the previous outlined panel to padded background rows.
    legacy_panel_content = next((content for content in (LEGACY_OUTLINED_CONTENT, LEGACY_ROUNDED_CONTENT)
                                 if markdown.count(content) == 1), None)
    if (markdown.count(marker_new) == 1
            and markdown.count(code_new) == 1
            and markdown.count(wrap_new) == 1
            and legacy_panel_content is not None
            and markdown.count(content_new) == 0
            and theme.count(theme_new) == 1):
        result = dict(sources)
        result[MARKDOWN] = markdown.replace(legacy_panel_content, content_new, 1)
        return result

    # Migrate either shipped pre-rounded panel layout before applying the new frame.
    legacy_case = next((case for case in legacy_cases if markdown.count(case) == 1), None)
    if (legacy_case is not None
            and markdown.count(LEGACY_MARKER_DECL) == 1
            and markdown.count(marker_new) == 0
            and markdown.count(LEGACY_WRAP) == 1
            and markdown.count(wrap_new) == 0
            and markdown.count(LEGACY_CONTENT) == 1
            and markdown.count(content_new) == 0
            and theme.count(theme_new) == 1):
        result = dict(sources)
        result[MARKDOWN] = (markdown
            .replace(LEGACY_MARKER_DECL, marker_new, 1)
            .replace(legacy_case, code_new, 1)
            .replace(LEGACY_WRAP, wrap_new, 1)
            .replace(LEGACY_CONTENT, content_new, 1))
        return result

    states = []
    for name, edits in EDITS.items():
        source = sources[name]
        for old, new in edits:
            old_count = source.count(old)
            new_count = source.count(new)
            if new_count == 1:
                states.append("patched")
            elif new_count == 0 and old_count == 1:
                states.append("original")
            else:
                raise ValueError(f"{name}: markdown code anchor changed or duplicated")

    if len(set(states)) == 1 and states[0] == "patched":
        return dict(sources)
    if len(set(states)) == 1 and states[0] == "original":
        result = dict(sources)
        for name, edits in EDITS.items():
            source = result[name]
            for old, new in edits:
                source = source.replace(old, new, 1)
            result[name] = source
        return result
    raise ValueError("partial markdown code patch; inspect before reapplying")


def main() -> None:
    root = discover_pi_root()
    if root is None or not root.exists():
        print("Pi SDK not installed; skipping Markdown code panels")
        return

    package_path = root / TUI_PACKAGE
    if not package_path.exists():
        print("Pi TUI not installed; skipping Markdown code panels")
        return
    if json.loads(package_path.read_text()).get("version") != "0.87.1":
        raise ValueError("Markdown code panels require pi-tui 0.87.1; review upstream first")

    names = tuple(EDITS)
    if any(not (root / name).exists() for name in names):
        raise ValueError("Markdown code panel sources are missing")
    sources = {name: (root / name).read_text() for name in names}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, names, "pi-markdown-code-")
        print(f"Markdown code backup: {backup}")
        write_sources(root, patched)
    print("Markdown code panels ready; restart Pi to apply")


if __name__ == "__main__":
    main()
