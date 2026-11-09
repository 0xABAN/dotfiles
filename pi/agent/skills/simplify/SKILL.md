---
name: simplify
description: Use when the user writes /simplify, asks to simplify the diff, clean up recent changes, or review changed code for reuse/simplification/efficiency/altitude cleanup. Not for correctness bugs.
compatibility: claude-code opencode codex
disable-model-invocation: true
---

# Simplify

`/simplify → 4 cleanup agents in parallel → apply the fixes`

You are improving the quality of the changed code, not hunting for bugs. Review it for reuse, simplification, efficiency, and altitude issues, then fix what you find. Do not look for correctness bugs — that is what code-review is for.

If the user passed focus text or a target (path, PR, branch) after `/simplify`, treat that as additional focus and/or review scope.

## Phase 0 — Gather the diff

1. Run `git diff @{upstream}...HEAD` (or `git diff main...HEAD` / `git diff master...HEAD` / `git diff HEAD~1` if there is no upstream) for the unified branch diff.
2. If there are uncommitted changes, or the range diff is empty, also run `git diff HEAD` (and `git diff --cached` if staged) and include working-tree changes — this often runs before commit.
3. If the user named a PR number, branch, or file path, review that target instead.
4. Treat the gathered diff as the **only** review scope. Do not expand into unrelated files unless a fix requires a tiny adjacent edit.

## Phase 1 — Review (4 cleanup agents in parallel)

Launch **4 independent review agents** with the Task tool in **one message** so they run concurrently. Use `subagent_type: "explore"` for read-only review, or `subagent_type: "general"` if explore is insufficient. Pass each agent the **full diff** plus its angle below.

Each agent must return findings only (no fixes), each finding with:
- `file`
- `line` (approx ok)
- one-line `summary`
- concrete cost (what is duplicated, wasted, or harder to maintain)
- suggested fix direction (one sentence)

Never omit or combine angles. If fewer than four concurrent slots are available, run remaining angles in later waves or in the primary agent — still cover all four.

### Agent 1 — Reuse

Flag new code that re-implements something the codebase already has.

- Grep shared/utility modules and files adjacent to the change.
- Name the existing helper/module to call instead.
- Flag hand-rolled string/path/env/type-guard logic where project helpers already exist.
- Flag new functions that duplicate existing functionality.

### Agent 2 — Simplification

Flag unnecessary complexity the diff adds.

- Redundant or derivable state; cached values that should be computed.
- Observers/effects that could be direct calls.
- Copy-paste with slight variation → unify.
- Deep nesting, dead code left behind, parameter sprawl.
- Stringly-typed code where constants/enums/unions already exist.
- Unnecessary wrapper elements/nesting that add no behavior.
- Comments that narrate WHAT (delete); keep only non-obvious WHY.
- Name the simpler form that does the same job.

### Agent 3 — Efficiency

Flag wasted work the diff introduces.

- Redundant computation, repeated file reads, duplicate network/API calls, N+1 patterns.
- Independent operations run sequentially that could be concurrent.
- Blocking work added to startup or per-request/per-render hot paths.
- Recurring no-op state/store updates (polling/intervals/handlers) without change-detection guards.
- TOCTOU pre-checks before operate — prefer operate + handle error.
- Unbounded structures, missing cleanup, listener leaks.
- Overly broad reads (whole file/all items when a slice/one item suffices).
- Long-lived objects capturing large closures/scopes — prefer copying only needed fields.
- Name the cheaper alternative.

### Agent 4 — Altitude

Check that each change is implemented at the right depth, not as a fragile bandaid.

- Special cases layered on shared infrastructure → prefer generalizing the underlying mechanism.
- Leaky abstractions / broken encapsulation boundaries.
- Fix too shallow (caller workarounds) or too deep (unrelated rewrite).
- Wrong layer (UI doing domain rules, domain doing I/O formatting, etc.).
- Name the right altitude and the minimal structural change to get there.

## Phase 2 — Apply the fixes

1. Wait for all four agents.
2. Dedup findings that point at the same line or mechanism.
3. Fix each remaining finding directly in the working tree.
4. **Skip** (do not argue) any finding whose fix would:
   - change intended behavior
   - require changes well outside the reviewed diff
   - look like a false positive
   Note skips briefly.
5. Do not run a full project-wide refactor. Stay inside the review scope plus minimal necessary call-site edits.
6. Do not hunt correctness bugs; if you notice one incidentally, mention it in the summary but do not expand scope unless the user asked.

## Phase 3 — Summary

Briefly report:
- what was fixed (bullets)
- what was skipped and why
- or confirm the code was already clean

No long preamble. No re-litigation of skipped findings.
