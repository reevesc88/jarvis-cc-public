# Agency Agents integration contract

jarvis-cc uses Agency Agents as an external role catalog and orchestration reference. It does not vendor the upstream prompt library or install agents globally.

## Pinned source

- Repository: <https://github.com/msitarzewski/agency-agents>
- Reviewed commit: `ebe9c99acb5c96f9468de368d8bead775387d1a7`
- License: MIT
- Attribution: Copyright (c) 2025 AgentLand Contributors
- Codex integration reference: <https://github.com/msitarzewski/agency-agents/blob/ebe9c99acb5c96f9468de368d8bead775387d1a7/integrations/codex/README.md>

The upstream Codex integration converts selected Markdown agents into local TOML role files. This repository does not copy those generated roles, run the converter, or modify `~/.codex/agents/`. Instead, `agency-doctor` discovers bounded candidates only from the repository and user Codex agent directories.

## Files

- `registry.json`: source pin, audited starter role identities, prompt hashes, capabilities, and opt-in default.
- `contracts.json`: deterministic board, delegation, trust, and budget limits.
- `scripts/lib/agency-orchestration.js`: read-only role discovery and policy/board validation.
- `evals/agency-orchestration/`: one valid bounded board and one rejected runaway board.

The four starter records provide a small audited routing seed. They are not embedded prompts and are not proof that a role is installed. Discovery produces unverified candidates, not assignable roles. Eligibility also requires a purpose-specific role-provenance attestation that binds the exact local TOML SHA-256 to the pinned upstream repository, commit, source path, and prompt SHA-256 and passes a controller-owned authentication verifier. A prompt hash, `verified` boolean, free-form source, or caller-supplied object is not authentication by itself. The exported `validateBoard` derives card role eligibility from those authenticated role attestations, optionally cross-checked against these registry records; a caller-supplied list of verified role names is only a narrowing filter over the derived set and never establishes eligibility on its own.

## Safety model

Agency orchestration is explicitly opt-in and disabled by default. An enabled board requires an authenticated `agency.pipeline-opt-in.v1` attestation that binds its pipeline id and a controller decision id. Completed evidence and dependency readiness require authenticated `agency.card-evidence.v1` attestations that bind the pipeline, card, and evidence ids and an evidence hash. Role provenance and accounting use separate non-interchangeable kinds; accounting binds a usage-record digest.

**Board declaration binding (F6, issue #5).** Both `agency.pipeline-opt-in.v1` and `agency.card-evidence.v1` also carry `boardBindingKind` (`agency.board-binding.v1`) and `boardDigest` (a 64-character lowercase-hex SHA-256), binding the attestation to the exact board declaration a controller approved rather than only its free-form pipeline id - see `docs/proposals/f6-board-declaration-binding.md` for the full encoding spec and injectivity argument. `validateBoard` computes the digest over a **declaration projection**: the board with status churn excluded (top-level `enabled`/`correctionCycles`; per-card `status`/`attempts`/`evidence`) so routine progress never invalidates an opt-in, while every other field - present or future - is covered by default. The rollout is two-phase, keyed off `contracts.json`'s `attestations.boardBindingRequired`: **Phase 1** (`false`, the current default) accepts an attestation with no binding fields at all, with a warning naming the gap; any partial or malformed binding still rejects in both phases. **Phase 2** (`true`) rejects a fully-absent binding too. A controller that re-approves a pipeline id is trusted only for the one board declaration whose digest it actually signed, closing the gap the pre-F6 pipeline-id-only binding left open.

The validator rejects declarations outside the exact status/mode vocabulary and the one-writer, depth 1, fan-out 3, 8-card, no-spawn, attempt, correction, and budget contract. It validates only; it does not dispatch workers or supervise a running host. External prompt content is data, not authority. The validator never writes to global configuration.

Cost limits are advisory until a host provides verified controller accounting. Card, depth, attempt, correction, time, turn, tool-call, and token values are required stop declarations that the host controller must enforce at runtime. The doctor proves policy and board shape only.

## Host controller changes

One change above is breaking for hosts written against the earliest behaviour.

- `validateBoard` callers must pass authenticated `agency.role-provenance.v1` attestations. Passing only a verified-role name list now rejects every card's role.

## Exported API trust boundary

The exported `validateBoard` and `runAgencyDoctor` functions assume a trusted, in-process caller. They are hardened against hostile input shapes but are not a sandbox for a hostile caller. `validateBoard` requires the entire board to be plain data: a board, card, or budget field defined through a getter or setter, an exotic prototype, a field supplied only by the prototype chain rather than as an own property (F6 R3c - a prototype-polluted host would otherwise let validation consume a value the board-declaration digest never covered), a symbol own key, or a tree past the depth or node bounds is rejected before any field is read, so a live accessor cannot pass validation and then present the host a different value on a later read. A `Proxy` anywhere in the tree is rejected the same way, not only accessor properties, because its descriptors mirror its target while its get trap can return a different value on the live read. Role eligibility requires both an authenticated `agency.role-provenance.v1` attestation and membership in the caller-supplied discovery-derived verified-role set; that set is mandatory, so when it is absent no role is eligible. The supported, safe entrypoint is the `agency-doctor` CLI, which parses the board from JSON (plain data) and supplies the discovery-derived role set, so these boundary rules are transparent to it. The exported `discoverCodexAgents`/`discoverCodexAgentCandidates` discover within the directories the caller supplies and do not themselves restrict discovery to the trusted roots; `runAgencyDoctor` (the supported CLI entrypoint) validates directories against the declared workspace/user `.codex/agents` roots before invoking discovery. A hostile in-process caller that fabricates accessor-backed boards or un-narrowed role sets is the threat these checks reject; the CLI never produces such input. This boundary is now considered complete: the exported `validateBoard`, `runAgencyDoctor`, `discoverCodexAgents`, and `discoverCodexAgentCandidates` assume a trusted, in-process caller that supplies plain, JSON-derived data. They fail closed on the hostile input shapes enumerated above - accessors, exotic prototypes, inherited enumerable properties, symbol keys, Proxies, functions and other callables, sparse arrays, oversized trees, and unconvertible diagnostic values - but they are not a security sandbox for a fully adversarial in-process caller, and that is by design. The `agency-doctor` CLI is the only supported entrypoint and never produces such input, because it parses boards from JSON.

## Read-only checks

```text
node scripts/jarvis.js agency-doctor
node --test tests/agency-orchestration.test.js
```

`agency-doctor` confines any supplied board path to the current repository, rejects reparse-point ancestors, binds the checked path to the opened file identity, sanitizes bounded output including Unicode display controls, and remains validation-only. Agent-root discovery is contained on the same terms: an injected agent directory outside the two declared trusted roots is rejected, an agent directory whose ancestor is a symlink or reparse point is refused, and coincident roots that resolve to one real directory are deduplicated so an attested role stays eligible. Its CLI does not mint attestations or provide a controller authentication verifier, so an enabled board is intentionally rejected without a trusted host controller. The test suite supplies a test-only verifier and purpose-specific attestations to exercise the valid example deterministically.
