# Maintaining the Pi configuration

This directory owns Pi configuration and the `pi` launcher. The files in
`agent/` are symlinked into `~/.pi/agent`, so edits here take effect directly.

## The `pi` command

`bin/pi` runs the Pi fork in `~/dev/pi` straight from its TypeScript source.
Edits to the fork take effect on the next start; no build is needed. It uses
Pi's default config folder, `~/.pi/agent`, and `settings.json` loads the
extensions in `~/dev/pi-extensions` as one collection package, alongside
`pi-goal` and `pi-rewind-hook`.

`bin/pi` is linked to `~/.local/bin/pi`, which must come before any other `pi`
on `PATH`. Both checkouts need their dependencies:

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

Use `/mcp`, `/mcp reconnect <server>`, and `pi mcp list` for connection status.
Within `codemode`, use `searchTools`, `describeTool`, and `describeNamespace`,
then call the discovered `tools` functions. Explicitly emit text with `text()`
and screenshots with `image()`. The old `mcp`/`mcpScript` gateway API is gone.

Claude bridge authenticates through Claude Code, independently of Pi's
`/login anthropic`. Check `claude auth status` and use `claude auth login`
when Claude Code is logged out; refreshing Pi's tokens does not refresh the
bridge's credentials.

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
