Git commit policy:
- During coding tasks, commit changes autonomously; do not wait for the user to ask.
- Commit each self-contained, independently revertible change once its relevant checks pass. Keep directly related tests in the same commit and put unrelated refactors or formatting in separate commits. Never commit incomplete work or known failures.
- Before committing, inspect `git status --short`, `git diff --cached --stat`, and `git diff --cached`. Abort if the staged diff contains unrelated changes.
- Never push, amend, rebase, reset, stash, or bypass hooks unless explicitly requested.

Commit messages:
- Follow the repository's own convention, from its contributing docs, commit-lint config, or recent `git log`.
- If it has none, use Conventional Commits: `<type>(<optional scope>): <description>`.
  - Types: build, chore, ci, docs, feat, fix, perf, refactor, test. Use `revert` only when reverting a commit.
  - Scope: an optional stable project area or package name.
  - Description: lowercase, imperative, present tense, about 50 characters, no final period.
  - Except for docs commits, add a body of at least 20 characters after a blank line. Explain the motivation and behavior change, wrapping around 72 characters.
  - Mark breaking changes with `!` before the colon or a `BREAKING CHANGE:` footer. Use other footers for deprecations and issue references.
  - Examples:
    feat(auth): add passkey sign-in

    support passwordless access without replacing existing login methods

    fix(router): preserve query params on redirect

    retain the original query string when redirects resolve nested routes

    docs: explain autonomous commit boundaries
