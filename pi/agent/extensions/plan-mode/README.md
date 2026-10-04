# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Built-in write tools disabled**: Disables edit/write while preserving other active tools
- **Bash allowlist**: Only read-only bash commands are allowed
- **Execute reminder**: Choosing Execute restores tools and reminds the agent to seed an rpiv-todo list (no hard gate)
- **Session persistence**: Plan on/off survives session resume

## Commands

- `/plan` - Toggle plan mode
- `Shift+Tab` - Toggle plan mode (Claude Code style)
- `Ctrl+Alt+P` - Toggle plan mode (backup)

Use Pi’s built-in `/thinking` command to select the thinking level.

## Usage

1. Enable plan mode with `Shift+Tab`, `/plan`, or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose "Execute the plan" when prompted
5. Agent is reminded to create those steps with the `todo` tool, then execute

## How It Works

### Plan Mode (Read-Only)
- Built-in edit/write tools disabled
- Other active tools remain available (including `todo` from rpiv-todo)
- Bash commands filtered through allowlist

### Execute
- Full tool access restored
- Steps extracted once and handed to the agent with a todo reminder
- No tool blocking — reminder only

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
