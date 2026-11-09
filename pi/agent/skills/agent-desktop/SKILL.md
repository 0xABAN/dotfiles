---
name: agent-desktop
tags: computer-use, desktop-automation, accessibility, ai-agent, gui-automation, cli
requirements:
  - agent-desktop
description: >
  Operate desktop applications on macOS, Windows and Linux through native accessibility trees,
  using the agent-desktop CLI. Use when an AI agent must see or act on a desktop GUI:
  click buttons, fill forms, read UI state, navigate menus, toggle checkboxes, scroll,
  drag, type text, press shortcuts, take screenshots, manage windows, use the clipboard,
  launch or close apps, read notifications.
  Triggers on: "click button", "fill form", "open app", "read UI", "computer use",
  "operate desktop", "accessibility tree", "snapshot app", "type into field", "navigate menu",
  "toggle checkbox", "take screenshot", "desktop automation", "agent-desktop",
  or any desktop GUI task on macOS, Windows or Linux.
---

# agent-desktop

agent-desktop reads and operates desktop apps through the OS accessibility tree. Every command prints one JSON envelope.

This file is a discovery stub, not the usage guide. Before the first `agent-desktop` command, load the guides that match the installed version and follow them:

```bash
agent-desktop skills get desktop      # the loop, refs, verification and retry rules
agent-desktop skills get platform     # what differs on macOS
```

Run `agent-desktop <command> --help` for one command's flags.
