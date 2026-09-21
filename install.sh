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

# Keep the short command as a pointer to the single computer-use skill.
link "$ROOT/pi/agent/prompts/use-computer.md" "$HOME/.pi/agent/prompts/use-computer.md"

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


# Keep DJ above powerline's own last-prompt row. Fail visibly if upstream anchors changed.
if [[ -f "$ROOT/pi/agent/patches/powerline-dj.py" ]]; then
  python3 "$ROOT/pi/agent/patches/powerline-dj.py"
fi

# Align footer groups and enable the context meter used by settings.json.
if [[ -f "$ROOT/pi/agent/patches/powerline-layout.py" ]]; then
  python3 "$ROOT/pi/agent/patches/powerline-layout.py"
fi

# Inset the whole Pi viewport before removing the editor's old private gutter.
if [[ -f "$ROOT/pi/agent/patches/pi-horizontal-inset.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-horizontal-inset.py"
fi

# Frame the existing editor without replacing its input/autocomplete owner.
if [[ -f "$ROOT/pi/agent/patches/powerline-editor.py" ]]; then
  python3 "$ROOT/pi/agent/patches/powerline-editor.py"
fi

# Render fenced Markdown code as full-width dark panels while retaining highlighting.
if [[ -f "$ROOT/pi/agent/patches/pi-markdown-code.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-markdown-code.py"
fi

# Display-only transcript preview: keep native tools, history and expansion intact.
if [[ -f "$ROOT/pi/agent/patches/pi-transcript.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-transcript.py"
fi

# Intercom's incoming messages share the transcript; delivery stays package-owned.
if [[ -f "$ROOT/pi/agent/patches/intercom-ui.py" ]]; then
  python3 "$ROOT/pi/agent/patches/intercom-ui.py"
fi

# Agents' pickers, confirmations and editors use these shared native dialogs.
if [[ -f "$ROOT/pi/agent/patches/pi-extension-dialogs.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-extension-dialogs.py"
fi

# Native notifications own wrapping, including continuation-line indentation.
if [[ -f "$ROOT/pi/agent/patches/pi-activity-notices.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-activity-notices.py"
fi

# Share short-window activity space without clipping extension-owned content.
if [[ -f "$ROOT/pi/agent/patches/pi-compact-layout.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-compact-layout.py"
fi

# Add idle breathing room while keeping active loaders flush to the editor.
if [[ -f "$ROOT/pi/agent/patches/pi-editor-gap.py" ]]; then
  python3 "$ROOT/pi/agent/patches/pi-editor-gap.py"
fi

# Re-apply local tints on installed pi packages
if [[ -f "$ROOT/pi/agent/patches/rpiv-todo-gray.py" ]]; then
  python3 "$ROOT/pi/agent/patches/rpiv-todo-gray.py" || true
fi

# Match extension-owned activity surfaces to the transcript, after legacy todo tweaks.
if [[ -f "$ROOT/pi/agent/patches/rpiv-todo-ui.py" ]]; then
  python3 "$ROOT/pi/agent/patches/rpiv-todo-ui.py"
fi
if [[ -f "$ROOT/pi/agent/patches/subagents-ui.py" ]]; then
  python3 "$ROOT/pi/agent/patches/subagents-ui.py"
fi

# Jev decisions go directly to TypeSafe; GPT generation stays on Codex auth.
if [[ -f "$ROOT/pi/agent/patches/jev-direct.py" ]]; then
  python3 "$ROOT/pi/agent/patches/jev-direct.py"
fi

# npm restores its bundled bin on update; our host patches need the unbundled CLI.
# Preserve config-only installation on machines that do not have Pi yet.
if command -v pi >/dev/null 2>&1; then
  python3 -B "$ROOT/pi/launcher.py"
else
  echo "Pi not installed; skipping launcher selection"
fi

echo
echo "done. edit files under: $ROOT"
echo "secrets: put exports in ~/.zshrc.local (sourced if present)"
echo "new laptop: git clone <repo> ~/dev/dotfiles && cd ~/dev/dotfiles && ./install.sh"
