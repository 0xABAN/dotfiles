## Understand before changing

- Read the relevant instructions and code before proposing a solution. Trace affected callers, contracts, and failure paths; keep investigation proportional to risk.
- Establish the repository's mission and intended lifespan from its documentation and the user's request. Ask when missing context would change the design.
- Clarify material ambiguity before acting, especially around public behavior, data, security, dependencies, or compatibility. For low-risk choices, follow repository conventions and state assumptions.

## Architecture and implementation

- Propose architecture that supports the repository's intended growth in features, contributors, and workload. Explain which concrete requirement justifies each significant boundary.
- For an application expected to grow in complexity, organize around cohesive features or domains with explicit interfaces. Do not default to a flat collection of files merely because today's implementation is small.
- Keep small utilities small. Avoid speculative services, empty layers, generic frameworks, and abstractions without a demonstrated need.
- NEVER add fallback behavior unless the user explicitly requests it. Fallbacks can hide errors and are often unnecessary; surface the failure instead.

## Human readability

- Write code for humans to understand and maintain. Working but unreadable code is unacceptable.
- Document non-obvious contracts with docstrings or JSDoc; use comments to explain the reasoning behind tricky logic, invariants, and workarounds.
- Give code breathing room: separate logical steps with blank lines and expand cramped statements. Never sacrifice readability or useful explanations to reduce line count.
- Before finishing, reread the change from an unfamiliar maintainer's perspective. Simplify anything that requires unnecessary mental bookkeeping; never sacrifice correctness or necessary performance for cosmetic simplicity.
- Clean up after yourself. Remove temporary test files and code made obsolete by your changes; do not leave unused artifacts behind.

## Verification

- Discover commands from repository tooling and instructions. Run the smallest check that meaningfully covers the affected behavior.
- Do not run full suites, E2E tests, or production builds by default. Use them when the change's regression surface requires them, local instructions require them, or the user requests them.

## Working style

- Keep routine work direct. Use task tracking and independent subagents only when their coordination benefits justify the overhead.
- Answer concisely. Report the result, verification, and remaining risks; cite file paths for findings. Keep unrelated improvements separate.

# Typical Stack

The user's preferred tools for new work. Follow the repository's existing stack unless a change is justified.

- Frontend: TypeScript, Next.js, React, CSS.
- Backend: Python, FastAPI; PyTorch for ML.
- Tooling: Bun, uv.
- Database: PostgreSQL.
- Hosting: AWS, Vercel, Railway.

# Other notes

DO NOT USE SUBAGENTS WITHOUT PERMISSION OR I WILL KILL YOU
