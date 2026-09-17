# Agent Orchestration

## Available Agents

Bundled with this plugin in `agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| architect | Deep reasoning and system design; the escalation endpoint | Architecture, complex debugging, multi-domain or irreversible decisions |
| build-error-resolver | Minimal-diff build and TypeScript error fixes | Build fails or type errors appear; no refactoring |
| code-reviewer | Quality, security, and maintainability review of a diff | Immediately after writing or modifying code |
| database-reviewer | PostgreSQL query, schema, security, and performance review | Writing SQL, creating migrations, designing schemas, slow queries |
| doc-updater | Documentation and codemap maintenance | Refreshing READMEs, guides, and `docs/CODEMAPS/*` |
| e2e-runner | End-to-end test authoring and execution with artifacts | Critical user flows, flaky-test quarantine, journey coverage |
| executor | Standard implementation, file writing, scripts | Default for most implementation work |
| explorer | Fast read-only search, reading, listing, initial analysis | Reconnaissance; never modifies files |
| memory-agent | Draft memory from supplied context; save only with consent | Saving an explicitly requested memory |
| performance-optimizer | Profiling, bundle size, memory leaks, render and algorithmic wins | Identified or suspected performance bottlenecks |
| react-reviewer | React/JSX hooks, render performance, server/client boundaries, a11y | Changes touching `.tsx`/`.jsx` or React component logic |
| refactor-cleaner | Dead code detection and consolidation (knip, depcheck, ts-prune) | Removing unused code, duplicates, unused exports |
| security-reviewer | OWASP Top 10, secrets, SSRF, injection, unsafe crypto | Code handling user input, auth, API endpoints, sensitive data |
| silent-failure-hunter | Swallowed errors, empty catches, bad fallbacks, lost propagation | Reviewing error handling and failure paths |
| tdd-guide | Test-first methodology and coverage enforcement | New features, bug fixes, refactoring |
| typescript-reviewer | Type safety, async correctness, Node/web security, idiomatic TS/JS | Any TypeScript or JavaScript change |

## Immediate Agent Usage

Use these roles only when the host provides them and the current task authorizes delegation.
If unavailable, perform the applicable analysis directly and report the limitation; self-review
is not independent review. Keep any required independent-review gate unmet until satisfied.
1. Complex feature requests - Use **architect** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent

## Parallel Task Execution

Use the host's available delegation tools only when independent operations materially benefit from it. If delegation is unavailable, work sequentially. Keep exactly one writer, prefer read-only reviewers, and stop at evidence boundaries rather than continuously polling.

Default ceiling for any bounded team:

- no more than 3 active agents
- no nested worker spawning
- no automatic follow-on roadmap task
- no retry without a specific failed acceptance check
- no completion claim without exact evidence

Agency Agents orchestration is a separate controller-attested opt-in workflow. When invoked, read `skills/agency-orchestration/SKILL.md` and reject boards outside `integrations/agency-agents/contracts.json`. Assign only local roles whose purpose-specific hash attestation is authenticated by a controller-owned verifier, require separately typed controller-authenticated completion evidence, and have the host enforce live ceilings. Do not accept generic self-asserted verification, install missing Agency roles, or load the full catalog automatically.

Example:

```markdown
# GOOD: Parallel execution
Launch one writer and up to two read-only reviewers for independent, bounded cards:
1. Writer: implement the exact owned slice
2. Reviewer: security analysis of the exact diff
3. Reviewer: type and regression review of the exact diff

# BAD: Unbounded parallel execution
Launch many agents without ownership, ceilings, dependencies, or stop conditions
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
