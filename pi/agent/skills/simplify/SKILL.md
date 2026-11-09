---
name: simplify
description: Keep a change's diff as small as the task allows. Use before implementing, while implementing, as a sweep of the branch diff against main before opening or updating a PR, or as a sweep of one or more PRs or an entire repo.
disable-model-invocation: true
---

# Reduce my diff

Every changed line must trace directly to the request. The first rules prevent whole features; the last rules trim lines. For a trivial change, use judgment.

This skill finds lines to remove. Correctness bugs, security holes and performance are out of scope: send them to a normal code review.

## Scope

- **PRs**: review only the lines the PRs change, and report or change nothing outside their diffs. Feature Consolidation (rule 1) is the exception: it also reads the rest of the repo. Compare a stacked PR against its base branch, not main.
- **Entire repo**: review all the code. Apply rules 2 to 7 to the code and rule 1 to the features. Also look for a dependency that the standard library or the platform replaces, an interface with one implementation, a factory with one product, a wrapper that only delegates, a file that exports one thing, and a flag or config value that nothing sets.
- **No target**: review the current branch diff against main.

## Weigh each line by its commit

Unneeded lines hide in large commits: a commit that adds a feature also brings in code nobody asked for. A small commit with one stated purpose, such as a rename, a test-title edit or a quality pass, is a deliberate choice.

- On a PR or branch, read the commits first: `git log --stat --reverse <base>..<head>`. Find the commit behind each hunk with `git blame <base>..<head> -- <file>`.
- Review the largest commits first. Most findings come from them.
- Don't flag a change that came in on its own commit when that commit's message names the change. This holds even when it looks like churn.
- Exception: if a later commit undid that purpose (for example it restored a function the earlier commit removed), the leftover lines are fair game. Name both commits.
- A single-commit or squashed branch has no history to weigh. Review every line.

## 0. Before you start

- State your assumptions. If the request has more than one reading and the readings lead to different code, present them instead of picking one silently. If a reading has a sensible default, take it, say so in one line, and continue. If something is unclear and has no default, stop, name the problem, and ask.
- Define done as a check you can run: a failing test that reproduces the bug, or tests that pass before and after a refactor. Stop when the check passes. For multi-step work, write a short plan with a check per step.

## 1. Feature Consolidation

Given requirements A, A^, B and B^, a human weighs the tradeoffs and builds one shared feature. An LLM builds four features, each with its own tests. Also, some requirements need more code than their risk is worth.

Run this rule on every scope. Nothing changes until the user approves. For PRs, read the repo for existing features that do the same job as the new code.

- List the requirements: one per feature, code path, guard, field or endpoint, including ones nobody asked for.
- Group the requirements that overlap, in the PRs and across the PRs and the repo. For each group, propose one shared feature and one set of tests.
- If a PR adds a feature where an existing feature could expand, name the existing feature, its file, and what the expansion needs.
- If a requirement's code is large and its risk is small or unlikely, propose to remove the requirement.
- For each proposal, give the lines it removes, what the user loses, and the risk it leaves.
- Propose only changes that make the implementation substantially smaller. If a simpler approach exists, say so and push back.

## 2. Build only what was asked

- No features, flexibility or configuration that nobody requested.
- No scaffolding for later: no stub functions, empty folders, barrel exports or TODO placeholders for work that nobody asked for.
- No error handling for cases that can't happen.
- No abstraction for code used once. Don't add a one- or two-line function, however often it repeats. Extract a repeated value as a named constant. Extract a function only for 3 or more lines of real logic.
- If you wrote 200 lines and 50 would do, rewrite it.
- Ask: would a senior engineer call this overcomplicated? If yes, simplify.

## 3. Change existing code before adding new code

- Read the code the change touches and trace the real flow before you choose an approach. The smallest change in the wrong place is a second bug.
- Before you write new code, ask these questions in order. Stop at the first yes:
  1. Does this need to exist? If not, don't build it (see 2).
  2. Does the codebase already have it? Reuse that helper, util or pattern.
  3. Can data change instead of code? For example a definition, a template or a config value. A data change adds no schema, API or engine branch.
  4. Does the standard library do it? Use it.
  5. Does the platform do it? For example `<input type="date">`, CSS, or a database constraint.
  6. Does an installed dependency do it? Use it. Don't add a new dependency.
  7. If all answers are no, write the minimum code that works.
