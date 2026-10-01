#!/usr/bin/env python3
"""Round powerline's existing editor inside the Pi host's shared horizontal inset.

The layoutText hook follows the pinned Pi editor's row contract: two borders,
visible input rows (40% of terminal height, minimum five), then completion rows.
"""
from pathlib import Path

from patch_support import read_payload, replace_counted


EDITS = {
    "index.ts": [
        ('''      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) {''', '''      // configs:powerline-editor-v1
      // Count layout rows during the host render, not by inspecting user text.
      let inputLineCount = 1;
      const originalLayoutText = Reflect.get(editor, "layoutText");
      if (typeof originalLayoutText === "function") {
        Reflect.set(editor, "layoutText", (width: number) => {
          const rows = originalLayoutText.call(editor, width);
          inputLineCount = rows.length;
          return rows;
        });
      }
      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 16 || typeof originalLayoutText !== "function") {'''),
        ('''        const bc = (s: string) => `${getFgAnsiCode("sep")}${s}${ansi.reset}`;
        const captureDraft''', '''        const bc = (s: string) => editor.borderColor(s);
        const margin = 0; // The Pi host owns the shared outer inset.
        const inset = " ".repeat(margin);
        const boxWidth = width - 2 * margin;
        const captureDraft'''),
        ('''        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);''', '''        // Reserve both walls and the three-column prompt before wrapping input.
        const contentWidth = boxWidth - 5;
        const lines = originalRender(contentWidth);'''),
        (r'''        let bottomBorderIndex = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i--) {
          const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = i;
            break;
          }
        }''', '''        const visibleRows = Math.min(inputLineCount, Math.max(5, Math.floor(tui.terminal.rows * 0.4)));
        const bottomBorderIndex = 1 + visibleRows;'''),
        ('''        result.push(" " + bc("─".repeat(width - 2)));

        for (let i = 1; i < bottomBorderIndex; i++)''', '''        // Retain host scroll indicators and ANSI bytes, including cursor markers.
        result.push(inset + bc("╭───") + lines[0] + bc("╮"));

        for (let i = 1; i < bottomBorderIndex; i++)'''),
        ('''          const prefix = i === 1 ? promptPrefix : contPrefix;
          result.push(`${prefix}${lines[i] || ""}`);''', '''          const prefix = i === 1 ? promptPrefix : contPrefix;
          result.push(inset + bc("│") + prefix + (lines[i] || "") + bc("│"));'''),
        ('''          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);''', '''          result.push(inset + bc("│") + promptPrefix + " ".repeat(contentWidth) + bc("│"));'''),
        ('''        result.push(" " + bc("─".repeat(width - 2)));

        for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
          result.push(lines[i] || "");''', '''        result.push(inset + bc("╰───") + lines[bottomBorderIndex] + bc("╯"));

        // Completion rows stay outside the box, aligned to the input origin.
        for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
          result.push(inset + "    " + (lines[i] || ""));'''),
    ],
    "bash-mode/editor.ts": [
        (r'''    const availableWidth = Math.max(0, width - visibleWidth(text) - 1);
    if (availableWidth === 0) return lines;

    const shownSuffix = truncateToWidth(suffix, availableWidth, "", true);
    if (!shownSuffix) return lines;

    const padding = " ".repeat(Math.max(0, width - visibleWidth(text) - 1 - visibleWidth(shownSuffix)));
    const ghost = `\x1b[38;5;244m${shownSuffix}\x1b[0m`;
    lines[contentLine] = `${text}${cursorBlock}${ghost}${padding}`;''', r'''    // configs:powerline-ghost-cursor-v1
    // Preserve the host's padding and hardware cursor marker. Wrapped input has
    // its cursor on a later row, so do not paint a suggestion over its first row.
    const row = lines[contentLine];
    const cursorIndex = row.indexOf(cursorBlock);
    if (cursorIndex < 0) return lines;
    const prefix = row.slice(0, cursorIndex + cursorBlock.length);
    const remainingWidth = Math.max(0, width - visibleWidth(prefix));
    const availableWidth = Math.max(0, remainingWidth - this.getPaddingX());
    if (availableWidth === 0) return lines;

    const shownSuffix = truncateToWidth(suffix, availableWidth, "", true);
    if (!shownSuffix) return lines;

    const padding = " ".repeat(Math.max(0, remainingWidth - visibleWidth(shownSuffix)));
    const ghost = `\x1b[38;5;244m${shownSuffix}\x1b[0m`;
    lines[contentLine] = `${prefix}${ghost}${padding}`;'''),
    ],
}


