# Maintaining the Pi configuration

This directory owns Pi configuration, local extensions, and compatibility patches.
Run `./install.sh` from the repository root to link configuration and apply patches.

## Native MCP and codemode

This configuration targets Pi **1.0.0**. `defaultTools: ["+codemode"]` adds
native code execution/discovery without replacing the ordinary tool selection.
MCP tools use native codemode exposure; `pi-mcp-adapter` is no longer installed.
Native MCP does not support MCP Apps interfaces.

Keep machine-local server definitions and secrets in `~/.pi/agent/mcp.json`.
The native schema uses `enabled: false`, not `disabled: true`, and does not read
the adapter's `imports` or `settings`. Servers previously imported from OpenCode
must have complete definitions here; changes in OpenCode no longer sync into Pi.
The example leaves LeetCode disabled until its credentials are configured.

Use `/mcp`, `/mcp reconnect <server>`, and `pi mcp list` for connection status.
Within `codemode`, use `searchTools`, `describeTool`, and `describeNamespace`,
then call the discovered `tools` functions. Explicitly emit text with `text()`
and screenshots with `image()`. The old `mcp`/`mcpScript` gateway API is gone.

The Subagents SDK patch registers these same built-in factories for child
sessions, respecting extension allowlists and isolation. Deferred MCP tools stay
out of model prompts unless explicitly activated. Tool restrictions cover both
direct and nested calls through Pi 1.0's private `_beforeToolCall` hook; review
that boundary before upgrading. The researcher allows `builtin:mcp`,
`builtin:codemode`, and `builtin:tool-search` by name.

## Computer use

Computer use runs through the `cua-driver` server and Pi's native MCP support.
Pi supplies the current model and authentication; Cua Driver supplies desktop
observations and actions. No separate model API key is needed.

