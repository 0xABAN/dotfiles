#!/usr/bin/env python3
"""Keep powerline's own last-prompt row below DJ (tested with Pi 0.84.2).

Re-run after updating pi-powerline-footer. Missing installs are skipped;
changed upstream anchors fail without writing, rather than guessing a patch.
"""
from pathlib import Path


MARKER = "  // configs:powerline-dj-v1"
ANCHOR = "  function installPowerlineWidgets(ctx: any) {"
PROMPT = '''    ctx.ui.setWidget("powerline-last-prompt", () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        return renderLastPromptLines(width);
      },
    }), { placement: "belowEditor" });'''
HELPER = f'''{MARKER}
  // Pi re-inserts updated widgets. Keep ownership here, including bash/visibility rules.
  pi.events.on("dj:mounted", () => {{
    if (enabled && currentCtx?.hasUI && tuiRef) installLastPromptWidget(currentCtx);
  }});

  function installLastPromptWidget(ctx: any) {{
{PROMPT}
  }}

{ANCHOR}'''
INSTALL = '''    installLastPromptWidget(ctx);
    // DJ remounts after our rows, then asks us to append the prompt. No recursive rebuild.
    pi.events.emit("powerline:widgets-installed", undefined);'''


def patch(source: str) -> str:
    """Apply both exact edits in memory; never persist a partially recognized version."""
    if MARKER in source:
        if source.count(HELPER) == 1 and source.count(INSTALL) == 1:
            return source
        raise ValueError("incomplete powerline DJ patch; inspect index.ts before reapplying")

    if source.count(ANCHOR) != 1 or source.count(PROMPT) != 1:
        raise ValueError("powerline source changed; review the DJ patch before applying")

    # Replace the original prompt before inserting the helper containing the same block.
    return source.replace(PROMPT, INSTALL).replace(ANCHOR, HELPER)


def main() -> None:
    path = Path.home() / ".pi/agent/git/github.com/nicobailon/pi-powerline-footer/index.ts"
    if not path.exists():
        print("powerline not installed; re-run powerline_dj.py after installing it")
        return

    source = path.read_text()
    updated = patch(source)
    if updated != source:
        path.write_text(updated)
        print("patched", path, "keep last prompt below DJ")


if __name__ == "__main__":
    main()