WHITE_OUTLINE_EDITS = [
    (
        '''      const originalRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {''',
        '''      const whiteOutline = (s: string) => ansi.getFgAnsi(255, 255, 255) + s + ansi.reset;
      const nativeRender = editor.render.bind(editor);
      const originalRender = (width: number): string[] => {
        const borderColor = editor.borderColor;
        // Working indicators and scroll labels share this callback; recolor only rules.
        editor.borderColor = (s: string) => s.split(/(─+)/)
          .map((part) => part.startsWith("─") ? whiteOutline(part) : borderColor(part)).join("");
        try {
          return nativeRender(width);
        } finally {
          editor.borderColor = borderColor;
        }
      };
      editor.render = (width: number): string[] => {''',
    ),
    (
        '        const bc = (s: string) => editor.borderColor(s);',
        '        const bc = whiteOutline;',
    ),
]


PRE_VISIBLE_ROWS = '''        const visibleRows = Math.min(inputLineCount, Math.max(5, Math.floor(tui.terminal.rows * 0.3)));
        const bottomBorderIndex = 1 + visibleRows;'''


PROMPT_EDIT = (
    '''        const promptGlyph = bashModeActive ? "$" : captureDraft ? captureSigilGlyph() : ">";
        const promptColor = captureDraft ? getFgAnsiCode("queue") : ansi.getFgAnsi(200, 200, 200);''',
    '''        const promptGlyph = bashModeActive ? "$" : captureDraft ? captureSigilGlyph() : "◆";
        const promptColor = bashModeActive ? ansi.getFgAnsi(200, 200, 200)
          : captureDraft ? getFgAnsiCode("queue") : ansi.getFgAnsi(67, 145, 135);''',
)

LEGACY_PROMPT = '''        const promptGlyph = bashModeActive ? "$" : captureDraft ? captureSigilGlyph() : "◆";
        const promptColor = bashModeActive ? ansi.getFgAnsi(200, 200, 200) : getFgAnsiCode("queue");'''


LEGACY_BORDER_EDIT = (
    '''        result.push(inset + bc("╭───") + lines[0] + bc("╮"));''',
    r'''        // Read live extension statuses, retaining their original gradient bytes.
        const statuses = footerDataRef?.getExtensionStatuses();
        const badges = ["agent-mode", "agent-thinking"]
          .map((key) => statuses?.get(key)).filter(Boolean).join(" ❯ ");
        const badgeWidth = visibleWidth(badges);
        const topBorder = bc("╭───") + lines[0];
        const hintWidth = visibleWidth(lines[0].replace(/\x1b\[[0-9;]*m/g, "").replace(/─+$/, ""));
        // Keep the complete scroll hint and corners on narrow panes; never clip badges.
        if (badges && badgeWidth + hintWidth + 9 <= boxWidth) {
          result.push(inset + truncateToWidth(topBorder, boxWidth - badgeWidth - 5, "")
            + " " + badges + " " + bc("──╮"));
        } else {
          result.push(inset + topBorder + bc("╮"));
        }''',
)


