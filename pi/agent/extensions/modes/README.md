# Modes

Build, Plan, and Learn share one controller for the mode shortcut, tool permissions,
and status badge.

## Controls

- `Shift+Tab`: Build → Plan → Learn → Build.
- `/plan` or `Ctrl+Alt+P`: toggle Plan and Build; enter Plan from Learn.
- `/learn`: toggle Learn and Build; enter Learn from Plan.
- `--plan` or `--learn`: choose a startup mode, overriding saved state.
  Learn wins if both flags are set.

Wait for the current turn to finish, or cancel it, before switching modes.
The mode follows the active session branch and survives `/reload` and resume.
Returning to Build restores the tools active before entering Plan or Learn.
Use Pi's `/thinking` command to select the thinking level.

## Learn

The agent helps you reason through a task without doing it for you. It asks for
predictions or attempts, gives feedback, explains missing prerequisites, and
checks understanding with a new case. It asks one question at a time. When you
are stuck, it offers a clearer hint or a smaller subproblem rather than repeating
the same question.

The teaching policy prohibits task answers, completed code, exact fixes, and
solutions disguised as pseudocode or prose. You can ask for a concept explanation
or a stronger hint; asking for the answer does not disable the policy.

Only `read`, `grep`, `find`, and `ls` are available. The tool-call guard also blocks
inactive and nested tools, including shell execution, codemode, delegation,
remote actions, and Todo updates. You write the code and run experiments yourself.
Existing source files and tool results remain visible; Learn does not redact them.

The controller injects the teaching policy each turn through `appendSystemPrompt`,
which the Claude bridge forwards. Leaving Learn removes only that policy and
preserves other appended instructions.

Tool restrictions are enforced in code. Teaching behavior relies on the model
following its instructions, so this is not a guarantee against answer leakage.

### Appearance

All mode icons share the same neutral color. Learn keeps its graduation-cap icon.
Everforest Hard and Medium use a foreground → muted teal → yellow gradient
(`#D3C6AA` → `#7FBBB3` → `#DBBC7F`) for Learn's mode and thinking badges. Build
keeps its green accent and Plan its purple. Rose Pine uses gold for Learn; other
themes use warm peach.

### Inspiration

[CodeHelp](https://github.com/liffiton/gen-ed) informed the concepts-and-hints
boundary. Its [classroom evaluation](https://arxiv.org/html/2308.06921) reports
positive student feedback, not a controlled improvement in learning outcomes.
Our teaching instructions are original; we do not copy its implementation or add
its response-rewriting pipeline.

## Plan

Plan disables built-in `edit` and `write`, preserves other active tools including
`todo`, and filters Bash commands through the existing allowlist. It is not a
sandbox for other extensions or arbitrary shell syntax.

Ask the agent to explore the code and produce numbered steps under `Plan:`:

```text
Plan:
1. First step description
2. Second step description
```

After a plan, choose Execute, Stay, or Refine. Execute returns to Build and reminds
the agent to seed the steps into an rpiv-todo list before working through them.
The reminder is not a tool gate.

## Checks

From the repository root:

```sh
bun pi/agent/extensions/modes/check.mjs
```

The check covers mode transitions, direct and nested tool guards, prompt cleanup,
session state, legacy Plan entries, and distinct Learn colors. It does not call a
model. After `/reload`, check the visible badge and try a learning conversation:
ask for a solution, describe a mistaken attempt, then ask for a prerequisite
explanation. The agent should give useful guidance without completing the task.
