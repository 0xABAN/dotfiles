# dotfiles

Neovim + Pi coding-agent configs. Clone on a new machine and run `./install.sh`.

## Layout

```
zsh/.zshrc            → ~/.zshrc  (no secrets; source ~/.zshrc.local)
nvim/                 → ~/.config/nvim  (AstroNvim v6 + osaka-jade)
ghostty/themes/       → ~/.config/ghostty/themes/ (osaka-jade for cmux)
ghostty/shaders/      → ~/.config/ghostty/shaders/ (static grain)
pi/agent/             → ~/.pi/agent/* (selected paths)
  AGENTS.md           → ~/.pi/agent/AGENTS.md + ~/.codex/AGENTS.md
  mcp.json.example    → copy to mcp.json locally (secrets)
pi/rpiv-todo/config.json → ~/.config/rpiv-todo/config.json
```

## Install

Requires Git and [Bun](https://bun.sh) for the Pi extension dependencies.

```bash
git clone git@github.com:0xABAN/dotfiles.git ~/dev/dotfiles
cd ~/dev/dotfiles
chmod +x install.sh
./install.sh
```

Existing checkouts can stay at `~/dev/configs` to preserve installed symlinks; use that path instead of `~/dev/dotfiles` in the commands below.

Existing files are renamed `*.bak.<timestamp>` before linking. The installer also removes `~/AGENTS.md` (backing up a regular file first) so Pi loads only the shared global file and repository instructions.

## Colors

`osaka-jade` keeps the reference's charcoal surfaces, with **`#439187`** as
the shared teal accent across Neovim, Pi, and cmux/Ghostty. Its darker
companion, **`#326d65`**, is for subtle borders, dividers, and cmux workspace
selection—not syntax or primary text.

The terminal owns the charcoal base background and its opacity. Neovim's
base highlights use `NONE`; Pi's base background variable uses `""` (terminal
default). Neither paints another charcoal layer over the terminal. Panels
(`#181a20`) and colored selections retain their explicit backgrounds. Terminal text
selections (including Pi) and Neovim Visual mode use light lime (`#a8d86e`) with
white text (`#ffffff`), matching the bracket highlights. Completion selections
keep the core teal (`#439187`); search/diff backgrounds remain neutral (`#282c30`).
Prose uses soft white (`#D8DAD8`), with
near-white (`#F2F3F0`) for emphasis. Variables, strings, headings, editor
status text, and Pi tool output use cream (`#dedec5`). Numeric literals retain
the warning yellow (`#c7b777`) as a rare syntax accent; types and status warnings use sage (`#5fa876`).
Neovim's existing syntax palette remains distinct by token role. Matching
delimiters use light lime (`#a8d86e`) backgrounds with white text, including the
bracket under the cursor. `nvim/plugin/match-cursor.lua` hides the terminal cursor
over that cell only while a native match is active in Normal mode; moving away
restores the ordinary cursor and its animation settings. Active LSP reference/UI
highlights use the same light lime. Syntax colors and the core teal UI accent
remain unchanged.
Pi follows its existing token classes: literals such as booleans share the
number role, built-ins share the type role, and some C++ types such as `int`
remain keywords (teal). Pi's active highlights, success states, and additions
use the core teal, as do terminal ANSI green/cyan, Pi's diamond,
and its context ball/meter. Neovim window dividers and dashboard entries use
white (`#ffffff`). Neovim floating-window borders and Pi's muted/Markdown
borders use the darker companion. Mode/thinking
label gradients and error colors retain their existing palettes.
Outside selections, large surfaces never use green fills.
Supporting neutrals and subdued warning/error colors are chosen to fit;
ANSI colors use the same restrained treatment. No theme plugins required.

Pi and Neovim select it by default. The installer links the terminal theme and
grain shader; activate them in `~/.config/ghostty/config` (also used by cmux):

```ini
theme = osaka-jade
background-opacity = 0.90
background-blur = 30
background-opacity-cells = true
custom-shader = ~/.config/ghostty/shaders/grain.glsl
custom-shader-animation = false
```