- When two options have the same size, choose the one that is correct on edge cases. If both are correct, choose the one that deletes code.
- Put new code in the file that uses it. Don't create a file for one helper, type or constant.
- Before you add a field that claims parity with another system, search that system for the name. A value that the other system computes and never stores is not parity.
- For a bug fix, search for every caller of the function before you edit it, then fix the shared function once. A fix on only the ticket's path leaves the other callers broken.
- Modify what the repo has instead of adding a parallel path, and reuse its conventions: for example, one metric key with an outcome tag instead of three keys.
- Don't add code only to support a frozen legacy path. Tag the new path and let existing filters exclude the untagged rows.

## 4. Touch only what you must

- Don't restructure code to add a signal. Wrapping a function body in `try` re-indents every line and turns a 10-line change into 90. Take the smaller signal, like a guard clause.
- Don't improve nearby code, comments or formatting, and don't refactor code that works.
- Match the existing style and naming. Apply the project's CLAUDE.md standards only to lines you already change.
- Remove imports, variables and functions that your change made unused. Mention unrelated dead code, but don't delete it.

## 5. Leave whitespace alone

Don't change whitespace on a line you don't otherwise change, unless a lint or format rule that the pipeline enforces requires it.

- Don't re-indent, reflow or rewrap existing lines. Don't add or remove blank lines, trailing whitespace, final newlines or line endings, and don't switch tabs and spaces.
- Format-on-save reformats whole files; format only your lines. In your own additions, follow the file's spacing and add no extra blank lines.
- Minimal whitespace never means cramming code onto one line or breaking the linter.
- Put lint-required reformatting in its own commit so reviewers can skip it. If CI lints entire modified files, run the formatter check (for example `npx prettier --check`) on every file you touch, and fix existing violations in that separate commit.
- Before you push, compare `git diff --stat` with `git diff -w --stat`. Any difference is whitespace-only churn; revert what lint doesn't require. `git diff --check` flags trailing whitespace you added.

## 6. Keep test changes small

- New branching logic needs at least one assertion that fails if the logic breaks. Never mark the only assertion on a branch as removable.
- Add assertions to existing tests that already drive the path. Write a new test only for a case that no existing test sets up.
- YAGNI applies to tests too: no new fixtures, test helpers or per-function suites unless the user asks.
- Delete a test that your change made redundant. If a new assertion covers the fallback, the separate fallback test is dead.
- Never test a mock of the thing you changed. That proves only that the mock works; find where the real logic is covered.

## 7. Sweep the branch diff against main

After each change, remove what the branch added that the codebase wouldn't:

- Comments that restate the code, tell the story of the plan, are longer than 2 lines, or are denser than the file's existing comments. Keep a 1-2 line comment that explains why. A comment for a deliberate shortcut names its limit and the trigger to upgrade it; flag one that names no trigger.
- Docstrings and type annotations that nobody asked for and the file doesn't use, quote-style changes, and rewritten boolean or return logic on lines the change only needed to extend.
- Defensive checks or try/catch blocks that are unusual for a trusted code path, unless they protect an item in Guardrails.
- Casts to `any` that only get past a type error.
- Deep nesting in new code. Flatten it with early returns. Leave existing code alone (see 4).
- Duplicate logic, or anything else that doesn't match the file. Consolidate it, and give new code clear names.

Stop when the remaining edits are broad rewrites. A focused edit that removes lines beats a rewrite that moves them.

## 8. Run `/simplify`

Run `/simplify` after rule 7. Otherwise it simplifies lines that the sweep then deletes. It is built into Claude Code and has no file on disk, so don't conclude it is missing from `~/.claude/skills`. Don't skip it or replace it with the manual reviews below. Its efficiency fixes are the one exception to the performance scope above.

`/simplify` edits files, so run it only when you implement or apply fixes. In report-only mode, do its reviews by hand and report each finding in the report format.

On another harness, run its equivalent (for example Gemini's code review or Codex's refactor mode). If none exists, do these reviews by hand:

1. Reuse: rule 3.
2. Quality: redundant state, parameter sprawl, copy-paste, leaky abstractions, stringly-typed code, unnecessary comments.
3. Efficiency: redundant computations, missed concurrency, hot-path bloat, recurring no-op updates, memory concerns.

Fix actionable findings directly. Note and skip false positives.

## Report format

By default, report only. Don't edit files, commit, push or post comments unless the user asks.