BORDER_EDIT = (LEGACY_BORDER_EDIT[0], read_payload("powerline/editor-badges.ts.inc").rstrip("\n"))
BORDER_FRAME_PREFIX = EDITS["index.ts"][4][1].split(
    "\n\n        for (let i = 1; i < bottomBorderIndex; i++)", 1,
)[0]
PRE_CENTERED_SCROLL_BORDER = read_payload("powerline/legacy/editor-badges-before-centered-scroll.ts.inc").rstrip("\n")
PRE_TPS_BORDER = read_payload("powerline/legacy/editor-badges-before-tps.ts.inc").rstrip("\n")
PRE_LEADING_TPS_BORDER = read_payload("powerline/legacy/editor-badges-before-leading-tps.ts.inc").rstrip("\n")
PRE_FULL_MODE_BORDER = read_payload("powerline/legacy/editor-badges-before-full-mode.ts.inc").rstrip("\n")
PRE_RESPONSE_TIME_BORDER = read_payload("powerline/legacy/editor-badges-before-response-time.ts.inc").rstrip("\n")
PRE_MODEL_BRANCH_BORDER = read_payload("powerline/legacy/editor-badges-before-model-branch.ts.inc").rstrip("\n")
PRE_SAGE_TIMER_BORDER = read_payload("powerline/legacy/editor-badges-before-sage-timer.ts.inc").rstrip("\n")
BOTTOM_BORDER_EDIT = (
    '''        result.push(inset + bc("╰───") + lines[bottomBorderIndex] + bc("╯"));''',
    read_payload("powerline/bottom-badges.ts.inc").rstrip("\n"),
)
PRE_RENDER_HEIGHT = EDITS["index.ts"][2][1]
PREVIOUS_DOUBLE_PADDING_RENDER_HEIGHT = '''        // Reserve both walls and the three-column prompt before wrapping input.
        const contentWidth = boxWidth - 5;
        // Render the native editor with a 40% viewport while preserving the real terminal size.
        const terminalRows = tui.terminal.rows;
        const visibleRowLimit = Math.max(5, Math.floor(terminalRows * 0.4));
        const contentRowLimit = Math.max(1, visibleRowLimit - 2);
        const renderTerminal = Object.create(tui.terminal);
        Object.defineProperty(renderTerminal, "rows", { value: Math.ceil(contentRowLimit / 0.3) });
        const originalTerminal = editor.tui.terminal;
        editor.tui.terminal = renderTerminal;
        let lines: string[];
        try {
          lines = originalRender(contentWidth);
        } finally {
          editor.tui.terminal = originalTerminal;
        }

        const contentRows = Math.max(1, Math.min(inputLineCount, contentRowLimit));
        const blankRow = " ".repeat(Math.max(0, contentWidth));
        lines.splice(1, 0, blankRow);
        lines.splice(2 + contentRows, 0, blankRow);
        inputLineCount = contentRows + 2;'''
PREVIOUS_SINGLE_PADDING_RENDER_HEIGHT = '''        // Reserve both walls and the three-column prompt before wrapping input.
        const contentWidth = boxWidth - 5;
        // Render the native editor with a 40% viewport while preserving the real terminal size.
        const terminalRows = tui.terminal.rows;
        const visibleRowLimit = Math.max(5, Math.floor(terminalRows * 0.4));
        const contentRowLimit = Math.max(1, visibleRowLimit - 1);
        const renderTerminal = Object.create(tui.terminal);
        Object.defineProperty(renderTerminal, "rows", { value: Math.ceil(contentRowLimit / 0.3) });
        const originalTerminal = editor.tui.terminal;
        editor.tui.terminal = renderTerminal;
        let lines: string[];
        try {
          lines = originalRender(contentWidth);
        } finally {
          editor.tui.terminal = originalTerminal;
        }

        const contentRows = Math.max(1, Math.min(inputLineCount, contentRowLimit));
        const blankRow = " ".repeat(Math.max(0, contentWidth));
        lines.splice(1, 0, blankRow);
        inputLineCount = contentRows + 1;'''
