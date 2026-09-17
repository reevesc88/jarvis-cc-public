---
description: Validate the disabled-by-default Agency orchestration policy and list installed Codex TOML roles without modifying global configuration.
---

Run the read-only Agency orchestration policy doctor. It validates the pinned registry and bounded delegation contract, then reports bounded TOML candidates from trusted local directories separately from controller-verified Agency roles. It does not install roles, mint attestations, mutate configuration, dispatch agents, or enable orchestration.

To inspect a specific local board, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/jarvis.js agency-doctor <board.json>` in a trusted terminal after inspecting the path. The path is confined to the current repository and linked/reparse ancestors are rejected. An enabled board remains invalid until a trusted host supplies a controller-owned authentication verifier plus purpose-specific, non-interchangeable opt-in, role, and evidence attestations. Accounting is optional for validity: a verified `agency.accounting.v1` attestation only downgrades the advisory cost-ceiling warning, so its absence leaves the warning but does not make the board invalid.

!node ${CLAUDE_PLUGIN_ROOT}/scripts/jarvis.js agency-doctor
