---
name: strategic-compact
description: Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction.
---

# Strategic Compact Skill

Suggests manual `/compact` at strategic points in your workflow rather than relying on arbitrary auto-compaction.

## When to Activate

- Running long sessions that approach context limits (200K+ tokens)
- Working on multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks within the same session
- After completing a major milestone and starting new work
- When responses slow down or become less coherent (context pressure)

## Why Strategic Compaction?

Auto-compaction triggers at arbitrary points:
- Often mid-task, losing important context
- No awareness of logical task boundaries
- Can interrupt complex multi-step operations

Strategic compaction at logical boundaries:
- **After exploration, before execution** — Compact research context, keep implementation plan
- **After completing a milestone** — Fresh start for next phase
- **Before major context shifts** — Clear exploration context before different task

## Manual workflow

This distribution includes no automated compaction reminder or hook. Use the host's supported compaction feature at a task boundary after preserving the current decisions, unfinished work and verification evidence in an authorized location. The host determines what survives compaction.

## Compaction Decision Guide

Use this table to decide when to compact:

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Plan is in TodoWrite or a file; free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Understanding what persists helps you compact with confidence:

| Persists | Lost |
|----------|------|
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| TodoWrite task list | File contents you previously read |
| Memory files (`~/.claude/memory/`) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| Files on disk | Nuanced user preferences stated verbally |

## Best Practices

1. **Compact after planning** — Once plan is finalized in TodoWrite, compact to start fresh
2. **Compact after debugging** — Clear error-resolution context before continuing
3. **Don't compact mid-implementation** — Preserve context for related changes
4. **Check the task boundary** — Compact when the next phase no longer needs detailed previous output
5. **Preserve authorized context** — Save decisions only to destinations the user has approved
6. **Use `/compact` with a summary** — Add a custom message: `/compact Focus on implementing auth middleware next`

## Token Optimization Patterns

### Trigger-Table Lazy Loading
Instead of loading full skill content at session start, use a trigger table that maps keywords to skill paths. Skills load only when triggered, avoiding unnecessary baseline context:

| Trigger | Skill | Load When |
|---------|-------|-----------|
| "test", "tdd", "coverage" | tdd-workflow | User mentions testing |
| "security", "auth", "xss" | security-review | Security-related work |
| "deploy", "ci/cd" | deployment-patterns | Deployment context |

### Context Composition Awareness
Monitor what's consuming your context window:
- **CLAUDE.md files** — Always loaded, keep lean
- **Loaded skills** — Each skill adds 1-5K tokens
- **Conversation history** — Grows with each exchange
- **Tool results** — File reads, search results add bulk

### Duplicate Instruction Detection
Common sources of duplicate context:
- Same rules living in both a global rules directory and a project-local one
- Skills that repeat CLAUDE.md instructions
- Multiple skills covering overlapping domains

### Context Optimization Tools
- A token-deduplication MCP or utility, if one is configured in your environment
- Context-virtualization approaches for very large working sets

## Related

- Track verified decisions and unresolved questions; timing suggestions do not persist this context for you.
- Memory persistence hooks — for state that survives compaction
- A session pattern-extraction skill, if your setup has one, pairs well: extract durable patterns/decisions before the session ends
