---
description: Read-only checks of an optional ~/.claude/memory layout.
---

Read-only checks of an optional ~/.claude/memory layout. No memory configured is a successful result. Existing layouts may use other index conventions; review findings before making changes.

!node "${CLAUDE_PLUGIN_ROOT}/scripts/jarvis.js" memory-doctor
