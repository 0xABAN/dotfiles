#!/usr/bin/env bash
# Symlink tracked configs into place. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TS="$(date +%Y%m%d%H%M%S)"

echo "== pi fork checkout =="
PI_FORK="$HOME/dev/pi"
if [[ ! -e "$PI_FORK" && ! -L "$PI_FORK" ]]; then
  mkdir -p "$(dirname "$PI_FORK")"
  git clone https://github.com/0xABAN/pi.git "$PI_FORK"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required to run the Pi fork: https://nodejs.org" >&2
  exit 1
fi
(cd "$PI_FORK" && npm ci --ignore-scripts && npm run hydrate:model-data)

echo "== pi extensions checkout =="
EXTENSIONS="$HOME/dev/pi-extensions"
if [[ ! -e "$EXTENSIONS" && ! -L "$EXTENSIONS" ]]; then
  mkdir -p "$(dirname "$EXTENSIONS")"
  git clone https://github.com/0xABAN/pi-extensions.git "$EXTENSIONS"
fi
if [[ ! -f "$EXTENSIONS/package.json" ]]; then
  echo "missing $EXTENSIONS/package.json — update the checkout before installing" >&2
  exit 1
fi
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

echo "== rex =="
link "$ROOT/rex/init.lua" "$HOME/.config/rex/init.lua"
# Rex keeps themes in app settings, not init.lua, so the theme is imported by hand.
echo "rex theme: Settings > Theme > Import $ROOT/rex/themes/everforest-dark-hard"

echo "== nvim =="
mkdir -p "$HOME/.config"
link "$ROOT/nvim" "$HOME/.config/nvim"

echo "== pi agent =="
mkdir -p "$HOME/.pi/agent"
for name in \
  settings.json \
  keybindings.json \
  APPEND_SYSTEM.md \
  themes \
  skills
do
  link "$ROOT/pi/agent/$name" "$HOME/.pi/agent/$name"
done

echo "== pi launcher =="
link "$ROOT/pi/bin/pi" "$HOME/.local/bin/pi"

echo "== shared agent instructions =="
backup "$HOME/AGENTS.md"
link "$ROOT/pi/agent/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
link "$ROOT/pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md"

# secrets stay machine-local
if [[ ! -f "$HOME/.pi/agent/mcp.json" ]]; then
  cp "$ROOT/pi/agent/mcp.json.example" "$HOME/.pi/agent/mcp.json"
  echo "created ~/.pi/agent/mcp.json from example"
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

  link "$ROOT/launchagents/$launch_agent_label.plist" "$launch_agent_plist"
  launchctl bootstrap "$launch_agent_domain" "$launch_agent_plist"
else
  echo "CuaDriver.app is not installed; skipped its LaunchAgent"
fi

echo
echo "done. edit files under: $ROOT"
echo "secrets: store in Keychain, never exported: security add-generic-password -U -a $USER -s NAME -w"
echo "new laptop: git clone <repo> ~/dev/dotfiles && cd ~/dev/dotfiles && ./install.sh"