PREVIOUS_UNPADDED_RENDER_HEIGHT = '''        // Reserve both walls and the three-column prompt before wrapping input.
        const contentWidth = boxWidth - 5;
        // Render the native editor with a 40% viewport while preserving the real terminal size.
        const terminalRows = tui.terminal.rows;
        const visibleRowLimit = Math.max(5, Math.floor(terminalRows * 0.4));
        const renderTerminal = Object.create(tui.terminal);
        Object.defineProperty(renderTerminal, "rows", { value: Math.ceil(visibleRowLimit / 0.3) });
        const originalTerminal = editor.tui.terminal;
        editor.tui.terminal = renderTerminal;
        let lines: string[];
        try {
          lines = originalRender(contentWidth);
        } finally {
          editor.tui.terminal = originalTerminal;
        }'''
RENDER_HEIGHT_EDIT = (
    PRE_RENDER_HEIGHT,
    read_payload("powerline/editor-render.ts.inc").rstrip("\n"),
)
PREVIOUS_PADDED_INPUT_ROW = '''          const prefix = i === 2 ? promptPrefix : contPrefix;
          result.push(inset + bc("│") + prefix + (lines[i] || "") + bc("│"));'''
PREVIOUS_BOTTOM_BORDER = (
    BOTTOM_BORDER_EDIT[1] + "\n"
    + EDITS["index.ts"][7][1].split("\n", 1)[1]
      .replace("nativeBottomBorderIndex", "bottomBorderIndex")
)
BADGE_IMPORT = (
    "SelectList, truncateToWidth,",
    "SelectList, sliceByColumn, truncateToWidth,",
)
BADGE_BUDGET_EDIT = (
    "        const badgeBudget = boxWidth - hintWidth - 9;",
    "        const badgeBudget = boxWidth - hintWidth - 8;",
)
BADGE_FIT_EDIT = (
    '''        let badges = [responseBadge, primary].filter(Boolean).join("   ");
        // Drop response time, then the branch; never abbreviate the mode or its icon.''',
    '''        let badges = [responseBadge, primary].filter(Boolean).join("   ");
        if (visibleWidth(badges) > badgeBudget && responseBadge && branch) {
          const branchReset = /\\x1b\\[(?:0|39)m/.exec(branch);
          const branchOnly = branchReset
            ? branch.slice(0, branchReset.index + branchReset[0].length)
            : branch.replace(/\\s+(?:[*+?]\\d+)(?:\\s+(?:[*+?]\\d+))*$/, "");
          const compactPrimary = [mode, branchOnly].filter(Boolean).join(" ❯ ");
          const compactBadges = [responseBadge, compactPrimary].filter(Boolean).join("   ");
          if (visibleWidth(compactBadges) <= badgeBudget) badges = compactBadges;
        }
        // Drop response time, then the branch; never abbreviate the mode or its icon.''',
)
BADGE_FIT_LEGACY_EDIT = (
    '''        let badges = [responseBadge, primary].filter(Boolean).join("   ");
        if (visibleWidth(badges) > badgeBudget && responseBadge && branch) {
          const branchOnly = branch.includes(ansi.reset)
            ? branch.slice(0, branch.indexOf(ansi.reset) + ansi.reset.length)
            : branch.replace(/\\s+(?:[*+?]\\d+)(?:\\s+(?:[*+?]\\d+))*$/, "");
          const compactPrimary = [mode, branchOnly].filter(Boolean).join(" ❯ ");
          const compactBadges = [responseBadge, compactPrimary].filter(Boolean).join("   ");
          if (visibleWidth(compactBadges) <= badgeBudget) badges = compactBadges;
        }
        // Drop response time, then the branch; never abbreviate the mode or its icon.''',
    BADGE_FIT_EDIT[0],
)
GIT_LABEL_EDIT = (
    '''        const branch = footerDataRef?.getGitBranch?.() ?? "";''',
    '''        let branch = footerDataRef?.getGitBranch?.() ?? "";
        if (typeof currentCtx !== "undefined" && currentCtx
          && typeof buildSegmentContext === "function" && typeof renderSegment === "function") {
          try {
            const renderedGit = renderSegment("git", buildSegmentContext(currentCtx, ctx.ui.theme));
            if (renderedGit.visible && renderedGit.content) branch = renderedGit.content;
          } catch {
            // Fall back to the branch name while the host context is settling.
          }
        }''',
)