Install the driver using the [official installer](https://cua.ai/docs/start-here/drive-your-first-app):

```bash
curl -fsSL https://cua.ai/driver/install.sh -o /tmp/cua-driver-install.sh
/bin/bash /tmp/cua-driver-install.sh --no-modify-path
open -n -g -a CuaDriver --args serve
~/.local/bin/cua-driver permissions grant
~/.local/bin/cua-driver permissions status
```

Enable CuaDriver in macOS Accessibility and Screen & System Audio Recording
settings. Restart the driver if macOS requests it. Permission status must
reflect CuaDriver's daemon, not a terminal's existing grants.

The tracked `agent/mcp.json.example` launches `cua-driver mcp` from `PATH`;
ensure `~/.local/bin` is on `PATH`. For an existing installation, merge just
that server entry into `~/.pi/agent/mcp.json`, using the absolute binary path
reported by `~/.local/bin/cua-driver mcp-config`. The dotfiles installer
preserves this machine-local file, including its other servers and secrets.

Run `/reload` in Pi, then `/mcp reconnect cua-driver` and ask for the task.
Discover tools through `codemode`; emit screenshot blocks with `image()` so
the current model can inspect them. A single native MCP connection preserves
the driver's implicit session across observation and action calls.

## Where changes belong

| Path | Responsibility |
|------|----------------|
| `agent/settings.json`, `keybindings.json`, `subagents.json` | Package selection and user-facing configuration |
| `agent/extensions/` | Local extension entrypoints and lifecycle handlers |
| `agent/extensions/plan-mode/` | Mode transitions, command policy, and status formatting |
| `agent/extensions/whimsical/` | Animation catalog, frame generation, and compaction-loader adapter |
| `patches/*.py` | Target-specific anchors, compatibility rules, and patch commands |
| `patches/patch_support.py` | SDK discovery, exact source loading, backup/write mechanics, and counted replacements |
| `patches/payloads/` | Renderer source grouped by `host`, `powerline`, `tui`, `todo`, `subagents`, and `intercom` |
| `agent/themes/`, `agents/`, `skills/`, `prompts/` | Theme data and agent instructions |
| `rpiv-todo/config.json` | Todo widget configuration |

Themes live in family folders under `agent/themes/`, alongside their licenses.
The `themes: ["themes"]` setting discovers them recursively. Run `/reload` after
theme edits; Pi’s automatic theme watcher only watches root-level files.

`whimsical.ts` remains the entrypoint; its helper directory has no `index.ts`.
Pi discovers top-level extension files and subdirectories with an entrypoint.
Keep helpers inside their feature directory so Pi does not load them as separate
extensions. Small extensions can stay in one file.

DJ and inline-skills belong to the separate `~/dev/pi-extensions` checkout.
Keep sessions, credentials, installed packages, and runtime locks out of
commits.

## Rendering boundaries

The host inset patch owns the outer viewport in regular and fullscreen modes.
The transcript owns speaker headers and tool invocation rows. Every call keeps a
row, even when its renderer is silent. Collapsed text cards never bypass it;
native images stay inline and expansion restores the original detailed bodies.
Built-in names retain their action labels. Explicit families cover Web, Agent,
Batch, Flow, Ask, Tasks, Goal, Chat and MCP; unknown operations use Tool.
Registered owner metadata identifies native MCP registrations and known package
error contracts, not exemptions from the shared layout.

Generic rows show actual named arguments, with terminal controls and credential
fields/URL credentials removed from the preview. Expansion wraps up to 50K
characters and 20 levels; free-form scripts and native result bodies are not
secret-scanned. The original arguments/results are never rewritten. Known web
and MCP errors retain summaries, partial failures/actionable feedback use `!`,
and browser approval waits keep an expansion hint.

Package renderers still own Todos, Agents and incoming Intercom messages, while
the host owns invocation rows, notification wrapping and native dialogs. Incoming
Intercom messages use `✓ ⇄ Chat From <sender>` at the standalone tool
indent, with an indented preview and expanded metadata, reply hint and
attachments. Outgoing calls use the same bold Chat label and ⇄ icon, but stay
ordinary tools: adjacent sends group in the native action tree. No execution,
delivery or stored/model content is changed. Do not add a second outer margin
to individual renderers.

The compact-layout host patch exposes `tui.configsActivityRows()` to our Todo and
Agent factories. Below 24 terminal rows, registered `rpiv-todos` and `agents`
widgets share at most one third of the rows, also reserving the native input
viewport/frame and footer/conversation space. Each retains at least one summary
row; at larger heights the limit is `Infinity`. This is a display-only preview
limit, not an expansion-state change. Packages choose their visible content and
overflow summaries. Unknown widgets do not participate. Read the callback during
rendering, not registration, so resizing and widget removal immediately update
the allocation.

Tool invocation rows cache one rendered width per native tool component in a
WeakMap. The native `updateDisplay()` revision invalidates changed arguments,
results, expansion and theme updates (via `invalidate()`); width and elapsed
metrics are checked separately. Native bodies and images remain uncached here,
and components without the revision contract use the pure formatter.

Keep theme reads live and preserve native components, cursor markers, image
payloads, selection, expansion, and session ordering. Use exact MCP operation
names for Web classification, never fuzzy matches such as any tool containing
"search". Only known package metadata may override display status; an arbitrary
extension's `details.error` can be domain data. The terminal owns the base background.

Pi 1.0's user-message Markdown cache and theme-aware `ThemedText` notices remain
native. The patches add layout only; do not restore a second user-message cache
or replace native notice invalidation/coalescing.

Plan-mode status formatting is pure; the entrypoint owns status publication,
tool restoration, and persistence. Whimsical's compaction adapter contains the
host-specific prototype hook. Keep that compatibility code out of its catalog.

### Compact windows

Below 80 available columns, inner gutters and powerline labels shrink. Below 24
terminal rows, previews share a smaller budget and decorative rows disappear.
These rules use the width passed to `render`, after the shared viewport inset.
Read terminal height live; Pi replaces the backing renderer when switching modes.

Native dialogs window their bodies around the selection or caret. Agent panels
retain their native selection and scrolling state; workflow details use Page Up
and Page Down. Settings descriptions may end in an ellipsis. Exceptionally tall
dialog titles/hints are not paged: there is no extra read-details step or resize
gate for extreme window sizes.

## Patch contracts

| Target | Supported input | Commands under `patches/` |
|--------|-----------------|--------------------------------|
| Pi unbundled host and package-local TUI | Pi `1.0.0` | `pi_horizontal_inset.py`, `pi_markdown_code.py`, `pi_transcript.py`, `pi_extension_dialogs.py`, `pi_activity_notices.py`, `pi_compact_layout.py`, `pi_editor_gap.py`, `pi_compaction_queue.py` |
| Powerline | Git commit `8c9bda10fdfd2822e89334ec85f3da9f8ca49182` | `powerline_dj.py`, `powerline_layout.py`, `powerline_editor.py`, `powerline_compaction_queue.py` |
| rpiv-todo UI | `@juicesharp/rpiv-todo` `2.9.0`, after legacy tweaks | `rpiv_todo_ui.py` |
| Subagents UI and native SDK tools | `@tintinweb/pi-subagents` `0.19.0`, Pi `1.0.0` | `subagents_ui.py`, `subagents-native-tools.py` |
| Intercom messages | `pi-intercom` `0.13.0` | `intercom_ui.py` (with host `pi_transcript.py`) |

Shared helpers do not decide compatibility. Each guarded patcher validates its
complete source set before writing. Preserve exact anchors and occurrence counts,
including legitimate overlaps and supported migrations. Powerline uses pinned
source anchors; its older write behavior differs from the newer backup-enabled
patchers. Do not silently give all patchers the same policy.

Payload files are exact source fragments, not necessarily standalone modules.
Their whitespace is part of patch identity. An extraction-only change must emit
the same bytes. For a changed installed helper, keep its exact previous source
under the owner's `legacy/` directory and accept it only after validating the
rest of the installation. Unknown or locally modified helpers must still fail.
Legacy payloads are migration inputs, not a second implementation to maintain.

The backup-enabled patchers save originals under `~/.config/theme-backups/`.
`added-files.json`, when present, lists newly created files; a migrated helper
that already existed belongs in the backup, not in that list. Restore originals
from the relevant backup and remove only files recorded as newly added.

The legacy `rpiv_todo_gray.py` also owns dependency-control removal and the
clear/persistence includes. Its failure policy and sequencing remain distinct.
The Todo UI patch recognizes only the exact clear-block reinjection it supports.
Do not change persistence as part of a visual cleanup.

`install.sh` owns the serial order: powerline DJ/layout/compaction queue, host
inset, editor, Markdown code panels, transcript, Intercom UI, dialogs, notices, compact layout,
editor gap, compaction queue, legacy Todo tweaks, Todo UI, Subagents UI and native
tools, then launcher selection.
The legacy Todo command remains best-effort; the other patch failures propagate.
Powerline owns the editor; Whimsical owns the working indicator.
Pi-pretty is not installed, so its indicator cannot override Whimsical.

### Which CLI runs the patches?

Pi 1.0.0 declares `dist/bundle/cli.js` as its npm `pi` command. That bundled
program contains its own host implementation; patching `dist/modes/...` does not
change it. `pi --version` alone cannot prove the customized host is running.

After its patch chain, `install.sh` selects the published `dist/cli.js`, which
loads the unbundled host and package-local TUI. **This is a published but private
compatibility boundary, not a documented upstream entrypoint guarantee.** The
installer checks the exact version, npm bin declaration and entry/setup bytes
before atomically repointing only the known npm-owned symlink. Unknown wrappers,
targets and modified entrypoints are refused. Package metadata and minified
bundles are never edited. An already-selected launcher is left unchanged.

The exact old link is saved as `pi` plus `launcher.json` under the printed
`~/.config/theme-backups/pi-launcher-*` directory. To roll back, verify the current
link still equals the recorded `replacement`, then replace only that symlink with
the recorded `target`; do not copy its resolved package file. A refusal leaves the
original link in place. Every npm update/reinstall may reset the link to the
bundled CLI; reapply the patches and launcher selection afterward.

`pi-clean` is separate: its launcher invokes its own unbundled `dist/cli.js`, whose
host is deliberately unpatched. Custom-host activation does not change it.

## Applying patches

Run the relevant patch command from the repository root, for example:

```sh
python3 -B pi/patches/pi_transcript.py
```

Host patchers discover the SDK that owns the actual `pi` command, not the package
under whichever `npm` happens to be on `PATH`. Set `PI_SDK_ROOT` explicitly when
validating an isolated installation. Version and source guards still apply.

`./install.sh` replays the complete patch chain and launcher selection. It is not
an upgrade transaction: the legacy Todo step is best-effort. Keep backups and
inspect failures rather than loosening compatibility guards.

Restart Pi for host or package-local TUI changes. Extension/package source
changes use `/reload`; a full restart also reloads them. Check the visible UI
after runtime changes. Commit only explicit owned files or hunks and keep
independently revertible changes separate.

## Host-provided extension dependencies

`host_peer_dependencies.py` repairs the installed manifests for Subagents 0.19.0,
Ask User Question/Todo 2.9.0, and Web Access 0.27.0. TypeBox belongs in wildcard
`peerDependencies`, alongside Pi's host modules, not in `dependencies`.
The patch preserves unrelated dependencies, backs up manifests, and refuses
unreviewed versions. It does not suppress Pi's warnings or prune shared npm
packages that other dependencies may still need.

The installer replays this repair. After updating or reinstalling packages, run:

```sh
python3 -B pi/patches/host_peer_dependencies.py
python3 -B pi/patches/host_peer_dependencies.py --check
```

Then `/reload` Pi to refresh package diagnostics.

## Package-update reminders

The activity-notices patch disables automatic extension-package update checks
at startup, removing the package-update reminder and its background lookups.
Manual `pi update --extensions`, Pi release notices, model-catalog refreshes and
real warnings/errors remain unchanged. This does not enable offline mode.

Apply with `python3 -B pi/patches/pi_activity_notices.py`, then restart Pi.
The installer replays this patch.

## Messages queued during compaction

Pi 1.0.0 can still go idle with pending messages when async input hooks finish
between its final queue check and run settlement. `pi_compaction_queue.py` adds
a synchronous queue recheck after the new `agent_before_settle` boundary. It
preserves native boundary hooks, context validation, abort guards, steering,
follow-up, and retry behavior without timers or bypassing input hooks.

Powerline's custom editor uses a separate persisted queue. Its 50 ms delivery
timer can run while later `session_compact` hooks are still executing. Pi then
rejects the prompt, but Powerline has already marked it sent. The host patch above
does not fix this path. `powerline_compaction_queue.py` keeps the item queued and
rechecks `ctx.isIdle()` using the existing cancellable timer before sending.

The installer replays both patches. After a reinstall, apply
them and **restart Pi**; `/reload` cannot reload the host session loop. For the
Powerline-only change, `/reload` is sufficient:

```sh
python3 -B pi/patches/pi_compaction_queue.py
python3 -B pi/patches/powerline_compaction_queue.py
```

The host patch backs up the original `dist/core/agent-session.js` and refuses
unknown versions or changed settlement code. Both patches back up before writing
and refuse changed anchors.
