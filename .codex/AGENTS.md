# ECC for Codex CLI

This supplements the root `AGENTS.md` with a repo-local ECC baseline.

## Repo Skill

- Repo-generated Codex skill: `.agents/skills/jarvis-cc/SKILL.md`
- Claude-facing companion skill: `.claude/skills/jarvis-cc/SKILL.md`
- Keep user-specific credentials and private MCPs in `~/.codex/config.toml`, not in this repo.

## MCP Baseline

The checked-in `.codex/config.toml` only declares local roles and limits. It does not select permissions, web access or MCP servers. Use your existing host settings; enable any external integration separately after reviewing its code, credentials and data access.

## Agency Agents for normal use

Follow `docs/agency-agents-quickstart.md` for optional upstream installation and named host agents. Base JARVIS works without Agency Agents. Do not imply that installing a role launches it or grants new permissions. The advanced validator below is separate from this simple workflow and does not provide a dispatcher.

## Multi-Agent Support

- Explorer: read-only evidence gathering
- Reviewer: correctness, security, and regression review
- Docs researcher: API and release-note verification
- Agency orchestrator: explicit controller opt-in, read-only routing across hash-attested Agency TOML roles with bounded fan-out, depth, attempt, and board declarations

Agency orchestration is disabled by default. Before using it, read `.agents/skills/agency-orchestration/SKILL.md`, run `node scripts/jarvis.js agency-doctor`, have a controller-owned verifier authenticate purpose-specific role and exact-pipeline opt-in attestations, choose the lowest capable model tier, and keep exactly one writer. Generic self-asserted verification fields are invalid and attestation kinds are not interchangeable. Workers may not spawn. The doctor validates declarations only; the host must enforce live ceilings. Do not install roles or mutate global Codex configuration as part of orchestration.

## Workflow Files

- No dedicated workflow command files were generated for this repo.

When workflow command files are generated for this repo, use them as reusable task scaffolds when the detected repository workflows recur.