# Color overlays for the imported palettes, not a second editor. Normalize these
# exact fragments before the frame guards; reapply only after full validation.
MEDIUM_THEME_COLOR_EDITS = [
    (
        'const whiteOutline = (s: string) => ansi.getFgAnsi(255, 255, 255) + s + ansi.reset;',
        'const whiteOutline = (s: string) => ["rose-pine", "everforest-dark-medium"].includes(ctx?.ui?.theme?.name ?? "")\n'
        '        ? ctx.ui.theme.fg("text", s) : ansi.getFgAnsi(255, 255, 255) + s + ansi.reset;',
        1,
    ),
    (
        'captureDraft ? getFgAnsiCode("queue") : ansi.getFgAnsi(67, 145, 135);',
        '["rose-pine", "everforest-dark-medium"].includes(ctx?.ui?.theme?.name ?? "") ? ctx.ui.theme.getFgAnsi("accent")\n'
        '          : captureDraft ? getFgAnsiCode("queue") : ansi.getFgAnsi(67, 145, 135);',
        1,
    ),
    (
        '? ansi.getBgAnsi(95, 168, 118) + ansi.getFgAnsi(18, 19, 25) + ` ${responseTime} ` + ansi.reset',
        '? ["rose-pine", "everforest-dark-medium"].includes(ctx?.ui?.theme?.name ?? "")\n'
        '            ? ctx.ui.theme.inverse(ctx.ui.theme.fg("accent", ` ${responseTime} `))\n'
        '            : ansi.getBgAnsi(95, 168, 118) + ansi.getFgAnsi(18, 19, 25) + ` ${responseTime} ` + ansi.reset',
        1,
    ),
]


# Exact migration input from the earlier Rosé Pine-only overlay.
ROSE_PINE_EDITS = [
    (old, new.replace(
        '["rose-pine", "everforest-dark-medium"].includes(ctx?.ui?.theme?.name ?? "")',
        'ctx?.ui?.theme?.name === "rose-pine"',
    ), count)
    for old, new, count in MEDIUM_THEME_COLOR_EDITS
]

# Extend the exact predecessor without changing older themes' appearance.
THEME_COLOR_EDITS = [
    (old, new.replace(
        '"everforest-dark-medium"',
        '"everforest-dark-medium", "everforest-dark-hard"',
    ), count)
    for old, new, count in MEDIUM_THEME_COLOR_EDITS
]


def canonicalize_badge_budget(index: str) -> str:
    """Normalize the badge budget while migrating the top border."""
    old, new = BADGE_BUDGET_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count > 1 or new_count > 1 or (old_count and new_count):
        raise ValueError("editor badge budget changed or duplicated")
    return index.replace(new, old, 1) if new_count else index


def upgrade_badge_budget(index: str) -> str:
    """Give the response badge one extra narrow-layout column."""
    old, new = BADGE_BUDGET_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if new_count == 1 and old_count == 0:
        return index
    if old_count != 1 or new_count:
        raise ValueError("editor badge budget missing or duplicated")
    return index.replace(old, new, 1)


def canonicalize_badge_fit(index: str) -> str:
    """Normalize narrow response-badge fitting before migration."""
    legacy, old = BADGE_FIT_LEGACY_EDIT
    legacy_count = index.count(legacy)
    if legacy_count > 1:
        raise ValueError("editor badge fitting changed or duplicated")
    if legacy_count:
        index = index.replace(legacy, old, 1)

    new_count = index.count(BADGE_FIT_EDIT[1])
    old_count = index.count(old)
    if old_count > 1 or new_count > 1 or (old_count and new_count):
        raise ValueError("editor badge fitting changed or duplicated")
    return index.replace(BADGE_FIT_EDIT[1], old, 1) if new_count else index