The report lists what to cut, one line per finding. Its best outcome is a shorter diff. Don't name the rule behind a finding; the tag says what kind of cut it is.

Give each PR, branch or repo its own section:

- Start with the PR link and its size, for example `+127 / −3`. For a repo, start with the repo name and the files reviewed.
- Write each finding as `−<lines> path:line: <tag>: <what to cut>. <replacement>.` If it spans more than one file, write `<x> files` in place of `path:line` (for example `3 files`).
- On a PR or branch, end each finding with the short SHA of the commit that added the lines, for example `(425178f6a)`.
- Give line numbers from the file on the PR's head branch, as `path:line` or `path:start-end`, never the line's position in `gh pr diff` output. Count from the `@@ +start` hunk header or grep the head branch. For a deleted line, give its base-branch number and say so.
- Use these tags, and make the replacement concrete:
  - `delete`: dead code, unused flexibility, a speculative feature, or a redundant test or comment. Replacement: nothing.
  - `reuse`: the codebase already has it. Name the helper and its `path:line`.
  - `stdlib`: hand-rolled code that the standard library ships. Name the function.
  - `native`: a dependency or code that does what the platform does. Name the feature.
  - `yagni`: an abstraction with one implementation, config that nothing sets, or a layer with one caller. Say what to inline.
  - `shrink`: the same logic in fewer lines. Show the shorter form.
  - `churn`: whitespace, formatting or restructuring that the task didn't need. Replacement: revert it.
- Put each finding in one of three groups, and sort each group from most lines to fewest:
  - **No impact**: behavior stays the same.
  - **Possible impact**: you can't verify the effect, but the cut might change behavior. End the line with `Possible:` and what might change.
  - **Confirmed impact**: you read the code, and the cut changes a requirement, feature, code path, guard, field or endpoint. End the line with `Confirmed:` and what changes.
- End the section with the totals: `no impact: −<N>`, `possible impact: −<P>`, `confirmed impact: −<C>`, and `net: −<N+P+C> lines possible.` For a repo, add `−<D> deps possible`.
- Count only lines that exist in the diff or the repo. Never report lines saved from code that was never written.
- If there is nothing to cut, write `Lean already. Ship.` and stop.
- After the totals, add a Feature Consolidation section with the rule 1 proposals, sorted by lines removed. Every proposal has confirmed impact. If there are no proposals, say so.

Examples:

- ❌ "This EmailValidator class might be more complex than necessary. Have you considered whether all these rules are needed now?"
- ✅ `−27 src/validate.py:12-38: stdlib: 27-line validator class. "@" in email, 1 line; the confirmation mail does the real validation.`
- ✅ `−1 src/dates.ts:4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`
- ✅ `−40 src/repo.py:88-127: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`
- ✅ `−15 src/build.py:30-44: shrink: manual loop builds a dict. dict(zip(keys, values)), 1 line.`
- ✅ `−9 src/format.ts:61-69: reuse: new currency formatter. formatMoney at src/utils/money.ts:12.`
- ✅ `−20 src/client.ts:52-71: delete: retry wrapper around a local call. Nothing replaces it. Possible: a caller that relied on the retry now fails on the first error.`

While you implement, there is no report. End the reply with one line for what you left out: `skipped: <X>, add when <Y>.`

## Applying fixes

- Get approval for each finding with possible or confirmed impact. Approval for one finding doesn't cover the others. Feature Consolidation proposals always need approval.
- "Fix everything" or "apply all" applies only the no-impact findings. List the skipped findings in the summary.
- If the user rejects a proposal or asks for the full version, build it and don't propose it again.
- On PRs, edit only the lines those PRs change.
- Run the tests before and after. If a fix makes a test fail, revert it and report it.
- After the fixes, compare `git diff --stat` with the stat from before. Revert a fix that only moved lines.
- Keep the summary to 1-3 sentences, and mention only changes that affect how someone reads the code. Put the list of skipped findings after it.

## Guardrails

- Keep behavior unchanged unless you fix a clear bug.
- Never remove input validation at a trust boundary, error handling that prevents data loss, a security check, or basic accessibility, even when the check looks unusual for the code path.
- Don't remove a timeout, threshold, retry count or other tuning value that the real environment needs, even when it looks like unused configuration.
- Choose clarity over brevity, and boring code over clever code. No nested ternaries, dense one-liners, functions that combine unrelated concerns, or changes that make the code harder to debug or extend. Keep an abstraction that already helps organize the code.
