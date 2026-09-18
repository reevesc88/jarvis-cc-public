# Development Workflow

> This file extends [common/git-workflow.md](./git-workflow.md) with the full feature development process that happens before git operations.

The Feature Implementation Workflow describes the development pipeline: research, planning, TDD, code review, and then committing to git.

No specific service or optional agent is required to follow this workflow. Use capabilities
available in the current host; do not install tools, create accounts, or spend money merely
to satisfy these examples. Perform the steps directly when an agent is unavailable. Report
any required independent review or verification you cannot obtain; do not claim it passed.

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **Inspect first:** Search the local project for existing implementations, templates, tests, and patterns before writing new code. GitHub search is an optional source when available and useful.
   - **Verify APIs:** Read available primary vendor documentation to confirm API behavior and version-specific details. Context7 is optional; use a browser or local documentation when available instead. Report unresolved version-sensitive assumptions.
   - **Broader research when needed:** Use an available search tool. Exa is an optional example, not a prerequisite.
   - **Check existing packages:** Inspect local dependencies and, when accessible and relevant, the project language's package registry. Prefer proven libraries that meet the task over hand-rolled replacements.
   - **Search for adaptable implementations:** Look for open-source projects that solve 80%+ of the problem and can be forked, ported, or wrapped.
   - Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement.

1. **Plan First**
   - Create an implementation plan directly; optionally use an available planning agent.
   - Generate planning docs before coding: PRD, architecture, system_design, tech_doc, task_list
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** if available, or follow the test-first steps directly.
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Review code immediately after writing it; use **code-reviewer** if available. Follow the independent-review requirements in code-review.md.
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format
   - See [git-workflow.md](./git-workflow.md) for commit message format and PR process

5. **Pre-Review Checks**
   - Verify all automated checks (CI/CD) are passing
   - Resolve any merge conflicts
   - Ensure branch is up to date with target branch
   - Only request review after these checks pass
