---
description: Preview optional missing neutral exports into ~/.claude.
---

Preview optional missing neutral exports into ~/.claude. This command writes nothing. After reviewing the preview, explicitly run node "<plugin-root>/scripts/jarvis.js" repair --apply in a terminal to export. Existing files, including empty files, and settings.json stay unchanged. Unsafe links and directory targets are rejected.

!node "${CLAUDE_PLUGIN_ROOT}/scripts/jarvis.js" repair