def upgrade_badge_fit(index: str) -> str:
    """Keep the response timer visible when the full git suffix is too wide."""
    old, new = BADGE_FIT_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if new_count == 1 and old_count == 0:
        return index
    if old_count != 1 or new_count:
        raise ValueError("editor badge fitting missing or duplicated")
    return index.replace(old, new, 1)


def canonicalize_git_label(index: str) -> str:
    """Normalize a full git badge to the old branch-name anchor."""
    old, new = GIT_LABEL_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count > 1 or new_count > 1 or (old_count and new_count):
        raise ValueError("editor git badge changed or duplicated")
    return index.replace(new, old, 1) if new_count else index


def upgrade_git_label(index: str) -> str:
    """Replace the branch-only badge with the full rendered git segment."""
    old, new = GIT_LABEL_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count != 1 or new_count:
        raise ValueError("editor git badge missing or duplicated")
    return index.replace(old, new, 1)


def canonicalize_render_height(index: str) -> str:
    """Normalize a taller editor render to the guarded native render block."""
    for previous in (PREVIOUS_DOUBLE_PADDING_RENDER_HEIGHT,
                     PREVIOUS_SINGLE_PADDING_RENDER_HEIGHT,
                     PREVIOUS_UNPADDED_RENDER_HEIGHT):
        previous_count = index.count(previous)
        if previous_count > 1:
            raise ValueError("editor render-height patch changed or duplicated")
        if previous_count:
            index = index.replace(previous, PRE_RENDER_HEIGHT, 1)

    old, new = RENDER_HEIGHT_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count > 1 or new_count > 1 or (old_count and new_count):
        raise ValueError("editor render-height patch changed or duplicated")
    return index.replace(new, old, 1) if new_count else index


def upgrade_render_height(index: str) -> str:
    """Apply the taller native render after the complete editor is validated."""
    old, new = RENDER_HEIGHT_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count != 1 or new_count:
        raise ValueError("editor render-height patch missing or duplicated")
    return index.replace(old, new, 1)


def canonicalize_prompt_row(index: str) -> str:
    """Migrate an already-installed padded prompt row to the native position."""
    current = EDITS["index.ts"][5][1]
    padded_count = index.count(PREVIOUS_PADDED_INPUT_ROW)
    current_count = index.count(current)
    if padded_count > 1 or current_count > 1 or (padded_count and current_count):
        raise ValueError("editor prompt row changed or duplicated")
    return index.replace(PREVIOUS_PADDED_INPUT_ROW, current, 1) if padded_count else index


def canonicalize_bottom_border(index: str) -> str:
    """Normalize the current bottom border to the guarded pre-badge frame."""
    old, new = BOTTOM_BORDER_EDIT
    old_count = index.count(old)
    new_count = index.count(new)
    if old_count > 1 or new_count > 1 or (old_count and new_count):
        raise ValueError("editor bottom badge patch changed or duplicated")
    return index.replace(new, old, 1) if new_count else index


