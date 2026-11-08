# Maintaining the Pi configuration

This directory owns Pi configuration and the `pi` launcher.
Run `./install.sh` from the repository root to set everything up.

## The `pi` command

`bin/pi` runs the Pi fork in `~/dev/pi` straight from its TypeScript source.
Edits to the fork take effect on the next start; no build is needed. It uses
Pi's default config folder, `~/.pi/agent`, and `settings.json` loads the
extensions in `~/dev/pi-extensions` as one collection package, alongside
`pi-goal` and `pi-rewind-hook`.

`install.sh` clones both checkouts when they're missing, installs their
dependencies, and links `bin/pi` to `~/.local/bin/pi`. `~/.local/bin` must come
before any other `pi` on `PATH`. The dependency steps it runs are:

```sh
cd ~/dev/pi
npm ci --ignore-scripts
npm run hydrate:model-data

cd ~/dev/pi-extensions
bun install --frozen-lockfile --ignore-scripts
```

Update Pi itself with git in `~/dev/pi`. Running from source, `pi update` only
updates packages; it never reinstalls npm Pi.

Check the launcher with:

```sh
bash -n bin/pi
pi --version
```

## Native MCP and codemode

`defaultTools: ["+codemode"]` adds native code execution/discovery without
replacing the ordinary tool selection. MCP tools use native codemode exposure;
`pi-mcp-adapter` is no longer installed. Native MCP does not support MCP Apps
interfaces.

Keep machine-local server definitions and secrets in `~/.pi/agent/mcp.json`.
The native schema uses `enabled: false`, not `disabled: true`, and does not read
the adapter's `imports` or `settings`. Servers previously imported from OpenCode
must have complete definitions here; changes in OpenCode no longer sync into Pi.
The example configures only Cua Driver.

Use `/mcp`, `/mcp reconnect <server>`, and `pi mcp list` for connection status.
Within `codemode`, use `searchTools`, `describeTool`, and `describeNamespace`,
then call the discovered `tools` functions. Explicitly emit text with `text()`
and screenshots with `image()`. The old `mcp`/`mcpScript` gateway API is gone.

Claude bridge authenticates through Claude Code, independently of Pi's
`/login anthropic`. Check `claude auth status` and use `claude auth login`
when Claude Code is logged out; refreshing Pi's tokens does not refresh the
bridge's credentials.

## Computer use

Computer use runs through the `cua-driver` server and Pi's native MCP support.
Pi supplies the current model and authentication; Cua Driver supplies desktop
observations and actions. No separate model API key is needed.

Install the driver using the [official installer](https://cua.ai/docs/start-here/drive-your-first-app):

```bash
curl -fsSL https://cua.ai/driver/install.sh -o /tmp/cua-driver-install.sh
/bin/bash /tmp/cua-driver-install.sh --no-modify-path
~/.local/bin/cua-driver permissions grant
~/.local/bin/cua-driver permissions status
```

Enable CuaDriver in macOS Accessibility and Screen & System Audio Recording
settings. Restart the driver if macOS requests it. Permission status must
reflect CuaDriver's daemon, not a terminal's existing grants.

The repository's `install.sh` creates and loads a per-user LaunchAgent. It
starts `CuaDriver.app` with `serve --grant existing-profile` at login and keeps
the daemon running. This is where the existing-profile grant belongs. The tracked
`agent/mcp.json.example` starts the MCP client with plain `cua-driver mcp`;
ensure `~/.local/bin` is on `PATH`. Do not put `--grant` on the MCP command:
it cannot change a daemon that's already running. For an existing installation,
merge the plain MCP entry into `~/.pi/agent/mcp.json`, using the absolute binary
path reported by `~/.local/bin/cua-driver mcp-config`. The dotfiles installer
preserves this machine-local file, including its other servers and secrets.

Run `/reload` in Pi, then `/mcp reconnect cua-driver` and ask for the task.
Discover tools through `codemode`; emit screenshot blocks with `image()` so
the current model can inspect them. A single native MCP connection preserves
the driver's implicit session across observation and action calls.

## Where changes belong

| Path | Responsibility |
|------|----------------|
| `bin/pi` | Launcher that runs the fork from source |
| `agent/settings.json`, `keybindings.json` | Package selection and user-facing configuration |
| `agent/themes/`, `skills/` | Theme data and skills |
| `agent/AGENTS.md` | Global agent instructions, shared with Codex |
| `agent/APPEND_SYSTEM.md` | Git commit policy, appended to Pi's system prompt |

Themes live in family folders under `agent/themes/`, alongside their licenses.
The `themes: ["themes"]` setting discovers them recursively. Run `/reload` after
theme edits; Pi’s automatic theme watcher only watches root-level files.

Our extensions belong to the separate `~/dev/pi-extensions` checkout, and Pi
itself to the fork in `~/dev/pi`. Keep sessions, credentials, installed
packages, and runtime locks out of commits.

The mode controller cycles Build → Plan → Learn with Shift+Tab. Plan and Learn
share one read-only tool set, and Learn teaches with concepts, hints, and pointers
into primary docs rather than task solutions. Everforest gives it a graduation-cap icon in the same
neutral color as Build and Plan, with a distinct muted-teal gradient for the
label.
See [mode controls and checks](https://github.com/0xABAN/pi-extensions/tree/main/modes).
