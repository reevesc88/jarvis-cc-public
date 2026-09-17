---
name: jarvis-cc-conventions
description: Development conventions for the JARVIS Claude Code and Codex starter toolkit.
---

# JARVIS conventions

Use CommonJS and Node built-ins; this repository has no runtime package dependencies.
Keep starter guidance neutral and additive. Never distribute author-specific authority,
private endpoints, hardcoded model overrides, or personal configuration backups.

Run `node --test tests/starter.test.js tests/agency-orchestration.test.js`,
`node scripts/jarvis.js doctor`, and `node scripts/jarvis.js agency-doctor`.
Tests use isolated homes; never test repair against a real user home. Repair previews by default;
--apply exports missing neutral files only and preserves existing files and settings.

Keep README and command descriptions consistent with actual host support. Agency Agents is an
optional upstream dependency for host-native specialist use; see docs/agency-agents-quickstart.md.
The retained advanced validator is disabled by default and does not execute workers. Preserve F6
contracts, digests, and attestations. Use bounded independent review before publication.
