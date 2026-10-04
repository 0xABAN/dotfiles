#!/usr/bin/env bash
# Symlink tracked configs into place. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TS="$(date +%Y%m%d%H%M%S)"

echo "== pi extensions checkout =="
EXTENSIONS="$HOME/dev/pi-extensions"
if [[ ! -e "$EXTENSIONS" && ! -L "$EXTENSIONS" ]]; then
  mkdir -p "$(dirname "$EXTENSIONS")"
  git clone https://github.com/0xABAN/pi-extensions.git "$EXTENSIONS"
fi
for extension in inline-skills dj; do
  if [[ ! -f "$EXTENSIONS/$extension/package.json" ]]; then
    echo "missing $EXTENSIONS/$extension/package.json — update the checkout before installing" >&2
    exit 1
  fi
done
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required to install Pi extension dependencies: https://bun.sh" >&2
  exit 1
fi
(cd "$EXTENSIONS" && bun install --frozen-lockfile --ignore-scripts)

backup() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    if [[ -L "$path" ]]; then
      rm "$path"
    else
      mv "$path" "${path}.bak.${TS}"
      echo "backed up $path -> ${path}.bak.${TS}"
    fi
  fi
}

link() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  backup "$dest"
  ln -sfn "$src" "$dest"
  echo "link $dest -> $src"
}

echo "== zsh =="
link "$ROOT/zsh/.zshrc" "$HOME/.zshrc"

echo "== terminal theme =="
link "$ROOT/ghostty/themes/osaka-jade" "$HOME/.config/ghostty/themes/osaka-jade"
link "$ROOT/ghostty/themes/everforest-dark-medium" "$HOME/.config/ghostty/themes/everforest-dark-medium"
link "$ROOT/ghostty/shaders/grain.glsl" "$HOME/.config/ghostty/shaders/grain.glsl"

echo "== nvim =="
mkdir -p "$HOME/.config"
link "$ROOT/nvim" "$HOME/.config/nvim"

echo "== pi agent =="
mkdir -p "$HOME/.pi/agent"
for name in \
  settings.json \
  keybindings.json \
  subagents.json \
  agent-tool-description.md \
  themes \
  skills \
  agents \
  extensions
do
  link "$ROOT/pi/agent/$name" "$HOME/.pi/agent/$name"
done

echo "== shared agent instructions =="
backup "$HOME/AGENTS.md"
link "$ROOT/pi/agent/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
link "$ROOT/pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md"

echo "== rpiv-todo config =="
mkdir -p "$HOME/.config/rpiv-todo"
link "$ROOT/pi/rpiv-todo/config.json" "$HOME/.config/rpiv-todo/config.json"

# secrets stay machine-local
if [[ ! -f "$HOME/.pi/agent/mcp.json" ]]; then
  cp "$ROOT/pi/agent/mcp.json.example" "$HOME/.pi/agent/mcp.json"
  echo "created ~/.pi/agent/mcp.json from example — fill LEETCODE_SESSION (etc.)"
else
  echo "left existing ~/.pi/agent/mcp.json in place (not symlinked; secrets)"
fi

echo "== Cua Driver LaunchAgent =="
if [[ -d /Applications/CuaDriver.app ]]; then
  launch_agent_label="com.trycua.cua-driver"
  launch_agent_domain="gui/$(id -u)"
  launch_agent_plist="$HOME/Library/LaunchAgents/$launch_agent_label.plist"
  cua_driver="/Applications/CuaDriver.app/Contents/MacOS/cua-driver"

  if launchctl print "$launch_agent_domain/$launch_agent_label" >/dev/null 2>&1; then
    launchctl bootout "$launch_agent_domain/$launch_agent_label"
  fi

  if "$cua_driver" status --json >/dev/null 2>&1; then
    "$cua_driver" stop
  fi

  link "$ROOT/pi/agent/launchagents/$launch_agent_label.plist" "$launch_agent_plist"
  launchctl bootstrap "$launch_agent_domain" "$launch_agent_plist"
else
  echo "CuaDriver.app is not installed; skipped its LaunchAgent"
