---
description: Launch the jarvis-cc Skills Hub — a Tkinter desktop dashboard cataloging this plugin's installed agents, rules, commands, and hooks
---

# Skills Hub Dashboard

Launches the jarvis-cc Skills Hub: a local Tkinter desktop dashboard that scans
this plugin's own installed `agents/`, `rules/`, `commands/`, and `hooks/`
directories and shows live, real counts and item lists in a dark,
orange-accented UI. No hardcoded numbers — everything is scanned fresh at
launch.

!python "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard/jarvis_dashboard.py"