Remove explicit background/foreground/selection overrides if they override
the theme. Also check `cmux themes list`: cmux's own theme override in
`~/Library/Application Support/com.cmuxterm.app/config.ghostty` takes
precedence over the shared Ghostty theme. Back up that file, then run
`cmux themes clear` to inherit the shared palette. `ghostty +show-config`
alone does not reveal this override. The old Black Metal override is backed
up locally in `~/.config/theme-backups/cmux-20260913-015205/`.

Merge these appearance keys into `~/.config/cmux/cmux.json`, preserving
unrelated settings and any other workspace-color options. The active-pane
outline stays disabled, and split dividers keep their default color:

```json
{
  "activePaneBorderColor": null,
  "paneBorderColor": null,
  "workspaceColors": {
    "selectionColor": "#326d65",
    "notificationBadgeColor": "#439187"
  }
}
```

Opacity 0.90 lets more of the backdrop show beneath the grain; blur 30
keeps visible detail soft. The glass effect is subtle and depends on the wallpaper
and windows behind cmux; a flat dark backdrop will still look dark.
Base surfaces inherit one translucent background consistently across the shell,
Pi, and Neovim. Adjust opacity and blur here, not separately per app.
Use opacity 1 for an opaque background. The previous 0.96/20 settings are backed
up locally in `~/.config/theme-backups/cmux-glass-20260913-091911/ghostty-config`.

The static shader draws faint monochrome grain below terminal content, leaving
opaque text unchanged. Its `GRAIN_OPACITY = 0.006` adds only 0.6% coverage above
the host backdrop: at 90% background opacity, the combined opacity is about
90.06%. Animation is disabled. It affects terminal panes, not cmux's sidebar.

