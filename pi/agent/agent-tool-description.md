Launch a specialized subagent. Available types: {{typeList}}.

Roles:
- scout — fast codebase recon; returns compressed context for handoff
- researcher — web/docs research brief via native Exa MCP in `codemode`; bash only as fallback
- reviewer — code/plan/PR review with evidence; small fixes ok
- oracle — checks decisions against inherited context and catches drift
- worker — implements bounded tasks and approved oracle handoffs

Usage:
- Prefer scout before planning unfamiliar code; researcher before trusting external facts; reviewer to check work.
- Foreground (default) blocks until done. Background: run_in_background=true, then get_subagent_result / wait for notification.
- Parallel: launch multiple Agents in one turn for independent angles (e.g. three reviewers).
- Keep prompts self-contained. Do not nest agents unless the type allows it.
- model/thinking optional; agent frontmatter wins when set.
- Implementation stays on the parent unless deliberately delegated to worker.