def canonicalize_white_outline(index: str) -> str:
    """Rebase only a complete white outline; keep legacy frame validation intact."""
    if not any(new in index for _, new in WHITE_OUTLINE_EDITS):
        return index
    if any(index.count(new) != 1 or old in index for old, new in WHITE_OUTLINE_EDITS):
        raise ValueError("editor white outline changed, partial or duplicated")
    for old, new in WHITE_OUTLINE_EDITS:
        index = index.replace(new, old, 1)
    return index


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Validate the entire set before changing any file; reject partial patches."""
    sources = dict(sources)

    # Canonicalize the optional border upgrade before validating the base frame.
    # The final result restores it below, so replay leaves installed bytes intact.
    old_border, new_border = BORDER_EDIT
    index = sources["index.ts"]
    for edit in [*THEME_COLOR_EDITS, *MEDIUM_THEME_COLOR_EDITS, *ROSE_PINE_EDITS]:
        if edit[1] in index:
            index = replace_counted(index, [edit], "editor theme colors changed:", reverse=True)
    index = canonicalize_white_outline(index)
    index = canonicalize_badge_budget(index)
    index = canonicalize_badge_fit(index)
    index = canonicalize_git_label(index)
    legacy_budget_border = new_border.replace(BADGE_BUDGET_EDIT[1], BADGE_BUDGET_EDIT[0])
    legacy_fit_border = new_border.replace(BADGE_FIT_EDIT[1], BADGE_FIT_EDIT[0])
    legacy_badge_border = legacy_budget_border.replace(BADGE_FIT_EDIT[1], BADGE_FIT_EDIT[0])
    compact_borders = (
        new_border, legacy_budget_border, legacy_fit_border, legacy_badge_border,
        PRE_CENTERED_SCROLL_BORDER, PRE_TPS_BORDER,
        PRE_LEADING_TPS_BORDER, PRE_FULL_MODE_BORDER, PRE_RESPONSE_TIME_BORDER,
        PRE_MODEL_BRANCH_BORDER,
        PRE_SAGE_TIMER_BORDER.replace(BADGE_BUDGET_EDIT[1], BADGE_BUDGET_EDIT[0])
          .replace(BADGE_FIT_EDIT[1], BADGE_FIT_EDIT[0]),
    )
    compact_count = sum(index.count(border) for border in compact_borders)
    if compact_count > 1 or (compact_count == 1) != (BADGE_IMPORT[1] in index):
        raise ValueError("partial or duplicated compact editor badge patch")
    border_variants = [*compact_borders, LEGACY_BORDER_EDIT[1],
                       LEGACY_BORDER_EDIT[1].replace('join(" ❯ ")', 'join(" · ")')]
    frame_comment = BORDER_FRAME_PREFIX.split("\n", 1)[0] + "\n"
    for variant in border_variants:
        index = index.replace(frame_comment + variant, BORDER_FRAME_PREFIX)
        index = index.replace(variant, BORDER_FRAME_PREFIX)

    old_import, new_import = BADGE_IMPORT
    if index.count(new_import) == 1 and index.count(old_import) == 0:
        index = index.replace(new_import, old_import, 1)
    elif index.count(old_import) != 1 or index.count(new_import) != 0:
        raise ValueError("editor badge import changed or duplicated")
    if index.count(PREVIOUS_BOTTOM_BORDER) > 1:
        raise ValueError("editor bottom badge patch changed or duplicated")
    if index.count(PREVIOUS_BOTTOM_BORDER) == 1:
        index = index.replace(PREVIOUS_BOTTOM_BORDER, EDITS["index.ts"][7][0], 1)
    else:
        index = canonicalize_bottom_border(index)
    index = canonicalize_render_height(index)
    index = canonicalize_prompt_row(index)
    visible_rows = EDITS["index.ts"][3][1]
    height_variants = (PRE_VISIBLE_ROWS, visible_rows)
    height_counts = [index.count(variant) for variant in height_variants]
    if sum(height_counts) > 1:
        raise ValueError("editor height patch changed or duplicated")
    if height_counts[0]:
        index = index.replace(PRE_VISIBLE_ROWS, EDITS["index.ts"][3][0], 1)
    if index.count(visible_rows) > 1:
        raise ValueError("editor height patch changed or duplicated")

    # Rebase a complete earlier installation so every guarded edit can be
    # validated and replayed together. A partial installation still fails below.
    core_edits = [EDITS["index.ts"][0], EDITS["index.ts"][1], EDITS["index.ts"][6],
                  EDITS["bash-mode/editor.ts"][0]]
    if all(index.count(new) == 1 and index.count(old) == 0 for old, new in core_edits[:3]) \
            and sources["bash-mode/editor.ts"].count(core_edits[3][1]) == 1 \
            and sources["bash-mode/editor.ts"].count(core_edits[3][0]) == 0:
        for old, new in EDITS["index.ts"]:
            if index.count(new) == 1 and index.count(old) == 0:
                index = index.replace(new, old, 1)
        bash_source = sources["bash-mode/editor.ts"]
        for old, new in EDITS["bash-mode/editor.ts"]:
            if bash_source.count(new) == 1 and bash_source.count(old) == 0:
                bash_source = bash_source.replace(new, old, 1)
        sources["bash-mode/editor.ts"] = bash_source
    sources["index.ts"] = index

    # The prompt can upgrade an already-framed editor or a fresh installation.
    # Validate it separately, still before any file is written.
    old_prompt, new_prompt = PROMPT_EDIT
    previous_teal = new_prompt.replace("ansi.getFgAnsi(67, 145, 135)", "ansi.getFgAnsi(94, 158, 128)")
    sources["index.ts"] = sources["index.ts"].replace(previous_teal, new_prompt).replace(LEGACY_PROMPT, new_prompt)
    index = sources["index.ts"]
    if index.count(new_prompt) == 0 and index.count(old_prompt) == 1:
        sources["index.ts"] = index.replace(old_prompt, new_prompt, 1)
    elif index.count(new_prompt) != 1 or index.count(old_prompt) != 0:
        raise ValueError("editor prompt anchor changed or duplicated")

    # Upgrade the complete earlier editor patch without stacking its 4% gutter
    # inside the host's new 2% gutter. All anchors are still validated below.
    sources["index.ts"] = sources["index.ts"].replace(
        "const margin = Math.max(2, Math.floor(width * 0.04));",
        "const margin = 0; // The Pi host owns the shared outer inset.",
    )
    states = []
    for name, edits in EDITS.items():
        for old, new in edits:
            source = sources[name]
            if source.count(new) == 1:
                states.append("patched")
            elif source.count(new) == 0 and source.count(old) == 1:
                states.append("original")
            else:
                raise ValueError(f"{name}: editor anchor changed or duplicated: {old[:70]}")
    if len(set(states)) != 1:
        raise ValueError("partial editor patch; inspect before reapplying")
    result = dict(sources)
    if states[0] == "original":
        for name, source in sources.items():
            for old, new in EDITS[name]:
                source = source.replace(old, new, 1)
            result[name] = source
    result["index.ts"] = upgrade_render_height(result["index.ts"])
    result["index.ts"] = (result["index.ts"].replace(old_border, new_border, 1)
                          .replace(old_import, new_import, 1))
    result["index.ts"] = upgrade_git_label(result["index.ts"])
    result["index.ts"] = upgrade_badge_budget(result["index.ts"])
    result["index.ts"] = upgrade_badge_fit(result["index.ts"])
    for old, new in WHITE_OUTLINE_EDITS:
        if result["index.ts"].count(old) != 1 or new in result["index.ts"]:
            raise ValueError("editor white outline anchor missing or duplicated")
        result["index.ts"] = result["index.ts"].replace(old, new, 1)
    result["index.ts"] = replace_counted(result["index.ts"], THEME_COLOR_EDITS, "editor theme colors missing:")
    return result


def main() -> None:
    root = Path.home() / ".pi/agent/git/github.com/nicobailon/pi-powerline-footer"
    if not root.exists():
        print("powerline not installed; skipping editor patch")
        return
    sources = {name: (root / name).read_text() for name in EDITS}
    patched = patch_sources(sources)
    for name, source in patched.items():
        if source != sources[name]:
            (root / name).write_text(source)
    print("powerline centered rounded editor ready")


if __name__ == "__main__":
    main()
