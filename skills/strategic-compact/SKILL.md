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

## How It Works

A `suggest-compact.js` script, run on PreToolUse (Edit/Write), combines two signals:

1. **Context size (primary)** — Reads the latest `usage` record from the session transcript (`transcript_path` in the hook payload) and sums `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (the true context size of the turn). Suggests `/compact` at a window-scaled threshold — 160k tokens on a 200k window, 250k on a 1M window (detected from a `[1m]` model marker, or inferred when observed tokens already exceed 200k) — and re-reminds after every additional 60k tokens of context growth.
2. **Tool-call count (secondary)** — Counts tool invocations in the session; suggests at a configurable threshold (default: 50 calls), then every 25 calls after.

Tool count alone is a weak proxy for window pressure: a few large file reads or MCP responses can fill the window in very few calls, while many tiny calls can cross 50 with a near-empty window. The context-size signal fires when it actually matters.

## Hook Setup

This skill is standalone: the compaction logic and decision-making below apply with or without the automated reminder. The automated reminder itself needs a small PreToolUse hook script wired into your Claude Code configuration.

**Script contract** (write this once per install, no external dependencies):
- Hook script: `suggest-compact.js`, invoked on `PreToolUse` for the `Edit` and `Write` matchers.
- Reads the hook payload's `transcript_path`, sums the latest `usage` record's token fields, and compares against the thresholds in Configuration below.
- Separately counts tool invocations so far this session (a simple counter file in a per-session temp/state directory works).
- When either signal crosses its threshold, prints a short stderr/stdout note suggesting `/compact` — it should never block the tool call, only advise.
- Sweeps its own stale per-session state files older than `COMPACT_STATE_TTL_DAYS`.

**Wiring it in:** register the script in your plugin's `hooks/hooks.json` (or `~/.claude/settings.json` for a personal install) under `PreToolUse`, matched on `Edit` and `Write`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/suggest-compact.js\"" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/suggest-compact.js\"" }]
      }
    ]
  }
}
```

Do not register the same hook twice under two different configs (a plugin-level `hooks.json` and a personal `~/.claude/settings.json` both pointing at it) — that causes double execution.

If no hook is wired up yet, apply the Compaction Decision Guide and Best Practices below manually — they don't depend on the automated reminder.

## Configuration

Environment variables the hook script should honor:
- `COMPACT_THRESHOLD` — Tool calls before first suggestion (default: 50)
- `COMPACT_CONTEXT_THRESHOLD` — Context tokens before the context-size suggestion (default: 160000 on a 200k window, 250000 on a 1M window; `0` disables the context signal)
- `COMPACT_CONTEXT_INTERVAL` — Additional context tokens before the suggestion repeats (default: 60000)
- `COMPACT_STATE_TTL_DAYS` — Days before stale per-session state files in the temp dir are swept (default: 14)

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
4. **Read the suggestion** — The hook tells you *when*, you decide *if*
5. **Write before compacting** — Save important context to files or memory before compacting
6. **Use `/compact` with a summary** — Add a custom message: `/compact Focus on implementing auth middleware next`

## Token Optimization Patterns

### Trigger-Table Lazy Loading
Instead of loading full skill content at session start, use a trigger table that maps keywords to skill paths. Skills load only when triggered, reducing baseline context by 50%+:

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