Replace the previous `custom-shader` entry and remove the old `background-image*`
settings. Do not use the PNG grain tile: cmux 0.64.22 already paints a translucent
host background, and its Ghostty image renderer adds a second background fill.
At the previous 92%, those stacked fills produced about 99.4% opacity,
hiding the glass. Even a transparent PNG takes that same fill path. See the revision-pinned
[image compositor](https://github.com/manaflow-ai/ghostty/blob/6143bac/src/renderer/shaders/shaders.metal#L423-L443)
and [host-background handling](https://github.com/manaflow-ai/ghostty/blob/6143bac/src/renderer/generic.zig#L1715-L1741).
The pre-shader config and passthrough are backed up locally in
`~/.config/theme-backups/cmux-grain-shader-20260913-112526/`.

Run `cmux reload-config` to apply terminal appearance without restarting sessions.
Select `osaka-jade` in Pi's `/settings`, and restart Neovim
(or run `:colorscheme osaka-jade`) for existing sessions.

The original `woody` Pi and Neovim themes remain unchanged. The initial
switch also saved active settings under
`~/.config/theme-backups/woody-20260913-014121/` on this machine, including
Ghostty/cmux settings, Pi settings, and Neovim UI/cursor configuration.
Restore those files to recover the previous appearance, or select `woody`
in Pi and Neovim to switch just their palettes.

Checks: `nvim --headless -u NONE -l nvim/tests/osaka-jade.lua`,
`nvim --headless -u NONE -l nvim/tests/match-cursor.lua`, and
`ghostty +validate-config` after terminal activation. On macOS,
`swift -suppress-warnings ghostty/tests/grain.swift` compiles the actual GLSL
with system OpenGL and checks GPU pixels for alpha, grain, and text preservation.
Also verify live cmux rendering: config validation alone does not compile shaders.

## Shell navigation

Install the shell dependencies with `brew install fzf zoxide zsh-autosuggestions`,
then open a new shell. `cd` uses zoxide to learn frequently visited directories;
`cdi` opens its fuzzy picker. Inline suggestions come from command history, not
zoxide's directory ranking. Pressing Enter on a partial directory name still
jumps to zoxide's best match. History is saved in `~/.zsh_history`.

Tab accepts a visible inline suggestion when the cursor is at the end of the
line; otherwise it performs normal completion. Enter still runs the command.

## Secrets (never committed)

| File | Why |
|------|-----|
| `~/.zshrc.local` | API keys / machine exports |
| `~/.pi/agent/mcp.json` | API sessions / tokens |
| `~/.pi/agent/auth.json` | Provider auth |
| `sessions/`, caches, `npm/` | Machine-local runtime |

After install, set `LEETCODE_SESSION` (and any other keys) in `mcp.json`, or export them in your shell and point env there.

## Pi extensions

See the [Pi maintenance guide](pi/README.md) for code ownership, patch contracts,
and test setup.

Extension code lives in [pi-extensions](https://github.com/0xABAN/pi-extensions), not in a second copy here. Pi settings reference its top-level `inline-skills/` and `dj/` packages under `~/dev/pi-extensions`.

`./install.sh` clones that repository when missing, validates both packages, and installs dependencies from its lockfile without running package scripts. It never pulls over existing work; missing packages or failed dependency installation stop before changing config links. Edit extensions in that checkout, then `/reload` in Pi. Other existing extensions remain under `pi/agent/extensions`.

DJ replaces the old `agent-dj.ts` copy. Use `/dj theme`, `/dj layout`, and `/dj placement`; `/dj` toggles visibility. Existing Spotify credentials and placement are imported once into `~/.pi/agent/dj/` (machine-local, never committed). If reconnection is needed, use `/dj auth`, not the legacy Python install command, which can recreate the old Pi extension. See the [DJ guide](https://github.com/0xABAN/pi-extensions/tree/main/dj).

The installer patches the installed powerline package so below-editor rows stay **powerline → DJ → last prompt**, without DJ replacing the prompt. After updating/reinstalling powerline, run `python3 pi/agent/patches/powerline-dj.py` from this checkout, then `/reload`. The patch skips missing installs and refuses changed upstream code rather than guessing.

The footer layout patch puts model/branch on the left and reported cost plus
an opt-in five-cell context meter on the right. Mode/effort and response time
live in the input's top border, not duplicated in the footer. The labels read
`  build mode` and the prefixed effort, such as `think:xhigh`. Mode icons and
names stay intact
even in compact panes.
The build gradient runs white → pale teal (`#daebe8`) → light beige;
plan keeps its purple midpoint.
The context ball shares
the meter's color, including warning/critical states, and remains visible when
cost is hidden. Subscription cost is the provider-reported
estimate, not a subscription bill. DJ placement is unchanged.

After a powerline update, run `python3 pi/agent/patches/powerline-layout.py`,
then `/reload` in Pi. The installer also applies it. Changed or partial
upstream anchors stop without writing; do not force the patch through an
unreviewed update. Test with `bun test pi/agent/tests/powerline-layout-patch.test.ts`.

Pi uses a shared horizontal inset of roughly **2% per side** (at least one
column), rather than separate margins on the input and statusline. The host
patch keeps conversation output, tools, widgets, menus, and the footer inside
that viewport in regular and fullscreen modes. Ghostty, the shell, and Neovim
are unchanged. Raw CLI diagnostics and programs writing directly to the terminal
are not reflowed.

The editor patch adds the rounded `╭╮╰╯` frame without a second outer inset.
It reserves space before text wrapping and keeps scroll indicators,
completion rows, paste handling, and hardware cursor markers. Tiny terminals
fall back to the host editor. Mode/effort labels interrupt the top border near
the right corner. A charcoal-on-sage (`#121319` on `#5FA876`) response-time badge comes first,
with three spaces before `  build mode ❯ think:xhigh` and no chevron beside
it. Response time yields first when space is tight, then thinking. If the
complete mode label still cannot fit, the border keeps the scroll hint without
any badges. Working
status stays outside the box, within the shared viewport. Keep **pi-pretty before
powerline** in `settings.json`'s packages list: both install an editor during
`session_start`, and Pi awaits those handlers in package order. Powerline must
run last to retain the framed editor and bash controls; pretty's output
formatters remain active.

Response time shows the latest completed main-model response's observed wall
clock duration. Timing starts before provider I/O, so it includes local request
preparation and first-token wait, but excludes tool execution. It is formatted
compactly as seconds, then minutes and seconds, then hours and minutes, such as
`0.8s`, `1m 05s`, or `2h 03m`. The last reading stays between responses;
errors and cancellations do not replace it. Reload, new sessions and tree
navigation reset it; no timings are inferred from history or persisted. The
badge is display-only, not a clickable control. Run `/reload` after updating
these local extensions and the guarded powerline editor patch.

The host patch targets **Pi 0.87.1**; review it before upgrading Pi. To replay
the host and editor patches, run the following, then **restart Pi**;
`/reload` alone cannot reload the host renderer:

```sh
python3 pi/agent/patches/pi-horizontal-inset.py
python3 pi/agent/patches/powerline-editor.py
```

The installer applies the host inset before the editor patch. These guarded
patches follow the installed host's rendering contracts and refuse incompatible
sources rather than guessing. Rerun the real-host integration checks after updates:

```sh
PI_SDK_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" \
  bun test pi/agent/tests/pi-horizontal-inset-patch.test.ts \
    pi/agent/tests/powerline-editor-patch.test.ts
```

### Transcript preview

The Pi 0.87.1 transcript patch adds `◆ You` / `● Pi` headers and compact
geometric action trees. Pi's `●` uses sage (`#5fa876`); `◆ You` and
action icons keep the teal accent. Speaker names retain the normal text color.
Single tools have no count heading or tree connector. Two or more
consecutive visible tool rows share a counted action tree, with status and action
names aligned to the single-tool row. Action names such as **Search** and **Read**
are bold; arguments and timing keep their existing weight. Narration and custom
messages remain in place. Normal user messages inherit the terminal
background rather than using a filled box. Each ends with a thin cream separator
(`#dedec5`, the theme's `toolOutput` tone), aligned with the editor body's gutter.
The existing input/footer are unchanged.

Every collapsed tool uses the same row, including custom and silent renderers.
Native path/command labels remain; web tools use **Web**, MCP scripts **Batch**,
agent workflows **Flow**, questions **Ask**, and todos **Tasks**. Both incoming
and outgoing Intercom messages use **⇄ Chat**.
Unknown operations use **Tool**; MCP management/discovery uses **MCP**. Web/MCP
rows show the underlying invocation and named arguments, not a second text card:

```text
✓ ◎ Web   exa/web_search_exa(query="…", numResults=5) 1.2s
✓ ⌇ Tool  server/unknown_operation(id="…") 0.3s
```

Terminal controls and credential fields/URL credentials are removed from argument
previews; originals remain unchanged. Long previews truncate, and expansion wraps
arguments (up to 50K characters/20 levels) and restores native detailed renderers.
This is not a general secret scanner for free-form scripts, commands or result
bodies. Native images stay inline even when custom text cards are hidden.
Errors retain summaries; known web/MCP partial failures or actionable feedback
use `!`. Browser approval waits retain an expansion hint. Native approval and
question interfaces are unchanged.

Expanded default-shell cards share the transcript's horizontal gutters. Narrow
panes reclaim the extra gutter; self-framed renderers and images keep their own
geometry. There are no per-row click controls. Component order is preserved;
mixed text/tool/text blocks inside one assistant message are not split.

Completed compact rows append result counts and elapsed call time directly after
the statement, separated by one space, for example `README.md 152 lines · 1.2s`.
Short statements do not stretch to fill the row. Narrow rows use `152L 1.2s` or
`2ed 1.2s`, truncating the path first; when necessary, counts yield to timing.
At widths too small for both a status and timing, the status takes precedence.
This uses each row's available width after existing gutters, not terminal width.
Errors retain their separate summary row.

Read reports source lines returned, excluding continuation notices; Write reports
lines written; Edit reports replacement blocks applied, not diff line counts.
An empty string has zero lines; a final newline does not add an extra line.
These counts come from native result metadata, not parsed output banners.
Other tools get timing only. Missing metadata on older results is left blank.
Tool execution, model-visible result text, expansion, and images are unchanged.

Elapsed time runs from the observed tool-start event to tool-end, including
preparation, queues, and hooks; it is not subprocess CPU time. Each new timing
is stored in `configsToolTiming` on the existing tool-result **session entry**,
not its message body, and recovered from the active branch on resume/rebuild.
It shares the canonical result write: no extra history node, disk write, or
model-context message. Parallel calls are tracked by tool-call ID. Old calls
and calls cancelled before starting have no inferred duration. Native result
persistence and its error behavior are unchanged. The count metadata is stored
in native tool-result `details`.

The installer applies the patch with version/anchor checks and complete backups.
To replay:

```sh
python3 pi/agent/patches/pi-transcript.py
PI_SDK_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" \
  bun test pi/agent/tests/pi-transcript-patch.test.ts pi/agent/tests/pi-tool-metrics.test.ts
```

Restart Pi to apply host changes; `/reload` alone is not enough.

### Intercom

Incoming messages use `✓ ⇄ Chat From <sender>`, aligned with standalone tool
rows, with a one-line preview indented beneath it. Only the **Chat** label is
bold, matching outgoing calls' label and the other action rows. Tool-output
expansion reveals the full body, sender/message metadata, reply hint and
attachments. Outgoing calls stay ordinary tool rows, so consecutive sends share
an action tree and show `⇄ Chat intercom(action="send", to=…)` plus timing.
Expanding restores Intercom's native call/result renderers. Delivery, reply
tracking, stored messages and model-visible content are unchanged.

The guarded package patch targets **pi-intercom 0.13.0**, alongside the Pi 0.87.1
transcript patch. After reinstalling the package, replay both and restart Pi:

```sh
python3 -B pi/agent/patches/pi-transcript.py
python3 -B pi/agent/patches/intercom-ui.py
```

The installer and upgrade checker include both steps. Offline terminal checks
use the real renderer callbacks with synthetic registration/messages, not a live
Intercom broker or peer. They verify collapsed and expanded output in both modes.

### Todos and Agents

The extension-owned Todos and Agents surfaces follow the transcript's palette,
rounded trees, and geometric status glyphs. Activity uses a three-column body
inset inside the existing host viewport, not another terminal-wide margin.
Labels stay white/cream, metadata and completed rows are muted, and errors stay
visible. Agent names no longer use filled badges; real selection highlights remain.

This covers the persistent widgets, inline tool output and notifications, plus
Agents' FleetView, menus, and conversation/workflow panels. Task/agent state,
commands, keyboard controls, expansion, and execution are unchanged. `/todos`
remains a notification, not a new panel.

The guarded patches target **rpiv-todo 2.9.0** and **pi-subagents 0.19.0**. The
installer runs them after the older todo tweaks. Native notifications, pickers,
confirmations, and editors share **Pi 0.87.1** host patches, so wrapped lines
align and open dialogs refresh their theme too. These shared components also
style the same dialogs used by other extensions. Apply once and **restart Pi**:

```sh
python3 pi/agent/patches/pi-extension-dialogs.py
python3 pi/agent/patches/pi-activity-notices.py
```

After reinstalling either extension package, replay its patch and `/reload`:

```sh
python3 pi/agent/patches/rpiv-todo-ui.py
python3 pi/agent/patches/subagents-ui.py
```

They back up changed files and refuse unknown or incompatible sources. Review
before upgrading the packages; do not force patches through changed anchors.

## Sync workflow

Commit and push changes in the repository that owns them. For extension folder moves, push `pi-extensions` before the corresponding `dotfiles` update so new installs can find the referenced paths.

```bash
# on machine A after edits
cd ~/dev/dotfiles && git add -A && git commit -m "..." && git push

# on machine B
cd ~/dev/dotfiles && git pull --ff-only
cd ~/dev/pi-extensions && git pull --ff-only
# re-run ~/dev/dotfiles/install.sh if paths or extension dependencies changed
# then run /reload in Pi
```