fi

# Extensions must use Pi's host modules rather than declare bundled copies.
python3 -B "$ROOT/pi/patches/host_peer_dependencies.py"

# Keep DJ above powerline's own last-prompt row. Fail visibly if upstream anchors changed.
if [[ -f "$ROOT/pi/patches/powerline_dj.py" ]]; then
  python3 "$ROOT/pi/patches/powerline_dj.py"
fi

# Align footer groups and enable the context meter used by settings.json.
if [[ -f "$ROOT/pi/patches/powerline_layout.py" ]]; then
  python3 "$ROOT/pi/patches/powerline_layout.py"
fi

# Powerline must wait for all compaction hooks before sending its saved prompt.
if [[ -f "$ROOT/pi/patches/powerline_compaction_queue.py" ]]; then
  python3 "$ROOT/pi/patches/powerline_compaction_queue.py"
fi

# Inset the whole Pi viewport before removing the editor's old private gutter.
if [[ -f "$ROOT/pi/patches/pi_horizontal_inset.py" ]]; then
  python3 "$ROOT/pi/patches/pi_horizontal_inset.py"
fi

# Frame the existing editor without replacing its input/autocomplete owner.
if [[ -f "$ROOT/pi/patches/powerline_editor.py" ]]; then
  python3 "$ROOT/pi/patches/powerline_editor.py"
fi

# Render fenced Markdown code as full-width dark panels while retaining highlighting.
if [[ -f "$ROOT/pi/patches/pi_markdown_code.py" ]]; then
  python3 "$ROOT/pi/patches/pi_markdown_code.py"
fi

# Display-only transcript preview: keep native tools, history and expansion intact.
if [[ -f "$ROOT/pi/patches/pi_transcript.py" ]]; then
  python3 "$ROOT/pi/patches/pi_transcript.py"
fi

# Intercom's incoming messages share the transcript; delivery stays package-owned.
if [[ -f "$ROOT/pi/patches/intercom_ui.py" ]]; then
  python3 "$ROOT/pi/patches/intercom_ui.py"
fi

# Agents' pickers, confirmations and editors use these shared native dialogs.
if [[ -f "$ROOT/pi/patches/pi_extension_dialogs.py" ]]; then
  python3 "$ROOT/pi/patches/pi_extension_dialogs.py"
fi

# Native notifications own wrapping, including continuation-line indentation.
if [[ -f "$ROOT/pi/patches/pi_activity_notices.py" ]]; then
  python3 "$ROOT/pi/patches/pi_activity_notices.py"
fi

# Share short-window activity space without clipping extension-owned content.
if [[ -f "$ROOT/pi/patches/pi_compact_layout.py" ]]; then
  python3 "$ROOT/pi/patches/pi_compact_layout.py"
fi

# Add idle breathing room while keeping active loaders flush to the editor.
if [[ -f "$ROOT/pi/patches/pi_editor_gap.py" ]]; then
  python3 "$ROOT/pi/patches/pi_editor_gap.py"
fi

# Resume messages queued while compaction and async input hooks finish.
if [[ -f "$ROOT/pi/patches/pi_compaction_queue.py" ]]; then
  python3 "$ROOT/pi/patches/pi_compaction_queue.py"
fi

# Re-apply local tints on installed pi packages
if [[ -f "$ROOT/pi/patches/rpiv_todo_gray.py" ]]; then
  python3 "$ROOT/pi/patches/rpiv_todo_gray.py" || true
fi

# Match extension-owned activity surfaces to the transcript, after legacy todo tweaks.
if [[ -f "$ROOT/pi/patches/rpiv_todo_ui.py" ]]; then
  python3 "$ROOT/pi/patches/rpiv_todo_ui.py"
fi
if [[ -f "$ROOT/pi/patches/subagents_ui.py" ]]; then
  python3 "$ROOT/pi/patches/subagents_ui.py"
fi

# SDK-based subagents must opt into Pi's built-in MCP and codemode extensions.
if [[ -f "$ROOT/pi/patches/subagents-native-tools.py" ]]; then
  python3 "$ROOT/pi/patches/subagents-native-tools.py"
