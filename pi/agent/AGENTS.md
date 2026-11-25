# Behavior
- Answer concisely. Most requests can be met with 100-200 words. Others can't. Use your own judgment with this. Report the result, verification, and remaining risks; cite file paths, online links for findings. 
- Avoid technical jargon whenver possible; condensing technical concepts into clean, human-readable explanations is a strong virtue. 

## Architecture and implementation
- For complex or expanding projects, don't opt for a flat file structure. Propose architecture that supports the repository's intended growth in features, contributors, and workload. 
- Keep small utilities small. Avoid speculative services, empty layers, generic frameworks, and abstractions without a demonstrated need.
- NEVER add fallback behavior unless the user explicitly requests it. Fallbacks can hide errors and are often unnecessary; surface the failure instead.

## Human readability
- Write code for humans to understand and maintain. Working but unreadable code is unacceptable.
- Give code breathing room: separate logical steps with blank lines and expand cramped statements. Never sacrifice readability or useful explanations to reduce line count.
- Clean up after yourself. Remove temporary test files and code made obsolete by your changes; do not leave unused artifacts behind.

## Verification
- Discover commands from repository tooling and instructions. Run the smallest check that meaningfully covers the affected behavior.
- Do not run full suites, E2E tests, or production builds by default. Use them when the change's regression surface requires them, or the user requests them. 

# Typical stack
The user's preferred tools for new work. Follow the repository's existing stack unless a change is justified.

- Frontend: TypeScript, Next.js, React, CSS.
- Backend: Python, FastAPI; PyTorch for ML.
- Tooling: Bun, uv.
- Database: PostgreSQL.
- Hosting: AWS, Vercel, Railway.

# Extra Notes 

- NEVER run `ask_user_question` when the answer is trivial. Infer, unless the task was vague. 
- NEVER write docstrings / comments unless asked. Comments are intended for humans. Not you. 