fi

# npm restores its bundled bin on update; our host patches need the unbundled CLI.
# Preserve config-only installation on machines that do not have Pi yet.
if command -v pi >/dev/null 2>&1; then
  python3 -B - "$ROOT/pi/patches" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, sys.argv[1])
from patch_support import discover_pi_root


PACKAGE = "@earendil-works/pi-coding-agent"
STOCK = "dist/bundle/cli.js"
CUSTOM = "dist/cli.js"
# Published private entrypoints, not an upstream compatibility guarantee.
ENTRY_HASHES = {
    CUSTOM: "8189b66abc4f9f431dbb70941dcba690d76d040de1fbfff212886be35a53639d",
    "dist/cli/setup.js": "4a2a7a0dbf82e2e5d18cec90896b36cbedce78b3d09e78d4040ac94fa3fbeba8",
}


def select_launcher(sdk: Path, launcher: Path, backup_root: Path) -> Path | None:
    """Replace only this SDK's known npm symlink, retaining its exact old target."""
    sdk = sdk.resolve(strict=True)
    # Canonicalize the parent only: macOS /tmp is itself a symlink.
    launcher = launcher.parent.resolve(strict=True) / launcher.name
    package = json.loads((sdk / "package.json").read_text())
    if package.get("name") != PACKAGE or package.get("version") != "1.0.0" or package.get("bin") != {"pi": STOCK}:
        raise ValueError("launcher requires the published Pi 1.0.0 bin contract; review upstream first")
    for name, expected in ENTRY_HASHES.items():
        if (sdk / name).is_symlink() or hashlib.sha256((sdk / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"unrecognized CLI entry: {name}")
    for name in (STOCK, "dist/main.js", "dist/modes/interactive/interactive-mode.js"):
        if not (sdk / name).is_file():
            raise ValueError(f"missing CLI dependency: {name}")
    if not os.access(sdk / CUSTOM, os.X_OK):
        raise ValueError("unbundled CLI is not executable")
    if not launcher.is_symlink():
        raise ValueError(f"refusing non-symlink launcher: {launcher}")
    old_target = os.readlink(launcher)
    resolved = launcher.resolve(strict=True)
    if resolved not in (sdk / STOCK, sdk / CUSTOM):
        raise ValueError(f"launcher does not belong to this SDK: {launcher} -> {old_target}")
    if resolved == sdk / CUSTOM:
        print(f"Customized launcher already selected: {launcher}")
        return None

    backup_root.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="pi-launcher-", dir=backup_root))
    (backup / "launcher.json").write_text(json.dumps({
        "launcher": str(launcher), "target": old_target, "sdk": str(sdk),
        "replacement": os.path.relpath(sdk / CUSTOM, launcher.parent),
    }, indent=2) + "\n")
    (backup / "pi").symlink_to(old_target)
    # Build beside the link for atomic rename; leave the original untouched on failure.
    pending = launcher.parent / f".pi-launcher-{backup.name}"
    pending.symlink_to(os.path.relpath(sdk / CUSTOM, launcher.parent))
    try:
        if not launcher.is_symlink() or os.readlink(launcher) != old_target:
            raise ValueError("launcher changed concurrently; refusing replacement")
        os.replace(pending, launcher)
    finally:
        pending.unlink(missing_ok=True)
    print(f"Customized launcher: {launcher} -> {os.readlink(launcher)}; backup: {backup}")
    return backup


sdk = discover_pi_root()
launcher = shutil.which("pi")
if sdk is None or launcher is None:
    raise SystemExit("pi installation not found")
select_launcher(sdk, Path(launcher), Path.home() / ".config/theme-backups")
PY
else
  echo "Pi not installed; skipping launcher selection"
fi

echo
echo "done. edit files under: $ROOT"
echo "secrets: put exports in ~/.zshrc.local (sourced if present)"
echo "new laptop: git clone <repo> ~/dev/dotfiles && cd ~/dev/dotfiles && ./install.sh"
