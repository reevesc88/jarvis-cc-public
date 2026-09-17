'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const TEST_CONTROLLER_PROOF = 'test-only-controller-proof';
let api;
try {
  api = require('../scripts/lib/agency-orchestration');
} catch (_error) {
  api = null;
}

function requireApi() {
  assert.ok(api, 'agency-orchestration implementation must exist');
  return api;
}

// F6 (docs/proposals/f6-board-declaration-binding.md): the board-binding scheme
// constant, mirrored here as a fallback so this file still parses (with a clear
// requireApi() failure elsewhere) if the implementation has not shipped it yet.
const BOARD_BINDING_KIND = (api && api.BOARD_BINDING_KIND) || 'agency.board-binding.v1';

function testControllerAttestationVerifier(attestation) {
  return attestation.controllerProof === TEST_CONTROLLER_PROOF;
}

function attestationBase(kind, attestationId) {
  return {
    schemaVersion: 1,
    kind,
    attestationId,
    controllerId: 'test-controller',
    controllerProof: TEST_CONTROLLER_PROOF,
  };
}

// Computes the real F6 board declaration digest for a test board, asserting the
// digest computation itself succeeded (a test board that fails to digest is a
// test bug, not an expected outcome, for every helper that calls this).
function boardDigestFor(board) {
  const result = requireApi().computeBoardDeclarationDigest(board);
  assert.ok(result.ok, `test board must digest cleanly: ${result.ok ? '' : result.error}`);
  return result.digest;
}

// Non-asserting variant for optInFor below: several tests deliberately hand
// validateBoard a hostile board (pathologically deep, sparse, oversized, or
// carrying a function value) to prove the plain-data gate rejects it BEFORE any
// attestation is even read. Those tests still need SOME syntactically valid
// opt-in attestation object; the board being un-digestable is expected there,
// not a test bug, so optInFor falls back to an unbound attestation instead of
// asserting.
function tryBoardDigest(board) {
  return requireApi().computeBoardDeclarationDigest(board);
}

// Raw (unbound) attestation builders - deliberately WITHOUT boardBindingKind/
// boardDigest, used only where a test needs to control the binding fields
// itself (e.g. the disposition-matrix and R7 tests). Everywhere else,
// optInFor/evidenceFor below attach a real, matching binding so the rest of
// the suite proves the bound-and-accepted path, not just the Phase-1
// absent-binding warn path.
function rawOptInFor(board) {
  return {
    ...attestationBase('agency.pipeline-opt-in.v1', `opt-in-${board.pipelineId}`),
    pipelineId: board.pipelineId,
    decisionId: `decision-${board.pipelineId}`,
  };
}

function rawEvidenceFor(pipelineId, cardId, evidenceId) {
  return {
    ...attestationBase('agency.card-evidence.v1', `evidence-${cardId}-${evidenceId}`),
    pipelineId,
    cardId,
    evidenceId,
    evidenceSha256: createHash('sha256').update(`${pipelineId}:${cardId}:${evidenceId}`).digest('hex'),
  };
}

// F6: evidence attestations are also board-bound. `boardDigest` is optional here
// (null omits the binding fields entirely) because some callers mint evidence
// for an unrelated pipeline purely to exercise verifier call-count behaviour,
// where a real binding is meaningless.
function evidenceFor(pipelineId, cardId, evidenceId, boardDigest = null) {
  const evidence = rawEvidenceFor(pipelineId, cardId, evidenceId);
  if (boardDigest) {
    evidence.boardBindingKind = BOARD_BINDING_KIND;
    evidence.boardDigest = boardDigest;
  }
  return evidence;
}

// Evidence binds the pipeline/card/evidence ids, an evidence hash, and (F6) a
// digest of the exact board declaration.
function evidenceForBoard(board, cardId, evidenceId) {
  return evidenceFor(board.pipelineId, cardId, evidenceId, boardDigestFor(board));
}

function accountingFor(pipelineId) {
  return {
    ...attestationBase('agency.accounting.v1', `accounting-${pipelineId}`),
    pipelineId,
    usageDigestSha256: createHash('sha256').update(`usage:${pipelineId}`).digest('hex'),
    usageRecordCount: 2,
  };
}

function validBoard(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    pipelineId: 'travis-authz-audit',
    depth: 1,
    correctionCycles: 1,
    pipelineMinutes: 30,
    cards: [
      {
        id: 'implement',
        title: 'Implement the bounded slice',
        status: 'in_progress',
        role: 'engineering-backend-architect',
        mode: 'writer',
        dependencies: [],
        attempts: 1,
        canSpawn: false,
        stopCondition: 'Focused tests and exact diff are available.',
        evidence: [],
        budget: {
          turns: 12,
          toolCalls: 40,
          workerMinutes: 10,
          inputTokens: 12000,
          outputTokens: 4000,
          handoffTokens: 200,
        },
      },
      {
        id: 'review',
        title: 'Review the exact implementation head',
        status: 'ready',
        role: 'testing-reality-checker',
        mode: 'reviewer',
        dependencies: ['implement'],
        attempts: 0,
        canSpawn: false,
        stopCondition: 'Return PASS or findings with file evidence.',
        evidence: [],
        budget: {
          turns: 6,
          toolCalls: 20,
          workerMinutes: 10,
          inputTokens: 6000,
          outputTokens: 2000,
          handoffTokens: 200,
        },
      },
    ],
    ...overrides,
  };
}

test('feature contract is disabled by default and pins the reviewed Agency source', () => {
  const { loadContracts, loadRegistry } = requireApi();
  const registry = loadRegistry(ROOT);
  const contracts = loadContracts(ROOT);

  assert.equal(registry.enabledByDefault, false);
  assert.equal(registry.upstream.commit, 'ebe9c99acb5c96f9468de368d8bead775387d1a7');
  assert.equal(registry.upstream.license, 'MIT');
  assert.equal(registry.roles.length, 4);
  assert.equal(registry.discovery.requiresControllerAttestation, true);
  assert.deepEqual(registry.discovery.trustedRoots, ['workspace:.codex/agents', 'user:.codex/agents']);
  assert.equal(registry.discovery.maxDirectories, 4);
  assert.equal(registry.discovery.maxEntriesPerDirectory, 1000);
  assert.equal(registry.discovery.maxCandidates, 500);
  assert.equal(registry.discovery.maxPrintedCandidates, 50);
  assert.deepEqual(
    registry.roles.map((role) => [role.name, role.sourcePath, role.promptSha256]),
    [
      ['product-sprint-prioritizer', 'product/product-sprint-prioritizer.md', 'da5233770ca85a3931b72d80b37dd09616a54fd24075c607667853acf65b000a'],
      ['engineering-backend-architect', 'engineering/engineering-backend-architect.md', '18f237d054fa91f72a5dcda46a52ddcf7354ea3a3e39e0247629f4ea0f446917'],
      ['engineering-frontend-developer', 'engineering/engineering-frontend-developer.md', '35961da50f408e00eb6189c87825ac5e62e6b1bf9de3dee198a95536c6d2619e'],
      ['testing-reality-checker', 'testing/testing-reality-checker.md', '6d32fcdb114233e13902ec6372d50293b120e85d490b5e81d372c29808f988a1'],
    ]
  );
  assert.equal(contracts.limits.maxDepth, 1);
  assert.equal(contracts.limits.maxFanOut, 3);
  assert.equal(contracts.limits.maxCards, 8);
  assert.equal(contracts.limits.maxAttemptsPerCard, 2);
  assert.equal(contracts.limits.maxCorrectionCycles, 1);
  assert.equal(contracts.limits.maxPipelineMinutes, 30);
  assert.equal(contracts.costCeiling.mode, 'advisory');
  assert.equal(contracts.costCeiling.hardEnforcementRequires, 'verified-controller-accounting');
  assert.equal(contracts.delegation.requiresControllerOptIn, true);
  assert.equal(contracts.delegation.requiresControllerEvidence, true);
  assert.equal(contracts.trust.roleAttestationRequired, true);
  assert.equal(contracts.trust.boardPathsRestrictedToWorkspace, true);
  assert.equal(contracts.trust.terminalOutputSanitized, true);
});

test('runtime discovery returns sorted TOML role names without following symlinks', (t) => {
  const { discoverCodexAgentCandidates, discoverCodexAgents, loadRegistry } = requireApi();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-agents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'zeta.toml'), 'model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(root, 'alpha.toml'), 'model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(root, 'UPPER.TOML'), 'model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(root, 'ignore.md'), 'not an agent');
  try {
    fs.symlinkSync(path.join(root, 'alpha.toml'), path.join(root, 'linked.toml'));
  } catch (_error) {
    // Some Windows environments disallow symlink creation without elevation.
  }

  assert.deepEqual(
    discoverCodexAgentCandidates([root]).map((role) => role.name),
    ['UPPER', 'alpha', 'zeta']
  );
  assert.deepEqual(discoverCodexAgents([root], { registry: loadRegistry(ROOT), attestations: [] }), []);

  const alphaBytes = fs.readFileSync(path.join(root, 'alpha.toml'));
  assert.deepEqual(
    discoverCodexAgents([root], {
      registry: loadRegistry(ROOT),
      attestations: [
        {
          ...attestationBase('agency.role-provenance.v1', 'role-alpha'),
          name: 'alpha',
          repository: 'https://github.com/msitarzewski/agency-agents',
          upstreamCommit: 'ebe9c99acb5c96f9468de368d8bead775387d1a7',
          sourcePath: 'specialized/alpha.md',
          sourcePromptSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          tomlSha256: createHash('sha256').update(alphaBytes).digest('hex'),
        },
      ],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    ['alpha']
  );

  const starterPath = path.join(root, 'engineering-backend-architect.toml');
  fs.writeFileSync(starterPath, 'developer_instructions = "reviewed"\n');
  const starterTomlSha256 = createHash('sha256').update(fs.readFileSync(starterPath)).digest('hex');
  const starterAttestation = {
    ...attestationBase('agency.role-provenance.v1', 'role-engineering-backend-architect'),
    name: 'engineering-backend-architect',
    repository: 'https://github.com/msitarzewski/agency-agents',
    upstreamCommit: 'ebe9c99acb5c96f9468de368d8bead775387d1a7',
    sourcePath: 'engineering/engineering-backend-architect.md',
    sourcePromptSha256: '18f237d054fa91f72a5dcda46a52ddcf7354ea3a3e39e0247629f4ea0f446917',
    tomlSha256: starterTomlSha256,
  };
  assert.deepEqual(
    discoverCodexAgents([root], {
      registry: loadRegistry(ROOT),
      attestations: [starterAttestation],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    ['engineering-backend-architect']
  );
  assert.deepEqual(
    discoverCodexAgents([root], {
      registry: loadRegistry(ROOT),
      attestations: [{ ...starterAttestation, sourcePromptSha256: 'f'.repeat(64) }],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    []
  );
});

test('runtime discovery rejects excessive directory fan-in', () => {
  const { discoverCodexAgents } = requireApi();
  assert.throws(() => discoverCodexAgents(['a', 'b', 'c', 'd', 'e']), /maximum 4 agent directories/i);
});

test('runtime discovery rejects a linked ancestor of an agent directory', (t) => {
  const { discoverCodexAgentCandidates } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-linked-ancestor-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const outside = path.join(temp, 'outside');
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(path.join(outside, 'agents'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(outside, 'agents', 'evil.toml'), 'model = "gpt-5.4"\n');
  try {
    fs.symlinkSync(outside, path.join(workspace, '.codex'));
  } catch (_error) {
    // Some Windows environments disallow symlink creation without elevation.
    t.skip('symlink creation is unavailable in this environment');
    return;
  }

  const linkedAgentDir = path.join(workspace, '.codex', 'agents');
  let discovered = null;
  assert.throws(() => {
    discovered = discoverCodexAgentCandidates([linkedAgentDir]).map((candidate) => candidate.name);
  }, /reparse-point ancestor/i);
  assert.equal(discovered, null);
});

test('runtime discovery canonicalizes and deduplicates coincident agent roots', (t) => {
  const { discoverCodexAgentCandidates, discoverCodexAgents, loadRegistry } = requireApi();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-coincident-roots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, 'sub'));
  const rolePath = path.join(root, 'engineering-backend-architect.toml');
  fs.writeFileSync(rolePath, 'developer_instructions = "reviewed"\n');
  const coincidentDirs = [root, `${root}${path.sep}sub${path.sep}..`];

  assert.deepEqual(
    discoverCodexAgentCandidates(coincidentDirs).map((candidate) => candidate.name),
    ['engineering-backend-architect']
  );

  const attestation = {
    ...attestationBase('agency.role-provenance.v1', 'role-engineering-backend-architect'),
    name: 'engineering-backend-architect',
    repository: 'https://github.com/msitarzewski/agency-agents',
    upstreamCommit: 'ebe9c99acb5c96f9468de368d8bead775387d1a7',
    sourcePath: 'engineering/engineering-backend-architect.md',
    sourcePromptSha256: '18f237d054fa91f72a5dcda46a52ddcf7354ea3a3e39e0247629f4ea0f446917',
    tomlSha256: createHash('sha256').update(fs.readFileSync(rolePath)).digest('hex'),
  };
  assert.deepEqual(
    discoverCodexAgents(coincidentDirs, {
      registry: loadRegistry(ROOT),
      attestations: [attestation],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    ['engineering-backend-architect']
  );
});

test('valid bounded board passes with discovered Agency roles', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /cost ceiling is advisory/i);
});

test('disabled board is a valid no-op and does not require installed roles', () => {
  const { loadContracts, validateBoard } = requireApi();
  const result = validateBoard({ schemaVersion: 1, enabled: false, cards: [] }, loadContracts(ROOT), {
    ...verifiedRoleOptions([]),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.enabled, false);
});

test('board rejects runaway fan-out, nested spawning, multiple writers, and over-budget cards', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    depth: 2,
    correctionCycles: 2,
    cards: Array.from({ length: 9 }, (_, index) => ({
      id: `card-${index}`,
      title: `Card ${index}`,
      status: index < 4 ? 'in_progress' : 'backlog',
      role: 'engineering-backend-architect',
      mode: index < 2 ? 'writer' : 'reviewer',
      dependencies: [],
      attempts: 3,
      canSpawn: true,
      stopCondition: '',
      evidence: [],
      budget: {
        turns: 13,
        toolCalls: 41,
        workerMinutes: 11,
        inputTokens: 12001,
        outputTokens: 4001,
        handoffTokens: 201,
      },
    })),
  });

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const errors = result.errors.join('\n');

  assert.match(errors, /depth.*maximum 1/i);
  assert.match(errors, /correction cycles.*maximum 1/i);
  assert.match(errors, /9 cards.*maximum 8/i);
  assert.match(errors, /4 active cards.*fan-out maximum 3/i);
  assert.match(errors, /exactly one writer/i);
  assert.match(errors, /cannot spawn/i);
  assert.match(errors, /attempts.*maximum 2/i);
  assert.match(errors, /turns.*maximum 12/i);
  assert.match(errors, /toolCalls.*maximum 40/i);
  assert.match(errors, /workerMinutes.*maximum 10/i);
  assert.match(errors, /inputTokens.*maximum 12000/i);
  assert.match(errors, /outputTokens.*maximum 4000/i);
  assert.match(errors, /handoffTokens.*maximum 200/i);
  assert.match(errors, /stopCondition is required/i);
});

test('board enforces dependencies, evidence for done cards, unique IDs, statuses, and installed roles', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    cards: [
      {
        ...validBoard().cards[0],
        id: 'duplicate',
        status: 'done',
        evidence: [],
      },
      {
        ...validBoard().cards[1],
        id: 'duplicate',
        status: 'in_progress',
        role: 'missing-role',
        dependencies: ['not-done'],
      },
    ],
  });
  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const errors = result.errors.join('\n');

  assert.match(errors, /duplicate card id/i);
  assert.match(errors, /done.*evidence/i);
  assert.match(errors, /role missing-role is not verified as installed/i);
  assert.match(errors, /dependency not-done does not exist/i);
});

test('only trusted controller accounting attestation removes the advisory cost warning', () => {
  const { loadContracts, validateBoard } = requireApi();
  const selfAssertedBoard = validBoard({ controllerAccountingVerified: true });
  const selfAsserted = validateBoard(selfAssertedBoard, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(selfAssertedBoard),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const attestedBoard = validBoard();
  const attested = validateBoard(attestedBoard, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(attestedBoard),
    controllerAccountingAttestation: accountingFor('travis-authz-audit'),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.deepEqual(selfAsserted.errors, []);
  assert.equal(selfAsserted.warnings.length, 1);
  assert.deepEqual(attested.errors, []);
  assert.deepEqual(attested.warnings, []);
});

test('attestation purposes are non-interchangeable and require controller authentication', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const evidenceAsOptIn = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: evidenceForBoard(board, 'implement', 'wrong-purpose'),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const unauthenticated = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
  });
  const optInAsAccounting = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAccountingAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(evidenceAsOptIn.errors.join('\n'), /opt-in attestation is required/i);
  assert.match(unauthenticated.errors.join('\n'), /opt-in attestation is required/i);
  assert.equal(optInAsAccounting.errors.length, 0);
  assert.match(optInAsAccounting.warnings.join('\n'), /cost ceiling is advisory/i);
});

test('policy doctor rejects drift from mandatory hard ceilings', () => {
  const { loadContracts, loadRegistry, validatePolicy } = requireApi();
  const registry = structuredClone(loadRegistry(ROOT));
  const contracts = structuredClone(loadContracts(ROOT));
  contracts.limits.maxFanOut = 4;
  contracts.limits.maxPipelineMinutes = 31;
  contracts.delegation.oneWriter = false;
  contracts.boardStatuses = [];
  contracts.activeStatuses = [];
  contracts.workerModes = [];
  contracts.costCeiling.hardEnforcementRequires = 'trust-me';

  const errors = validatePolicy(registry, contracts).join('\n');
  assert.match(errors, /maxFanOut must be 3/);
  assert.match(errors, /maxPipelineMinutes must be 30/);
  assert.match(errors, /delegation.oneWriter must be true/);
  assert.match(errors, /boardStatuses must be exactly/);
  assert.match(errors, /activeStatuses must be exactly/);
  assert.match(errors, /workerModes must be exactly/);
  assert.match(errors, /hardEnforcementRequires must be verified-controller-accounting/);
});

test('board validation fails closed when contract policy vocabulary drifts', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = structuredClone(loadContracts(ROOT));
  contracts.activeStatuses = [];
  contracts.delegation.requiresEvidenceForDone = false;

  const result = validateBoard(validBoard(), contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(validBoard()),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /board validation refused because policy is invalid/i);
  assert.match(result.errors.join('\n'), /activeStatuses must be exactly/i);
  assert.match(result.errors.join('\n'), /requiresEvidenceForDone must be true/i);
});

test('enabled board requires controller opt-in and controller-verified completion evidence', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    cards: [
      {
        ...validBoard().cards[0],
        status: 'done',
        evidence: ['claimed-test-output'],
      },
      {
        ...validBoard().cards[1],
        status: 'in_progress',
        dependencies: ['implement'],
      },
    ],
  });
  const selfAsserted = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
  });
  const attested = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    evidenceAttestations: [evidenceForBoard(board, 'implement', 'claimed-test-output')],
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(selfAsserted.errors.join('\n'), /trusted controller opt-in attestation is required/i);
  assert.match(selfAsserted.errors.join('\n'), /evidence claimed-test-output is not controller-verified/i);
  assert.deepEqual(attested.errors, []);
});

test('policy doctor rejects source-pin and discovery-safety drift', () => {
  const { loadContracts, loadRegistry, validatePolicy } = requireApi();
  const registry = structuredClone(loadRegistry(ROOT));
  registry.upstream.repository = 'https://example.invalid/agent-catalog';
  registry.upstream.commit = '0000000000000000000000000000000000000000';
  registry.discovery.mode = 'download-everything';
  registry.discovery.vendorPrompts = true;
  registry.discovery.globalMutation = true;
  registry.discovery.maxCandidates = 501;

  const errors = validatePolicy(registry, loadContracts(ROOT)).join('\n');
  assert.match(errors, /upstream.repository must be https:\/\/github.com\/msitarzewski\/agency-agents/);
  assert.match(errors, /upstream.commit must be ebe9c99acb5c96f9468de368d8bead775387d1a7/);
  assert.match(errors, /discovery.mode must be runtime-installed-codex-toml/);
  assert.match(errors, /discovery.vendorPrompts must be false/);
  assert.match(errors, /discovery.globalMutation must be false/);
  assert.match(errors, /discovery.maxCandidates must be 500/);
});

test('board rejects pipeline overrun, a second writer, and dependency cycles', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    pipelineMinutes: 31,
    cards: [
      {
        ...validBoard().cards[0],
        dependencies: ['review'],
      },
      {
        ...validBoard().cards[1],
        mode: 'writer',
        dependencies: ['implement'],
      },
    ],
  });
  const errors = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  }).errors.join('\n');

  assert.match(errors, /pipelineMinutes 31 exceeds maximum 30/);
  assert.match(errors, /exactly one writer; found 2/);
  assert.match(errors, /dependency cycle/i);
});

test('repository example boards encode a passing bounded case and a rejected runaway case', () => {
  const { loadContracts, readJsonFile, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const valid = readJsonFile(path.join(ROOT, 'evals/agency-orchestration/valid-board.json'));
  const runaway = readJsonFile(path.join(ROOT, 'evals/agency-orchestration/runaway-board.json'));
  const roles = ['product-sprint-prioritizer', 'engineering-backend-architect', 'testing-reality-checker'];

  assert.deepEqual(
    validateBoard(valid, contracts, {
      ...verifiedRoleOptions(roles),
      optInAttestation: optInFor(valid),
      evidenceAttestations: [evidenceForBoard(valid, 'prioritize', 'scope-packet-recorded')],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }).errors,
    []
  );
  assert.notDeepEqual(
    validateBoard(runaway, contracts, {
      ...verifiedRoleOptions(roles),
      optInAttestation: optInFor(runaway),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }).errors,
    []
  );
});

test('agency-doctor confines board paths to the allowed root', (t) => {
  const { runAgencyDoctor } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-board-root-'));
  const allowedRoot = path.join(temp, 'allowed');
  const outsideBoard = path.join(temp, 'outside.json');
  fs.mkdirSync(allowedRoot);
  fs.writeFileSync(outsideBoard, JSON.stringify({ schemaVersion: 1, enabled: false, cards: [] }));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: temp,
    agentDirs: [],
    boardPath: outsideBoard,
    boardRoot: allowedRoot,
    print: false,
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /outside the allowed board root/i);
});

test('agency-doctor restricts injected agent directories to the declared trusted roots', (t) => {
  const { runAgencyDoctor } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-trusted-roots-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const workspace = path.join(temp, 'workspace');
  const untrusted = path.join(temp, 'untrusted');
  const workspaceAgents = path.join(workspace, '.codex', 'agents');
  fs.mkdirSync(workspaceAgents, { recursive: true });
  fs.mkdirSync(untrusted, { recursive: true });
  fs.writeFileSync(path.join(untrusted, 'injected.toml'), 'model = "gpt-5.4"\n');
  fs.writeFileSync(path.join(workspaceAgents, 'permitted.toml'), 'model = "gpt-5.4"\n');

  const injected = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: workspace,
    agentDirs: [untrusted],
    print: false,
  });
  assert.deepEqual(injected.candidates, []);
  assert.equal(injected.exitCode, 1);
  assert.match(injected.output, /role discovery: FAIL/);
  assert.match(injected.output, /outside the declared trusted roots/i);

  const permitted = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: workspace,
    agentDirs: [workspaceAgents],
    print: false,
  });
  assert.deepEqual(permitted.candidates, ['permitted']);
  assert.equal(permitted.exitCode, 0);
});

test('contained reads reject a parent-directory swap between path check and open', (t) => {
  const { readJsonFile } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-board-race-'));
  const allowedRoot = path.join(temp, 'allowed');
  const parent = path.join(allowedRoot, 'current');
  const originalParent = path.join(allowedRoot, 'original');
  const replacement = path.join(allowedRoot, 'replacement');
  const boardPath = path.join(parent, 'board.json');
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(replacement);
  fs.writeFileSync(boardPath, JSON.stringify({ schemaVersion: 1, enabled: false, cards: [] }));
  fs.writeFileSync(
    path.join(replacement, 'board.json'),
    JSON.stringify({ schemaVersion: 1, enabled: true, pipelineId: 'swapped', cards: [] })
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = function guardedOpenSync(target, flags, ...rest) {
    if (!swapped && path.resolve(String(target)).toLowerCase() === path.resolve(boardPath).toLowerCase()) {
      swapped = true;
      fs.renameSync(parent, originalParent);
      fs.renameSync(replacement, parent);
    }
    return originalOpenSync.call(fs, target, flags, ...rest);
  };
  try {
    assert.throws(
      () => readJsonFile(boardPath, { allowedRoot }),
      /changed before it was opened|path changed while being read|containment changed while being read/i
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.equal(swapped, true);
});

test('untrusted board tokens are bounded and escaped in validation output', () => {
  const { loadContracts, validateBoard } = requireApi();
  const unsafeRole = `bad\u001b]0;owned\u0007${'x'.repeat(500)}`;
  const board = validBoard();
  board.cards[0].role = unsafeRole;
  const output = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions([]),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  }).errors.join('\n');

  assert.doesNotMatch(output, /\u001b/);
  assert.match(output, /\\u001b/);
  assert.ok(output.length < 4000);
});

test('terminal output escapes Unicode bidi, isolate, zero-width, and line-separator controls', (t) => {
  const { runAgencyDoctor } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-unicode-'));
  const board = validBoard();
  board.cards[0].role = 'bad\u202Erole\u2066\u200B\u2028tail';
  const boardPath = path.join(temp, 'board.json');
  fs.writeFileSync(boardPath, JSON.stringify(board));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: temp,
    agentDirs: [],
    boardPath,
    boardRoot: temp,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
    print: false,
  });

  for (const character of ['\u202E', '\u2066', '\u200B', '\u2028']) {
    assert.doesNotMatch(result.output, new RegExp(character));
  }
  assert.match(result.output, /\\u202e/);
  assert.match(result.output, /\\u2066/);
  assert.match(result.output, /\\u200b/);
  assert.match(result.output, /\\u2028/);
});

test('board validation caps evidence, dependencies, and work on excess cards', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  board.cards[0].status = 'done';
  board.cards[0].evidence = Array.from({ length: 33 }, (_, index) => `evidence-${index}`);
  board.cards[0].dependencies = Array.from({ length: 9 }, (_, index) => `dependency-${index}`);
  board.cards.push(
    ...Array.from({ length: 20_000 }, (_, index) => ({
      id: `excess-${index}`,
      status: 'in_progress',
      mode: 'writer',
    }))
  );

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const output = result.errors.join('\n');

  assert.match(output, /20002 cards; maximum 8/i);
  // The card cap bounds how many cards are validated, keeping the output bounded
  // even for an enormous board.
  assert.match(output, /33 evidence ids; maximum 32/i);
  assert.match(output, /9 dependencies; maximum 8/i);
  assert.doesNotMatch(output, /exactly one writer; found 20001/i);
  assert.ok(output.length < 8000);
});

test('agency-doctor reports policy-load failure without throwing a stack trace', (t) => {
  const { runAgencyDoctor } = requireApi();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-missing-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = runAgencyDoctor({ pluginRoot: root, print: false });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /policy: FAIL/);
  assert.match(result.output, /unable to load agency policy/i);
  assert.doesNotMatch(result.output, /\n\s+at /);
});

test('agency-doctor is deterministic, read-only, and reports disabled-by-default state', () => {
  requireApi();
  const run = () =>
    spawnSync(process.execPath, ['scripts/jarvis.js', 'agency-doctor'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
    });
  const first = run();
  const second = run();

  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /agency orchestration: DISABLED by default/i);
  assert.match(first.stdout, /policy: PASS/i);
  assert.match(first.stdout, /discovered Codex roles \(unverified candidates\):/i);
  assert.match(first.stdout, /verified Agency roles:/i);
});

test('operator skill is mirrored and states every hard delegation boundary', () => {
  const pluginSkill = fs.readFileSync(path.join(ROOT, 'skills/agency-orchestration/SKILL.md'), 'utf8');
  const codexSkill = fs.readFileSync(path.join(ROOT, '.agents/skills/agency-orchestration/SKILL.md'), 'utf8');

  assert.equal(pluginSkill, codexSkill);
  for (const phrase of [
    'disabled by default',
    'one writer',
    'maximum fan-out: 3',
    'maximum board size: 8 cards',
    'workers may not spawn',
    'one correction cycle',
    '12 turns',
    '40 tool calls',
    '10 minutes per worker',
    '30 minutes per pipeline',
    '12,000 input tokens',
    '4,000 output tokens',
    '200-token handoff',
    'untrusted',
    'advisory',
  ]) {
    assert.ok(pluginSkill.toLowerCase().includes(phrase.toLowerCase()), `missing boundary phrase: ${phrase}`);
  }
});

test('Codex registers a read-only orchestrator while preserving depth and thread ceilings', () => {
  const config = fs.readFileSync(path.join(ROOT, '.codex/config.toml'), 'utf8');
  const agent = fs.readFileSync(path.join(ROOT, '.codex/agents/agency-orchestrator.toml'), 'utf8');
  const rootInstructions = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

  assert.match(config, /max_concurrent_threads_per_session = 6/);
  assert.match(config, /max_depth = 1/);
  assert.match(config, /\[agents\.agency_orchestrator\]/);
  assert.match(agent, /sandbox_mode = "read-only"/);
  assert.match(agent, /never implement/i);
  assert.match(agent, /workers may not spawn/i);
  assert.match(rootInstructions, /explicit opt-in/i);
  assert.match(rootInstructions, /lowest capable model tier/i);
});

test('plugin metadata, command, README, and integration notes publish one consistent version and provenance', () => {
  const plugin = readRepoJson('.claude-plugin/plugin.json');
  const marketplace = readRepoJson('.claude-plugin/marketplace.json');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const integration = fs.readFileSync(path.join(ROOT, 'integrations/agency-agents/README.md'), 'utf8');
  const command = fs.readFileSync(path.join(ROOT, 'commands/agency-doctor.md'), 'utf8');

  assert.equal(plugin.version, '2.0.0');
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.match(readme, /agency-doctor/);
  assert.match(readme, /Agency Agents/);
  assert.match(integration, /ebe9c99acb5c96f9468de368d8bead775387d1a7/);
  assert.match(integration, /MIT/);
  assert.match(integration, /does not vendor/i);
  assert.match(command, /scripts\/jarvis\.js agency-doctor/);
});

test('board rejects a done card that depends on an unfinished card', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    cards: [
      {
        ...validBoard().cards[0],
        id: 'implement',
        status: 'done',
        dependencies: ['groundwork'],
        evidence: ['implement-verified'],
      },
      {
        ...validBoard().cards[1],
        id: 'groundwork',
        status: 'backlog',
        dependencies: [],
      },
    ],
  });
  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    evidenceAttestations: [evidenceForBoard(board, 'implement', 'implement-verified')],
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(
    result.errors.join('\n'),
    /cannot be done until dependency groundwork has controller-verified done evidence/i
  );
});

test('board enforces the declared maxActiveWriters limit', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard({
    cards: [
      {
        ...validBoard().cards[0],
        status: 'in_progress',
        mode: 'writer',
        dependencies: [],
      },
      {
        ...validBoard().cards[1],
        status: 'review',
        mode: 'writer',
        dependencies: [],
      },
    ],
  });
  const result = validateBoard(board, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.equal(contracts.limits.maxActiveWriters, 1);
  assert.match(result.errors.join('\n'), /2 active writer cards; active writer maximum 1/i);
});

test('policy doctor rejects starter role routing-metadata drift', () => {
  const { loadContracts, loadRegistry, validatePolicy } = requireApi();
  const contracts = loadContracts(ROOT);

  const swappedCapabilities = structuredClone(loadRegistry(ROOT));
  swappedCapabilities.roles.find((role) => role.name === 'engineering-backend-architect').capabilities = [
    'frontend-implementation',
    'responsive-ui',
    'accessibility',
  ];
  assert.match(
    validatePolicy(swappedCapabilities, contracts).join('\n'),
    /registry starter role engineering-backend-architect capabilities drifted/
  );

  const deletedCapabilities = structuredClone(loadRegistry(ROOT));
  delete deletedCapabilities.roles.find((role) => role.name === 'testing-reality-checker').capabilities;
  assert.match(
    validatePolicy(deletedCapabilities, contracts).join('\n'),
    /registry starter role testing-reality-checker capabilities drifted/
  );

  const relabelled = structuredClone(loadRegistry(ROOT));
  const prioritizer = relabelled.roles.find((role) => role.name === 'product-sprint-prioritizer');
  prioritizer.title = 'Backend Architect';
  prioritizer.division = 'engineering';
  const relabelledErrors = validatePolicy(relabelled, contracts).join('\n');
  assert.match(relabelledErrors, /registry starter role product-sprint-prioritizer title drifted/);
  assert.match(relabelledErrors, /registry starter role product-sprint-prioritizer division drifted/);

  assert.deepEqual(validatePolicy(loadRegistry(ROOT), contracts), []);
});

test('exported board validation authenticates roles instead of trusting caller-supplied names', () => {
  const { loadContracts, loadRegistry, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard();

  const selfAsserted = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  const selfAssertedErrors = selfAsserted.errors.join('\n');
  assert.match(selfAssertedErrors, /role engineering-backend-architect is not verified as installed/);
  assert.match(selfAssertedErrors, /role testing-reality-checker is not verified as installed/);

  const unauthenticated = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    roleAttestations: [
      roleAttestationFor('engineering-backend-architect'),
      roleAttestationFor('testing-reality-checker'),
    ],
    optInAttestation: optInFor(board),
  });
  assert.match(
    unauthenticated.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );

  const attested = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    roleAttestations: [
      roleAttestationFor('engineering-backend-architect'),
      roleAttestationFor('testing-reality-checker'),
    ],
    registryRoles: loadRegistry(ROOT).roles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(attested.errors, []);

  const narrowed = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect'],
    roleAttestations: [
      roleAttestationFor('engineering-backend-architect'),
      roleAttestationFor('testing-reality-checker'),
    ],
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(narrowed.errors.join('\n'), /role testing-reality-checker is not verified as installed/);
});

function roleAttestationFor(name) {
  const registered = requireApi()
    .loadRegistry(ROOT)
    .roles.find((role) => role && role.name === name);
  return {
    ...attestationBase('agency.role-provenance.v1', `role-${name}`),
    name,
    repository: 'https://github.com/msitarzewski/agency-agents',
    upstreamCommit: 'ebe9c99acb5c96f9468de368d8bead775387d1a7',
    sourcePath: registered ? registered.sourcePath : `specialized/${name}.md`,
    sourcePromptSha256: registered ? registered.promptSha256 : 'a'.repeat(64),
    tomlSha256: createHash('sha256').update(`installed-toml:${name}`).digest('hex'),
  };
}

function verifiedRoleOptions(names) {
  return {
    verifiedRoles: names,
    roleAttestations: names.map((name) => roleAttestationFor(name)),
  };
}

function readRepoJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

// An opt-in binds the pipeline id, a controller decision id, and (F6) a digest
// of the exact board declaration the controller approved. Falls back to an
// unbound opt-in when the board itself cannot be digested (see tryBoardDigest
// above) - irrelevant in those tests since the board is rejected earlier.
function optInFor(board) {
  const base = rawOptInFor(board);
  const digestResult = tryBoardDigest(board);
  if (!digestResult.ok) return base;
  return { ...base, boardBindingKind: BOARD_BINDING_KIND, boardDigest: digestResult.digest };
}

test('starter role provenance is pinned even when registryRoles is omitted', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard();

  const forged = {
    ...roleAttestationFor('engineering-backend-architect'),
    sourcePath: 'attacker/arbitrary-prompt.md',
    sourcePromptSha256: '0'.repeat(64),
  };
  const forgedResult = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    roleAttestations: [forged, roleAttestationFor('testing-reality-checker')],
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(
    forgedResult.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );

  // The fallback must pin provenance, not blanket-deny a correct attestation.
  const honestResult = validateBoard(board, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(honestResult.errors, []);
});

test('terminal output escapes U+061C ARABIC LETTER MARK', (t) => {
  const { runAgencyDoctor } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-alm-'));
  const board = validBoard();
  board.cards[0].role = 'bad\u061Crole';
  const boardPath = path.join(temp, 'board.json');
  fs.writeFileSync(boardPath, JSON.stringify(board));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: temp,
    agentDirs: [],
    boardPath,
    boardRoot: temp,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
    print: false,
  });

  assert.doesNotMatch(result.output, new RegExp('\u061C'));
  assert.match(result.output, /\\u061c/);
});

test('a caller-supplied registry cannot redefine a pinned starter role', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard();

  // A forged attestation for a reserved starter name, plus a matching forged
  // registry record so the two agree with each other. The pinned entry has to
  // outrank the caller's registry or the pair validates itself.
  const forgedAttestation = {
    ...roleAttestationFor('engineering-backend-architect'),
    sourcePath: 'attacker/arbitrary-prompt.md',
    sourcePromptSha256: '0'.repeat(64),
  };
  const forgedRegistryRoles = [
    {
      name: 'engineering-backend-architect',
      title: 'Backend Architect',
      division: 'engineering',
      sourcePath: 'attacker/arbitrary-prompt.md',
      promptSha256: '0'.repeat(64),
      capabilities: ['backend-architecture', 'api-design', 'data-boundaries'],
    },
  ];

  const forgedResult = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    roleAttestations: [forgedAttestation, roleAttestationFor('testing-reality-checker')],
    registryRoles: forgedRegistryRoles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(
    forgedResult.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );

  // Pinning must not blanket-deny: a correct starter attestation still passes
  // while the same forged registry record is supplied alongside it.
  const honestResult = validateBoard(board, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    registryRoles: forgedRegistryRoles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(honestResult.errors, []);
});

test('a non-starter role still resolves through the caller-supplied registry', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard();
  board.cards[1].role = 'specialized-custom-reviewer';
  const names = ['engineering-backend-architect', 'specialized-custom-reviewer'];
  const registryRoles = [
    {
      name: 'specialized-custom-reviewer',
      sourcePath: 'specialized/specialized-custom-reviewer.md',
      promptSha256: 'a'.repeat(64),
    },
  ];

  const accepted = validateBoard(board, contracts, {
    ...verifiedRoleOptions(names),
    registryRoles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(accepted.errors, []);

  const mismatched = validateBoard(board, contracts, {
    ...verifiedRoleOptions(names),
    registryRoles: [{ ...registryRoles[0], promptSha256: 'f'.repeat(64) }],
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(
    mismatched.errors.join('\n'),
    /role specialized-custom-reviewer is not verified as installed/
  );
});

test('runtime discovery pins starter provenance over a drifted registry entry', (t) => {
  const { discoverCodexAgents } = requireApi();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-pinned-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const starterPath = path.join(root, 'engineering-backend-architect.toml');
  fs.writeFileSync(starterPath, 'developer_instructions = "reviewed"\n');
  const tomlSha256 = createHash('sha256').update(fs.readFileSync(starterPath)).digest('hex');
  const forged = {
    ...attestationBase('agency.role-provenance.v1', 'role-engineering-backend-architect'),
    name: 'engineering-backend-architect',
    repository: 'https://github.com/msitarzewski/agency-agents',
    upstreamCommit: 'ebe9c99acb5c96f9468de368d8bead775387d1a7',
    sourcePath: 'attacker/arbitrary-prompt.md',
    sourcePromptSha256: '0'.repeat(64),
    tomlSha256,
  };
  const driftedRegistry = {
    roles: [
      {
        name: 'engineering-backend-architect',
        sourcePath: 'attacker/arbitrary-prompt.md',
        promptSha256: '0'.repeat(64),
      },
    ],
  };

  // runAgencyDoctor runs discovery even when validatePolicy has already
  // reported errors, so a drifted registry.json must not drive discovery.
  assert.deepEqual(
    discoverCodexAgents([root], {
      registry: driftedRegistry,
      attestations: [forged],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    []
  );

  assert.deepEqual(
    discoverCodexAgents([root], {
      registry: driftedRegistry,
      attestations: [
        {
          ...forged,
          sourcePath: 'engineering/engineering-backend-architect.md',
          sourcePromptSha256: '18f237d054fa91f72a5dcda46a52ddcf7354ea3a3e39e0247629f4ea0f446917',
        },
      ],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    }),
    ['engineering-backend-architect']
  );
});

// ---------------------------------------------------------------------------
// JCC-133: a malformed registry must produce a bounded policy FAIL, never an
// uncaught TypeError from an unguarded registry.upstream/roles read.
// ---------------------------------------------------------------------------

test('agency-doctor reports a malformed registry as policy FAIL without a stack trace', (t) => {
  const { runAgencyDoctor } = requireApi();
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-malformed-registry-'));
  t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));

  const integrationDir = path.join(pluginRoot, 'integrations', 'agency-agents');
  fs.mkdirSync(integrationDir, { recursive: true });
  // A registry with no upstream, no roles, no discovery: the old code read
  // registry.upstream.repository unconditionally and threw a TypeError.
  fs.writeFileSync(path.join(integrationDir, 'registry.json'), '{"schemaVersion":1}');
  fs.copyFileSync(
    path.join(ROOT, 'integrations', 'agency-agents', 'contracts.json'),
    path.join(integrationDir, 'contracts.json')
  );

  let result;
  assert.doesNotThrow(() => {
    result = runAgencyDoctor({ pluginRoot, print: false });
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /policy: FAIL/);
  assert.doesNotMatch(result.output, /\n\s+at /);
});

// ---------------------------------------------------------------------------
// Attestation TOCTOU: purpose predicates must read every bound field from the
// authenticated snapshot the verifier saw, never from the original object, so a
// getter/Proxy cannot authenticate one value and re-read a different one.
// ---------------------------------------------------------------------------

test('opt-in bound fields are read from the authenticated snapshot, defeating a getter TOCTOU', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();

  // A controller opt-in whose pipelineId is a getter: it returns a decoy id on
  // the read the verifier authenticates, then the board's real pipelineId on a
  // later re-read, so a predicate that re-reads the original object would treat
  // an opt-in signed for one pipeline as authorising a different board.
  const optIn = optInFor(board);
  delete optIn.pipelineId;
  let reads = 0;
  Object.defineProperty(optIn, 'pipelineId', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? 'decoy-pipeline' : board.pipelineId;
    },
  });

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optIn,
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /opt-in attestation is required/i);
});

// CR2: prove the snapshot invariant with PLAIN data. The accessor-based test
// above is rejected for its shape (the getter never survives isPlainDataAttestation),
// so it does not exercise the snapshot-read path. This companion keeps the opt-in
// plain data and mutates the ORIGINAL object from INSIDE the verifier - after the
// authenticated snapshot was frozen. A predicate that re-read the live object
// would now see the board's real pipelineId and wrongly authorise the opt-in;
// reading the frozen snapshot keeps the decoy id, so the opt-in stays rejected.
test('opt-in bound fields come from the authenticated snapshot, not a later re-read', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();

  // Plain-data opt-in carrying a decoy pipelineId that does not match the board.
  const optIn = optInFor(board);
  optIn.pipelineId = 'decoy-pipeline';

  const result = validateBoard(board, loadContracts(ROOT), {
    // No role attestations and an empty verifiedRoles set, so the verifier fires
    // only for the opt-in-kind call and never pre-fires on a role attestation.
    roleAttestations: [],
    verifiedRoles: [],
    optInAttestation: optIn,
    controllerAttestationVerifier(attestation, context) {
      if (context.kind === 'agency.pipeline-opt-in.v1') {
        // Mutate the ORIGINAL object after the snapshot was frozen. The predicate
        // reads the frozen snapshot, so this decoy-to-real flip must not take.
        optIn.pipelineId = board.pipelineId;
      }
      return attestation.controllerProof === TEST_CONTROLLER_PROOF;
    },
  });

  // The decoy id stood in the frozen snapshot, so the opt-in is still rejected.
  assert.match(result.errors.join('\n'), /opt-in attestation is required/i);
});

// ---------------------------------------------------------------------------
// boardRoot containment: agency-doctor must refuse a board root outside the
// workspace root, per boardPathsRestrictedToWorkspace, instead of validating a
// board that lives outside the workspace.
// ---------------------------------------------------------------------------

test('agency-doctor rejects a board root outside the workspace root', (t) => {
  const { runAgencyDoctor } = requireApi();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-board-root-workspace-'));
  const workspace = path.join(temp, 'workspace');
  const sibling = path.join(temp, 'sibling');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  const board = path.join(sibling, 'board.json');
  fs.writeFileSync(board, JSON.stringify({ schemaVersion: 1, enabled: false, cards: [] }));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runAgencyDoctor({
    pluginRoot: ROOT,
    workspaceRoot: workspace,
    agentDirs: [],
    boardPath: board,
    boardRoot: sibling,
    print: false,
  });

  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.output, /board: PASS/);
  assert.match(result.output, /board root is outside the workspace root/i);
});

// ---------------------------------------------------------------------------
// CARD A: validateBoard must reject a non-plain-data board at the exported
// boundary. A getter on a board/card/budget field is an accessor TOCTOU - it
// can hand a passing value to validation and a hostile value when the host
// later reads the same live object. A pathologically deep board must return a
// bounded error, never a RangeError from unbounded traversal.
// ---------------------------------------------------------------------------

test('validateBoard rejects a board whose budget field is an accessor (accessor TOCTOU)', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  let reads = 0;
  delete board.cards[0].budget.turns;
  Object.defineProperty(board.cards[0].budget, 'turns', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? 12 : 9999;
    },
  });

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /plain data/i);
});

test('validateBoard rejects a board whose field is a Proxy that lies on get (Proxy TOCTOU)', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  // A Proxy whose property descriptors mirror its target (turns: 12) but whose
  // get trap returns a hostile 9999 on the live [[Get]] validateBoard performs.
  // Descriptor inspection cannot catch this divergence, so the board must be
  // rejected as non-plain data at the boundary before any field is read.
  const realBudget = { ...board.cards[0].budget };
  board.cards[0].budget = new Proxy(realBudget, {
    get(target, key) {
      return key === 'turns' ? 9999 : target[key];
    },
  });

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /plain data/i);
});

test('validateBoard returns a bounded error for a pathologically deep board instead of throwing', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  let cursor = board;
  for (let i = 0; i < 20_000; i += 1) {
    cursor.deeper = {};
    cursor = cursor.deeper;
  }

  let result;
  assert.doesNotThrow(() => {
    result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(board),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
  });
  assert.match(result.errors.join('\n'), /plain data/i);
});

// CX1: a Proxy attestation whose getPrototypeOf trap throws must fail closed, not
// crash validateBoard. isPlainDataAttestation reflects over the attestation
// (Object.getPrototypeOf) before any verifier try/catch, so a throwing trap
// escapes and propagates. util.types.isProxy reads an internal slot and cannot be
// spoofed, so the attestation is rejected outright and its role stays ineligible.
test('validateBoard fails closed on a Proxy attestation with a throwing trap', () => {
  const { loadContracts, loadRegistry, validateBoard } = requireApi();
  const board = validBoard();

  const plainRole = roleAttestationFor('engineering-backend-architect');
  const throwingProxy = new Proxy(plainRole, {
    getPrototypeOf() {
      throw new Error('trap boom');
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = validateBoard(board, loadContracts(ROOT), {
      verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
      roleAttestations: [throwingProxy, roleAttestationFor('testing-reality-checker')],
      registryRoles: loadRegistry(ROOT).roles,
      optInAttestation: optInFor(board),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
  });

  // The Proxy-wrapped attestation is rejected, so its role is not eligible.
  assert.match(
    result.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );
});

// CX3: a sparse cards array must be rejected as non-plain data. forEach/filter/
// Reflect.ownKeys all skip holes, so a hole is silently ignored and a host
// iterating the "validated" declaration reads undefined where a card is required.
test('validateBoard rejects a board with a sparse cards array', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const [writer, reviewer] = board.cards;
  // A real hole at index 1: only indices 0 and 2 are set.
  const sparse = [writer];
  sparse[2] = reviewer;
  board.cards = sparse;

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /plain data/i);
});

// CX4: the plain-data walk must bound total enumerated properties, not just object
// nodes. A large dense primitive array under an ignored field is one node (under
// the node cap) but materializing and scanning every leaf is unbounded work (DoS).
// The enumeration bound rejects it as non-plain data, quickly.
test('validateBoard bounds enumeration work on a wide primitive array', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  board.metadata = new Array(200000).fill(0);

  let result;
  assert.doesNotThrow(() => {
    result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(board),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
  });

  assert.match(result.errors.join('\n'), /plain data/i);
});

// ---------------------------------------------------------------------------
// CARD B: the discovery-derived verifiedRoles set is mandatory for eligibility.
// An authenticated role-provenance attestation alone must not make a role
// eligible; the role must also appear in the caller-supplied discovery-derived
// verifiedRoles set. Omitting verifiedRoles fails closed (no role eligible), so
// a stale attestation cannot keep authorising a role after its TOML changed.
// ---------------------------------------------------------------------------

test('an authenticated role attestation without a discovery-derived verifiedRoles set is rejected', () => {
  const { loadContracts, loadRegistry, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  const board = validBoard();

  const noVerifiedRoles = validateBoard(board, contracts, {
    roleAttestations: [
      roleAttestationFor('engineering-backend-architect'),
      roleAttestationFor('testing-reality-checker'),
    ],
    registryRoles: loadRegistry(ROOT).roles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(
    noVerifiedRoles.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );
  assert.match(
    noVerifiedRoles.errors.join('\n'),
    /role testing-reality-checker is not verified as installed/
  );

  const withVerifiedRoles = validateBoard(board, contracts, {
    verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
    roleAttestations: [
      roleAttestationFor('engineering-backend-architect'),
      roleAttestationFor('testing-reality-checker'),
    ],
    registryRoles: loadRegistry(ROOT).roles,
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(withVerifiedRoles.errors, []);
});

// ---------------------------------------------------------------------------
// CARD C: evidence attestations must be authenticated at most once per
// attestation and indexed, not re-verified in a nested card x evidence x
// attestation scan. Behaviour is unchanged; only the verifier call count drops.
// ---------------------------------------------------------------------------

test('evidence is authenticated at most once per attestation and still gates done cards', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);

  // Behaviour preserved: a done card whose evidence is controller-verified still
  // validates.
  const validWithEvidence = validBoard({
    cards: [
      { ...validBoard().cards[0], status: 'done', dependencies: [], evidence: ['implement-verified'] },
      { ...validBoard().cards[1], status: 'ready', dependencies: ['implement'] },
    ],
  });
  const validated = validateBoard(validWithEvidence, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(validWithEvidence),
    evidenceAttestations: [evidenceForBoard(validWithEvidence, 'implement', 'implement-verified')],
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(validated.errors, []);

  // The evidence verifier is invoked at most once per evidence attestation, not
  // once per (card x evidence x attestation) combination.
  const board = validBoard({
    cards: [
      {
        ...validBoard().cards[0],
        status: 'done',
        dependencies: [],
        evidence: ['ev-0', 'ev-1', 'ev-2', 'ev-3'],
      },
      { ...validBoard().cards[1], status: 'ready', dependencies: [] },
    ],
  });
  const evidenceAttestations = Array.from({ length: 20 }, (_, index) =>
    evidenceFor('unrelated-pipeline', 'implement', `noise-${index}`)
  );
  let evidenceVerifierCalls = 0;
  const countingVerifier = (attestation, context) => {
    if (attestation && attestation.kind === 'agency.card-evidence.v1') evidenceVerifierCalls += 1;
    return testControllerAttestationVerifier(attestation, context);
  };
  validateBoard(board, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    evidenceAttestations,
    controllerAttestationVerifier: countingVerifier,
  });
  assert.ok(
    evidenceVerifierCalls <= evidenceAttestations.length,
    `evidence verifier invoked ${evidenceVerifierCalls} times for ${evidenceAttestations.length} attestations`
  );
});

test('discoverCodexAgents does not crash on a malformed registry role entry', (t) => {
  const { discoverCodexAgents } = requireApi();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agency-malformed-role-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  // A null (non-object) entry in registry.roles must be skipped, not crash the
  // exported API - matching the plain-data hardening the boards path already has.
  let result;
  assert.doesNotThrow(() => {
    result = discoverCodexAgents([tempDir], { registry: { roles: [null] }, attestations: [] });
  });
  assert.deepEqual(result, []);
});

test('escapeTerminalLine strips unsafe terminal characters', () => {
  const { escapeTerminalLine } = requireApi();
  // ESC, a C0 control (BEL), a right-to-left override, and a zero-width space.
  const unsafe = 'safe\u001b\u0007\u202e\u200btext';
  const escaped = escapeTerminalLine(unsafe);
  // None of the raw unsafe characters survive (same set as UNSAFE_DISPLAY_CHARACTERS_GLOBAL).
  assert.doesNotMatch(
    escaped,
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/
  );
  // The ESC is rendered as a \uXXXX escape instead of the raw byte.
  assert.ok(escaped.includes('\\u001b'), `expected \\u001b escape in ${JSON.stringify(escaped)}`);
  // Plain ASCII passes through unchanged.
  assert.equal(escapeTerminalLine('plain ascii 123'), 'plain ascii 123');
});

test('safeErrorMessage does not throw on a hostile error object', () => {
  const { safeErrorMessage } = requireApi();
  // A thrown value whose `message` is a getter that throws models a hostile
  // error escaping the agency-doctor CLI backstop. Reading it must not throw.
  const hostile = { get message() { throw new Error('getter boom'); } };
  assert.doesNotThrow(() => safeErrorMessage(hostile));
  assert.equal(safeErrorMessage(hostile), 'unknown error');
  // The normal case: a plain Error with a string message yields that message.
  assert.equal(safeErrorMessage(new Error('plain message')), 'plain message');
  // Non-object / non-string message inputs fall back to the sentinel.
  assert.equal(safeErrorMessage(null), 'unknown error');
  assert.equal(safeErrorMessage({ message: 42 }), 'unknown error');
});

// ---------------------------------------------------------------------------
// CX-a: no attestation field may be read until the attestation has passed a
// non-Proxy/plain-data gate. A role attestation that is a Proxy whose get trap
// throws on `.name` must fail closed (the role stays ineligible), never crash
// deriveTrustedBoardRoles with the trap error.
// ---------------------------------------------------------------------------

test('validateBoard fails closed on a role-attestation Proxy with a throwing get trap', () => {
  const { loadContracts, loadRegistry, validateBoard } = requireApi();
  const board = validBoard();

  // A Proxy wrapping a valid plain role attestation, whose get trap throws the
  // instant any code reads `.name`. Before the structural fix, deriveTrustedBoardRoles
  // read `attestation.name` before any plain-data/Proxy gate, so this crashed
  // validateBoard instead of failing closed.
  const plainRole = roleAttestationFor('engineering-backend-architect');
  const throwingProxy = new Proxy(plainRole, {
    get(target, key) {
      if (key === 'name') throw new Error('name trap');
      return target[key];
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = validateBoard(board, loadContracts(ROOT), {
      verifiedRoles: ['engineering-backend-architect', 'testing-reality-checker'],
      roleAttestations: [throwingProxy],
      registryRoles: loadRegistry(ROOT).roles,
      optInAttestation: optInFor(board),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
  });

  // util.types.isProxy rejects the wrapped attestation before any field read, so
  // the role is simply ineligible - not a thrown "name trap".
  assert.ok(result.errors.length > 0);
  assert.match(
    result.errors.join('\n'),
    /role engineering-backend-architect is not verified as installed/
  );
});

// ---------------------------------------------------------------------------
// CX-b: the diagnostic display path must not crash on a value that cannot be
// converted to a primitive. A card.role that is a null-prototype object has no
// Symbol.toPrimitive/toString, so String(value) threw; displayValue must fall
// back to a marker so the role is reported as invalid, not crashed.
// ---------------------------------------------------------------------------

test('validateBoard reports a null-prototype role as invalid instead of crashing', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  board.cards[0].role = Object.create(null);

  let result;
  assert.doesNotThrow(() => {
    result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(board),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
  });

  assert.match(result.errors.join('\n'), /not a safe role identifier/i);
});

// ---------------------------------------------------------------------------
// CX-c: the plain-data walk must reject functions/callables. isDeeplyPlainData
// only pushed/rejected typeof 'object' values, so a function value (typeof
// 'function') under an ignored field was silently skipped and the board wrongly
// accepted. A function is not plain data and could carry executable behaviour.
// ---------------------------------------------------------------------------

test('validateBoard rejects a board containing a function value', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  board.metadata = function () {};

  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(board),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  assert.match(result.errors.join('\n'), /plain data/i);
});

// ---------------------------------------------------------------------------
// CodeRabbit integration coverage: exercises the real agency-doctor CLI end to
// end on a non-existent board path and asserts the CLI's normal board-error path
// stays bounded - exit code 1, a bounded `board: FAIL` on stdout, and no Node
// stack trace on stderr. The missing path fails inside runAgencyDoctor's own
// board try/catch (resolveContainedFile throws ENOENT, which prints `board: FAIL`
// and returns exitCode 1), so this does NOT reach the outer
// safeErrorMessage/escapeTerminalLine catch backstop in scripts/jarvis.js; that
// backstop only fires if runAgencyDoctor itself throws. The point proven here is
// that the normal board-error path never dumps a stack trace. The backstop's own
// sanitization pipeline is covered directly by the unit test below.
// ---------------------------------------------------------------------------

test('agency-doctor CLI prints a bounded FAIL and no stack trace on a non-existent board path', () => {
  requireApi();
  const missingBoard = path.join(os.tmpdir(), `jcc-no-such-board-${Date.now()}.json`);
  const result = spawnSync(
    process.execPath,
    ['scripts/jarvis.js', 'agency-doctor', missingBoard],
    { cwd: ROOT, encoding: 'utf8' }
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  // The bounded FAIL for the unreadable board path is reported on stdout...
  assert.match(result.stdout, /board: FAIL/);
  // ...and no Node stack trace or uncaught Error dump escapes to stderr.
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.doesNotMatch(result.stderr, /Error:/);
});

// ---------------------------------------------------------------------------
// Unit coverage for the scripts/jarvis.js agency-doctor catch backstop's own
// sanitization pipeline (safeErrorMessage -> slice(0, 240) -> escapeTerminalLine).
// The spawnSync test above deliberately does not reach that backstop, so this
// exercises the exact composition the CLI catch uses: a hostile thrown message
// carrying an ESC/ANSI clear sequence and a bidi override must be rendered inert
// and bounded, while benign leading content survives.
// ---------------------------------------------------------------------------

test('agency-doctor backstop sanitizes and bounds a hostile thrown message', () => {
  const { escapeTerminalLine, safeErrorMessage } = requireApi();
  // Mirrors the scripts/jarvis.js agency-doctor catch: read the message once
  // (throw-safe), bound to 240 chars, then escape terminal control/bidi.
  const hostile = new Error(`boom\u001b[2Jclear\u202eevil${'x'.repeat(300)}`);
  const line = escapeTerminalLine(safeErrorMessage(hostile).slice(0, 240));
  // No raw control/bidi characters survive (same set as UNSAFE_DISPLAY_CHARACTERS_GLOBAL).
  assert.doesNotMatch(
    line,
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/
  );
  assert.ok(line.includes('\\u001b'), `expected \\u001b escape in ${JSON.stringify(line)}`); // ESC preserved as an escape
  assert.ok(line.includes('\\u202e')); // bidi override rendered as its escaped form
  assert.ok(!line.includes('x'.repeat(223))); // >240 suffix truncated away, proving the slice bounds
  assert.ok(line.startsWith('boom')); // benign content preserved
});

// ===========================================================================
// F6 (docs/proposals/f6-board-declaration-binding.md, PR #6, issue #5): bind
// Agency opt-in/evidence attestations to a SHA-256 digest of the exact board
// declaration. Section numbers below (5.x, 6, 7.x, R1-R7) refer to that doc.
// ===========================================================================

// ---------------------------------------------------------------------------
// Independent fuzz/equality oracle (Section 7.2). Deliberately NOT derived from
// the implementation's own encoder - it reimplements the projection (5.1) and
// R1's content-only equality directly against the spec, so the fuzz test below
// is a genuine cross-check rather than a tautology.
// ---------------------------------------------------------------------------

function cloneForOracle(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneForOracle);
  const result = {};
  for (const key of Object.keys(value)) result[key] = cloneForOracle(value[key]);
  return result;
}

function isPlainObjectForOracle(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectDeclarationForOracle(board) {
  const projected = {};
  for (const key of Object.keys(board)) {
    if (key === 'enabled' || key === 'correctionCycles') continue;
    if (key === 'cards' && Array.isArray(board[key])) {
      projected[key] = board[key].map((card) => {
        if (!isPlainObjectForOracle(card)) return cloneForOracle(card);
        const strippedCard = {};
        for (const cardKey of Object.keys(card)) {
          if (cardKey === 'status' || cardKey === 'attempts' || cardKey === 'evidence') continue;
          strippedCard[cardKey] = cloneForOracle(card[cardKey]);
        }
        return strippedCard;
      });
    } else {
      projected[key] = cloneForOracle(board[key]);
    }
  }
  return projected;
}

// R1: content-only equality - SameValue on leaves (so -0 !== 0), ignoring
// object-prototype identity (Object.create(null) vs {} with the same content
// are equal). Object.is handles the SameValue leaf comparison directly.
function sameValueDeepEqualForOracle(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!sameValueDeepEqualForOracle(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  for (const key of aKeys) {
    if (!sameValueDeepEqualForOracle(a[key], b[key])) return false;
  }
  return true;
}

function boardsEqualUnderProjection(a, b) {
  return sameValueDeepEqualForOracle(projectDeclarationForOracle(a), projectDeclarationForOracle(b));
}

// ---------------------------------------------------------------------------
// Section 7.1: one dedicated regression test per historical collision class.
// ---------------------------------------------------------------------------

test('F6 collision class 1: an own "__proto__" JSON key digests distinctly from its absence and from a different value', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  // Built via JSON.parse, per the doc: JSON.parse uses CreateDataProperty, so
  // "__proto__" becomes a real OWN enumerable property, unlike an object
  // literal (which would set the actual prototype instead).
  const without = JSON.parse('{"a":1}');
  const withA = JSON.parse('{"a":1,"__proto__":"x"}');
  const withB = JSON.parse('{"a":1,"__proto__":"y"}');
  assert.equal(Object.prototype.hasOwnProperty.call(withA, '__proto__'), true);

  const dWithout = computeBoardDeclarationDigest(without);
  const dA = computeBoardDeclarationDigest(withA);
  const dB = computeBoardDeclarationDigest(withB);
  assert.ok(dWithout.ok && dA.ok && dB.ok);
  assert.equal(new Set([dWithout.digest, dA.digest, dB.digest]).size, 3);
});

test('F6 collision class 2: non-finite numbers are rejected outright, never collapsed to null', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  for (const value of [Infinity, -Infinity, NaN]) {
    const result = computeBoardDeclarationDigest({ a: value });
    assert.equal(result.ok, false, `expected rejection for ${value}`);
  }
  const nullResult = computeBoardDeclarationDigest({ a: null });
  assert.equal(nullResult.ok, true);
});

test('F6 collision class 3: lone UTF-16 surrogates digest losslessly and distinctly from U+FFFD and from each other', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const highSurrogate = computeBoardDeclarationDigest({ a: '\uD800' });
  const replacementChar = computeBoardDeclarationDigest({ a: '�' });
  const lowSurrogate = computeBoardDeclarationDigest({ a: '\uDC00' });
  assert.ok(highSurrogate.ok && replacementChar.ok && lowSurrogate.ok);
  assert.notEqual(highSurrogate.digest, replacementChar.digest);
  assert.notEqual(highSurrogate.digest, lowSurrogate.digest);
  assert.notEqual(replacementChar.digest, lowSurrogate.digest);
});

test('F6 collision class 4: the encoding performs no UTF-8 decode round-trip', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const original = '\uD800abc';
  const roundTripped = Buffer.from(original, 'utf8').toString('utf8');
  assert.notEqual(original, roundTripped); // sanity: the round trip really is lossy
  const a = computeBoardDeclarationDigest({ a: original });
  const b = computeBoardDeclarationDigest({ a: roundTripped });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.digest, b.digest);
});

test('F6: -0 and 0 digest distinctly (SameValue, per R1)', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const negativeZero = computeBoardDeclarationDigest({ a: -0 });
  const positiveZero = computeBoardDeclarationDigest({ a: 0 });
  assert.ok(negativeZero.ok && positiveZero.ok);
  assert.notEqual(negativeZero.digest, positiveZero.digest);
});

test('F6: array/object tag and nested-boundary ambiguity probes never collide', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const arrayForm = computeBoardDeclarationDigest({ a: [1, 2] });
  const objectForm = computeBoardDeclarationDigest({ a: { 0: 1, 1: 2 } });
  assert.ok(arrayForm.ok && objectForm.ok);
  assert.notEqual(arrayForm.digest, objectForm.digest);

  const nestedA = computeBoardDeclarationDigest({ a: { b: 1 }, c: 2 });
  const nestedB = computeBoardDeclarationDigest({ a: { b: 1, c: 2 } });
  assert.ok(nestedA.ok && nestedB.ok);
  assert.notEqual(nestedA.digest, nestedB.digest);
});

test('F6 R1: an Object.prototype node and an equivalent null-prototype node digest identically (intentional quotient)', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const withObjectProto = { a: { b: 1, c: 'x' } };
  const withNullProto = { a: Object.assign(Object.create(null), { b: 1, c: 'x' }) };
  const d1 = computeBoardDeclarationDigest(withObjectProto);
  const d2 = computeBoardDeclarationDigest(withNullProto);
  assert.ok(d1.ok && d2.ok);
  assert.equal(d1.digest, d2.digest);
  // The fuzz oracle must also treat these as equal (content-only), not as a
  // strict deep-equal that would call them different.
  assert.equal(boardsEqualUnderProjection(withObjectProto, withNullProto), true);
});

test('F6 R3a: an array with an extra own property outside its dense indices is rejected, not silently digested', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  board.cards.approval = 'decision-1';
  const result = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(validBoard()),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(result.errors.join('\n'), /plain data/i);
});

test('F6 R3a: an inherited numeric property filling a hole plus an unrelated extra own property is still rejected (exact-index, not cardinality-only)', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const cardsWithHole = [board.cards[0]];
  cardsWithHole[2] = board.cards[1]; // hole at index 1; length becomes 3
  cardsWithHole.approval = 'x'; // extra own property
  // eslint-disable-next-line no-extend-native
  Array.prototype[1] = 'inherited-filler'; // `1 in array` now true without being an OWN property
  try {
    board.cards = cardsWithHole;
    const result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(validBoard()),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
    assert.match(result.errors.join('\n'), /plain data/i);
  } finally {
    delete Array.prototype[1];
  }
});

test('F6 R3b: a non-array object with a non-enumerable own property is rejected; a plain array is unaffected', () => {
  const { loadContracts, validateBoard } = requireApi();
  const boardWithHiddenBudgetField = validBoard();
  Object.defineProperty(boardWithHiddenBudgetField.cards[0].budget, 'hidden', {
    value: 999,
    enumerable: false,
    configurable: true,
  });
  const rejected = validateBoard(boardWithHiddenBudgetField, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(validBoard()),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(rejected.errors.join('\n'), /plain data/i);

  // A plain array's own `length` is intrinsically non-enumerable by spec; this
  // must not regress into rejecting every array.
  const cleanBoard = validBoard();
  const accepted = validateBoard(cleanBoard, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optInFor(cleanBoard),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(accepted.errors, []);
});

// ---------------------------------------------------------------------------
// F6 R3c (Codex finding, PR #11): the encoder walks OWN keys only, while
// validateBoard and the host read fields with ordinary property access, which
// walks the prototype chain. Before the fix, a card missing `stopCondition` as
// an own property while `Object.prototype.stopCondition` supplied one produced
// the SAME digest for two completely different effective stop conditions - the
// digest did not bind the declaration validation actually consumed. The plain-
// data gate now rejects any node exposing an inherited enumerable property.
// ---------------------------------------------------------------------------

test('F6 R3c: a card field supplied only by a polluted Object.prototype is rejected, never digested', () => {
  const { computeBoardDeclarationDigest, loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  delete board.cards[0].stopCondition; // no own key; only the prototype supplies one

  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.stopCondition = 'Stop when the focused tests pass.';
    const firstDigest = computeBoardDeclarationDigest(board);
    const firstEffectiveValue = board.cards[0].stopCondition;

    // eslint-disable-next-line no-extend-native
    Object.prototype.stopCondition = 'Never stop; keep spending the budget.';
    const secondDigest = computeBoardDeclarationDigest(board);
    const secondEffectiveValue = board.cards[0].stopCondition;

    // The two boards really are different declarations as far as every consumer
    // is concerned - this is the collision the gate now prevents, not a
    // hypothetical one.
    assert.notEqual(firstEffectiveValue, secondEffectiveValue);
    assert.equal(firstEffectiveValue, 'Stop when the focused tests pass.');
    assert.equal(secondEffectiveValue, 'Never stop; keep spending the budget.');

    // Neither may digest at all, so no digest can be reused across them.
    assert.equal(firstDigest.ok, false);
    assert.equal(secondDigest.ok, false);
    assert.match(firstDigest.error, /plain data/i);
    assert.match(secondDigest.error, /plain data/i);

    // And the same board fails closed through validateBoard's own gate, before
    // any card field is read.
    const result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(validBoard()),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
    assert.match(result.errors.join('\n'), /plain data/i);
  } finally {
    delete Object.prototype.stopCondition;
  }
});

test('F6 R3c: an inherited budget value is rejected, never digested', () => {
  const { computeBoardDeclarationDigest, loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  delete board.cards[0].budget.turns;

  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.turns = 1;
    const approvedDigest = computeBoardDeclarationDigest(board);
    const approvedTurns = board.cards[0].budget.turns;

    // eslint-disable-next-line no-extend-native
    Object.prototype.turns = 12; // still inside maxTurnsPerCard, so validation alone would not notice
    const laterDigest = computeBoardDeclarationDigest(board);
    const laterTurns = board.cards[0].budget.turns;

    assert.equal(approvedTurns, 1);
    assert.equal(laterTurns, 12);
    assert.equal(approvedDigest.ok, false);
    assert.equal(laterDigest.ok, false);

    const result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(validBoard()),
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
    assert.match(result.errors.join('\n'), /plain data/i);
  } finally {
    delete Object.prototype.turns;
  }
});

test('F6 R3c: an otherwise clean board also fails closed while Object.prototype is polluted', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const board = validBoard();
  const cleanDigest = computeBoardDeclarationDigest(board);
  assert.equal(cleanDigest.ok, true);

  try {
    // Pollution is process-global: every node whose prototype chain reaches
    // Object.prototype now exposes an inherited enumerable key, so no board's
    // digest can be trusted and none is produced. Fail closed, deliberately.
    // eslint-disable-next-line no-extend-native
    Object.prototype.unexpected = 'x';
    assert.equal(computeBoardDeclarationDigest(board).ok, false);
  } finally {
    delete Object.prototype.unexpected;
  }

  // ...and the gate releases once the pollution is gone: same board, same digest.
  const afterDigest = computeBoardDeclarationDigest(board);
  assert.equal(afterDigest.ok, true);
  assert.equal(afterDigest.digest, cleanDigest.digest);
});

test('F6 R3c: the rule is exposure-based - a null-prototype tree is unaffected by Object.prototype pollution', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const nullProtoRoot = Object.assign(Object.create(null), {
    pipelineId: 'travis-authz-audit',
    stopCondition: 'Stop when the focused tests pass.',
  });
  const baseline = computeBoardDeclarationDigest(nullProtoRoot);
  assert.equal(baseline.ok, true);

  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.stopCondition = 'Never stop; keep spending the budget.';
    const polluted = computeBoardDeclarationDigest(nullProtoRoot);
    // Nothing is inherited here, so nothing is rejected and nothing changed:
    // the check rejects actual exposure, not the mere existence of pollution.
    assert.equal(polluted.ok, true);
    assert.equal(polluted.digest, baseline.digest);
  } finally {
    delete Object.prototype.stopCondition;
  }
});

// ---------------------------------------------------------------------------
// CodeRabbit finding (PR #11): computeBoardDeclarationDigest is exported for
// direct/test use, so a caller that bypasses validateBoard also bypasses its
// isDeeplyPlainData gate. validateDeclarationDomain walks the tree with
// Object.keys/property reads, which can invoke a Proxy trap or a throwing
// getter, and does not itself detect a non-enumerable own property the way
// isDeeplyPlainData does. computeBoardDeclarationDigest now runs its own
// isDeeplyPlainData gate so the exported boundary is safe to call directly.
// ---------------------------------------------------------------------------

test('computeBoardDeclarationDigest returns { ok: false } for a Proxy passed directly, never throwing', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const target = validBoard();
  const proxy = new Proxy(target, {
    get(obj, key) {
      if (key === 'pipelineId') throw new Error('get trap should never be reached');
      return obj[key];
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = computeBoardDeclarationDigest(proxy);
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /plain data/i);
});

test('computeBoardDeclarationDigest returns { ok: false } for an object with a throwing getter, never throwing', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const board = validBoard();
  Object.defineProperty(board, 'pipelineId', {
    get() {
      throw new Error('getter should never be invoked');
    },
    enumerable: true,
    configurable: true,
  });

  let result;
  assert.doesNotThrow(() => {
    result = computeBoardDeclarationDigest(board);
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /plain data/i);
});

test('computeBoardDeclarationDigest returns { ok: false } for an object with a non-enumerable own property, instead of silently omitting it from the digest', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const board = validBoard();
  Object.defineProperty(board.cards[0].budget, 'hidden', {
    value: 999,
    enumerable: false,
    configurable: true,
  });

  const result = computeBoardDeclarationDigest(board);
  assert.equal(result.ok, false);
  assert.match(result.error, /plain data/i);
});

// CodeRabbit finding (PR #11): isDeeplyPlainData accepts a primitive root (its
// walk only ever rejects non-plain COMPOSITES; a root that is never even
// pushed onto a real stack entry just falls through to `return true`), and
// validateDeclarationDomain's R4 check only screens VALUE types, not root
// shape, so a finite number/string/boolean root sails through both gates into
// createDeclarationFrame's non-array branch, which calls Object.keys(value).
// Object.keys on a boxed primitive can silently alias a plain object's own
// encoding - 0, true, and '' all report no own keys (matching {}), and a
// string like 'ab' reports exactly the indexed keys a matching object
// literal would ({0:'a',1:'b'}) - so a primitive root could digest IDENTICAL
// to an unrelated object root. computeBoardDeclarationDigest now rejects any
// non-object (or array) root before either existing gate runs.
test('computeBoardDeclarationDigest rejects primitive roots instead of colliding with an equivalent object root', () => {
  const { computeBoardDeclarationDigest } = requireApi();

  const emptyObjectResult = computeBoardDeclarationDigest({});
  assert.equal(emptyObjectResult.ok, true);

  for (const primitiveRoot of [0, true, '']) {
    const result = computeBoardDeclarationDigest(primitiveRoot);
    assert.equal(result.ok, false);
    assert.match(result.error, /plain object/i);
    // Never silently produce the same digest {} would - the primitive is
    // rejected outright, so there is no digest to compare in the first place.
    assert.equal('digest' in result, false);
  }

  const stringRootResult = computeBoardDeclarationDigest('ab');
  const matchingObjectResult = computeBoardDeclarationDigest({ 0: 'a', 1: 'b' });
  assert.equal(stringRootResult.ok, false);
  assert.match(stringRootResult.error, /plain object/i);
  assert.equal(matchingObjectResult.ok, true);
  // The object-shaped equivalent still digests normally and cannot collide
  // with the (now-rejected) string root, since the string root never
  // produces a digest at all.
  assert.notEqual(stringRootResult.digest, matchingObjectResult.digest);

  // An array root is also not a plain object and must be rejected the same
  // way, not silently treated as TAG_ARRAY at the top level.
  const arrayRootResult = computeBoardDeclarationDigest([1, 2]);
  assert.equal(arrayRootResult.ok, false);
  assert.match(arrayRootResult.error, /plain object/i);

  // A null root must also be rejected rather than reaching `typeof null ===
  // 'object'` and falling through to Object.keys(null), which throws.
  const nullRootResult = computeBoardDeclarationDigest(null);
  assert.equal(nullRootResult.ok, false);
  assert.match(nullRootResult.error, /plain object/i);
});

test('F6 R3: an oversized string fails the aggregate code-unit cap, including hidden inside a volatile field', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const MAX_UNITS = 1024 * 1024;
  const justUnder = computeBoardDeclarationDigest({ a: 'x'.repeat(MAX_UNITS - 1) });
  assert.equal(justUnder.ok, true);

  const overCap = computeBoardDeclarationDigest({ a: 'x'.repeat(MAX_UNITS + 1) });
  assert.equal(overCap.ok, false);

  // The same oversized string hidden inside a to-be-projected-away volatile
  // field (evidence on a non-done card) must still fail closed - the cap is
  // enforced pre-projection over the complete board (5.1, 5.4).
  const boardWithHiddenOversizedEvidence = validBoard();
  boardWithHiddenOversizedEvidence.cards[1].evidence = ['x'.repeat(MAX_UNITS + 1)];
  const hiddenResult = computeBoardDeclarationDigest(boardWithHiddenOversizedEvidence);
  assert.equal(hiddenResult.ok, false);
});

test('F6 R3: an oversized object KEY also fails the aggregate code-unit cap, not just values', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const MAX_UNITS = 1024 * 1024;

  // A single own-key whose length alone exceeds the cap. encodeStringNode
  // (5.4/5.5) encodes object keys the same way it encodes string values, so
  // the pre-projection domain walk must count key code units toward the same
  // aggregate MAX_ENCODED_STRING_UNITS bound, and reject BEFORE encoding ever
  // allocates a payload for it - not only once encoding is reached.
  const oversizedKeyResult = computeBoardDeclarationDigest({ ['k'.repeat(MAX_UNITS + 1)]: 1 });
  assert.equal(oversizedKeyResult.ok, false);
  assert.match(oversizedKeyResult.error, /aggregate UTF-16 code units/i);

  // Cumulative key text across many properties, none individually oversized,
  // must also trip the aggregate cap.
  const manySmallKeys = {};
  const keyLength = 100;
  const keyCount = Math.ceil(MAX_UNITS / keyLength) + 1;
  for (let i = 0; i < keyCount; i += 1) {
    manySmallKeys[`${i}`.padStart(keyLength, 'k')] = 1;
  }
  const cumulativeKeyResult = computeBoardDeclarationDigest(manySmallKeys);
  assert.equal(cumulativeKeyResult.ok, false);
  assert.match(cumulativeKeyResult.error, /aggregate UTF-16 code units/i);

  // A single key whose length sits just under the cap must still digest
  // cleanly - this must not regress into rejecting ordinary short keys.
  const justUnderKeyResult = computeBoardDeclarationDigest({ ['k'.repeat(MAX_UNITS - 1)]: 1 });
  assert.equal(justUnderKeyResult.ok, true);
});

test('F6: a board-digest computation failure suppresses the redundant generic opt-in-required message when the opt-in itself is syntactically valid and matching-shaped', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);

  // A board that fails ITS OWN digest computation (an oversized title trips
  // the R3 aggregate code-unit cap) but is otherwise schema-valid enough to
  // reach the opt-in check.
  const undigestableBoard = validBoard();
  undigestableBoard.cards[0].title = 'x'.repeat(1024 * 1024 + 1);

  // A syntactically valid, correctly-shaped opt-in computed against a CLEAN
  // board of the same pipelineId, so boardBindingKind is correct and
  // boardDigest is well-formed 64-lowercase-hex - it simply can never match
  // the undigestable board's (nonexistent) digest.
  const wellFormedOptIn = optInFor(validBoard());

  const result = validateBoard(undigestableBoard, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: wellFormedOptIn,
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });

  // The board is still correctly rejected, via the specific digest error...
  assert.ok(result.errors.some((error) => /cannot be digested/.test(error)));
  // ...but the generic message must not ALSO appear: it would misleadingly
  // suggest the opt-in itself was missing or invalid, when it was not.
  assert.ok(!result.errors.includes('trusted controller opt-in attestation is required for this pipeline'));

  // Control: when the opt-in is genuinely missing (unrelated to any digest
  // failure), the generic message must still appear as before - this change
  // must not suppress it in the ordinary "no opt-in supplied" case.
  const stillRejected = validateBoard(validBoard(), contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.ok(stillRejected.errors.includes('trusted controller opt-in attestation is required for this pipeline'));
});

test('F6: contracts.attestations.schemaVersion (policy) and an attestation instance own schemaVersion are independent fields', () => {
  const { loadContracts, validateBoard } = requireApi();
  const contracts = loadContracts(ROOT);
  assert.equal(contracts.attestations.schemaVersion, 2);
  assert.equal(contracts.attestations.boardBindingKind, BOARD_BINDING_KIND);
  assert.equal(typeof contracts.attestations.boardBindingRequired, 'boolean');

  const board = validBoard();
  const optIn = optInFor(board);
  assert.equal(optIn.schemaVersion, 1); // the attestation instance's own schemaVersion, untouched.
  const result = validateBoard(board, contracts, {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: optIn,
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.deepEqual(result.errors, []);
});

test('F6: evidence with a correct digest but a missing or wrong boardBindingKind is not indexed', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard({
    cards: [
      { ...validBoard().cards[0], status: 'done', dependencies: [], evidence: ['ev-1'] },
      { ...validBoard().cards[1], status: 'ready', dependencies: [] },
    ],
  });
  const digest = boardDigestFor(board);
  const missingKind = rawEvidenceFor(board.pipelineId, 'implement', 'ev-1');
  missingKind.boardDigest = digest; // digest present, boardBindingKind absent -> partial binding, reject
  const wrongKind = {
    ...rawEvidenceFor(board.pipelineId, 'implement', 'ev-1'),
    boardBindingKind: 'agency.not-the-real-kind.v1',
    boardDigest: digest,
  };

  for (const evidence of [missingKind, wrongKind]) {
    const result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: optInFor(board),
      evidenceAttestations: [evidence],
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
    assert.match(result.errors.join('\n'), /evidence ev-1 is not controller-verified/i);
  }
});

test('F6 R7: a non-enumerable boardBindingKind/boardDigest cannot slip through as absent', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const digest = boardDigestFor(board);

  const hiddenKind = rawOptInFor(board);
  Object.defineProperty(hiddenKind, 'boardBindingKind', {
    value: 'wrong-or-malformed',
    enumerable: false,
    configurable: true,
  });
  hiddenKind.boardDigest = digest;
  const resultA = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: hiddenKind,
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(resultA.errors.join('\n'), /opt-in attestation is required/i);
  // Must not have taken the fully-absent Phase-1 warn-accept path.
  assert.doesNotMatch(resultA.warnings.join('\n'), /F6/i);

  const hiddenDigest = rawOptInFor(board);
  hiddenDigest.boardBindingKind = BOARD_BINDING_KIND;
  Object.defineProperty(hiddenDigest, 'boardDigest', {
    value: 'wrong-or-malformed',
    enumerable: false,
    configurable: true,
  });
  const resultB = validateBoard(board, loadContracts(ROOT), {
    ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
    optInAttestation: hiddenDigest,
    controllerAttestationVerifier: testControllerAttestationVerifier,
  });
  assert.match(resultB.errors.join('\n'), /opt-in attestation is required/i);
  assert.doesNotMatch(resultB.warnings.join('\n'), /F6/i);
});

test('F6: malformed boardBindingKind/boardDigest formats reject identically to well-formed-but-wrong', () => {
  const { loadContracts, validateBoard } = requireApi();
  const board = validBoard();
  const digest = boardDigestFor(board);
  const nonStringKind = { ...rawOptInFor(board), boardBindingKind: 42, boardDigest: digest };
  const uppercaseDigest = { ...rawOptInFor(board), boardBindingKind: BOARD_BINDING_KIND, boardDigest: digest.toUpperCase() };
  const shortDigest = { ...rawOptInFor(board), boardBindingKind: BOARD_BINDING_KIND, boardDigest: digest.slice(0, 63) };

  for (const attestation of [nonStringKind, uppercaseDigest, shortDigest]) {
    const result = validateBoard(board, loadContracts(ROOT), {
      ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
      optInAttestation: attestation,
      controllerAttestationVerifier: testControllerAttestationVerifier,
    });
    assert.match(result.errors.join('\n'), /opt-in attestation is required/i);
  }
});

// ---------------------------------------------------------------------------
// Section 6 disposition matrix, both attestation kinds, both rollout phases.
// 3 kind states x 4 digest states x 2 phases x 2 attestation kinds = 48 cases,
// exceeding the doc's stated 24-case minimum.
// ---------------------------------------------------------------------------

test('F6 disposition matrix: boardBindingKind x boardDigest x boardBindingRequired, both attestation kinds', () => {
  const { loadContracts, validateBoard } = requireApi();
  const baseContracts = loadContracts(ROOT);

  // A board with no 'done' cards, so the opt-in sub-case's errors are driven
  // purely by the opt-in disposition, never by an unrelated unmet
  // controller-verified-evidence requirement.
  const optInBoard = validBoard();
  const optInDigest = boardDigestFor(optInBoard);

  // A separate board with a 'done' card requiring verified evidence, so the
  // evidence sub-case can distinguish "indexed" from "not indexed" via that
  // specific error message.
  const evidenceBoard = validBoard({
    cards: [
      { ...validBoard().cards[0], status: 'done', dependencies: [], evidence: ['ev-1'] },
      { ...validBoard().cards[1], status: 'ready', dependencies: [] },
    ],
  });
  const evidenceDigest = boardDigestFor(evidenceBoard);

  const wrongDigest = 'a'.repeat(64);
  const malformedDigest = 'not-hex-and-also-the-wrong-length';

  function fieldsFor(kindState, digestState, correctDigest) {
    const fields = {};
    if (kindState === 'correct') fields.boardBindingKind = BOARD_BINDING_KIND;
    else if (kindState === 'wrong') fields.boardBindingKind = 'agency.some-other-kind.v1';
    if (digestState === 'match') fields.boardDigest = correctDigest;
    else if (digestState === 'mismatch') fields.boardDigest = wrongDigest;
    else if (digestState === 'malformed') fields.boardDigest = malformedDigest;
    return fields;
  }

  function expectedOutcome(kindState, digestState, boardBindingRequired) {
    if (kindState === 'absent' && digestState === 'absent') {
      return boardBindingRequired ? 'reject' : 'warn-accept';
    }
    if (kindState !== 'correct') return 'reject';
    if (digestState !== 'match') return 'reject';
    return 'accept';
  }

  const KIND_STATES = ['absent', 'correct', 'wrong'];
  const DIGEST_STATES = ['absent', 'malformed', 'match', 'mismatch'];

  for (const boardBindingRequired of [false, true]) {
    const contracts = { ...baseContracts, attestations: { ...baseContracts.attestations, boardBindingRequired } };
    for (const kindState of KIND_STATES) {
      for (const digestState of DIGEST_STATES) {
        const outcome = expectedOutcome(kindState, digestState, boardBindingRequired);
        const label = `kind=${kindState} digest=${digestState} required=${boardBindingRequired}`;

        const optIn = { ...rawOptInFor(optInBoard), ...fieldsFor(kindState, digestState, optInDigest) };
        const optInResult = validateBoard(optInBoard, contracts, {
          ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
          optInAttestation: optIn,
          controllerAttestationVerifier: testControllerAttestationVerifier,
        });
        if (outcome === 'reject') {
          assert.match(optInResult.errors.join('\n'), /opt-in attestation is required/i, `optIn ${label}`);
        } else {
          assert.deepEqual(optInResult.errors, [], `optIn ${label}`);
          if (outcome === 'warn-accept') {
            assert.match(optInResult.warnings.join('\n'), /F6.*board declaration binding/i, `optIn warn ${label}`);
          }
        }

        const evidence = {
          ...rawEvidenceFor(evidenceBoard.pipelineId, 'implement', 'ev-1'),
          ...fieldsFor(kindState, digestState, evidenceDigest),
        };
        const evidenceResult = validateBoard(evidenceBoard, contracts, {
          ...verifiedRoleOptions(['engineering-backend-architect', 'testing-reality-checker']),
          optInAttestation: optInFor(evidenceBoard),
          evidenceAttestations: [evidence],
          controllerAttestationVerifier: testControllerAttestationVerifier,
        });
        const evidenceErrors = evidenceResult.errors.join('\n');
        if (outcome === 'reject') {
          assert.match(evidenceErrors, /evidence ev-1 is not controller-verified/i, `evidence ${label}`);
        } else {
          assert.doesNotMatch(evidenceErrors, /evidence ev-1 is not controller-verified/i, `evidence ${label}`);
          if (outcome === 'warn-accept') {
            assert.match(evidenceResult.warnings.join('\n'), /F6.*board declaration binding/i, `evidence warn ${label}`);
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Section 7.2: property-based fuzzing. A tiny deterministic PRNG (no external
// dependency) drives a domain generator (finite doubles including -0, strings
// including lone surrogates, both Object.prototype and null-prototype object
// variants, nesting within caps) and a classified single-mutation harness, then
// asserts digest-equality holds iff the independent projection oracle above
// agrees, over >= 10,000 pairs.
// ---------------------------------------------------------------------------

function makeFuzzRng(seed) {
  let state = seed >>> 0 || 1;
  return function next() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function fuzzRandomString(rng) {
  const length = Math.floor(rng() * 10);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const choice = rng();
    if (choice < 0.1) {
      out += String.fromCharCode(rng() < 0.5 ? 0xd800 + Math.floor(rng() * 0x400) : 0xdc00 + Math.floor(rng() * 0x400));
    } else if (choice < 0.2) {
      out += String.fromCharCode(1 + Math.floor(rng() * 0xffff));
    } else {
      out += String.fromCharCode(97 + Math.floor(rng() * 26));
    }
  }
  return out;
}

function fuzzRandomNumber(rng) {
  const choice = rng();
  if (choice < 0.1) return -0;
  if (choice < 0.2) return 0;
  if (choice < 0.3) return Number.MAX_SAFE_INTEGER;
  if (choice < 0.4) return -Number.MAX_SAFE_INTEGER;
  return Math.round((rng() - 0.5) * 1e9 * 1000) / 1000;
}

function fuzzRandomLeaf(rng) {
  const choice = rng();
  if (choice < 0.2) return null;
  if (choice < 0.35) return rng() < 0.5;
  if (choice < 0.7) return fuzzRandomNumber(rng);
  return fuzzRandomString(rng);
}

function fuzzRandomValue(rng, depth) {
  if (depth > 3) return fuzzRandomLeaf(rng);
  const choice = rng();
  if (choice < 0.55) return fuzzRandomLeaf(rng);
  if (choice < 0.78) {
    const useNullPrototype = rng() < 0.25;
    const target = useNullPrototype ? Object.create(null) : {};
    const keyCount = Math.floor(rng() * 3);
    for (let i = 0; i < keyCount; i += 1) target[`k${Math.floor(rng() * 500)}`] = fuzzRandomValue(rng, depth + 1);
    return target;
  }
  const length = Math.floor(rng() * 3);
  const arr = [];
  for (let i = 0; i < length; i += 1) arr.push(fuzzRandomValue(rng, depth + 1));
  return arr;
}

function fuzzRandomCard(rng, id) {
  return {
    id,
    title: fuzzRandomString(rng) || 'card',
    status: rng() < 0.5 ? 'in_progress' : 'done',
    attempts: Math.floor(rng() * 3),
    evidence: rng() < 0.5 ? [] : [fuzzRandomString(rng) || 'evidence'],
    extra: fuzzRandomValue(rng, 1),
  };
}

function fuzzRandomBoard(rng) {
  const cardCount = 1 + Math.floor(rng() * 3);
  const cards = [];
  for (let i = 0; i < cardCount; i += 1) cards.push(fuzzRandomCard(rng, `card-${i}`));
  return {
    schemaVersion: 1,
    enabled: rng() < 0.5,
    correctionCycles: Math.floor(rng() * 3),
    pipelineId: `pipeline-${Math.floor(rng() * 1000)}`,
    cards,
    metadata: fuzzRandomValue(rng, 1),
  };
}

function fuzzCloneMutable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(fuzzCloneMutable);
  const prototype = Object.getPrototypeOf(value);
  const target = prototype === null ? Object.create(null) : {};
  for (const key of Object.keys(value)) target[key] = fuzzCloneMutable(value[key]);
  return target;
}

// Applies ONE random structural mutation to a clone of `board`, classifying it
// before returning: volatile-field-only and/or prototype-only mutations must
// leave the digest unchanged (R1's intentional quotients); any mutation that
// changes non-volatile content must change the digest.
function fuzzMutateBoard(rng, board) {
  const mutated = fuzzCloneMutable(board);

  const volatileMutations = [
    () => {
      mutated.enabled = !mutated.enabled;
      return true;
    },
    () => {
      mutated.correctionCycles = (mutated.correctionCycles + 1 + Math.floor(rng() * 3)) % 5;
      return true;
    },
    () => {
      if (mutated.cards.length === 0) return null;
      const card = mutated.cards[Math.floor(rng() * mutated.cards.length)];
      card.status = card.status === 'done' ? 'in_progress' : 'done';
      return true;
    },
    () => {
      if (mutated.cards.length === 0) return null;
      const card = mutated.cards[Math.floor(rng() * mutated.cards.length)];
      card.attempts = (card.attempts || 0) + 1 + Math.floor(rng() * 3);
      return true;
    },
    () => {
      if (mutated.cards.length === 0) return null;
      const card = mutated.cards[Math.floor(rng() * mutated.cards.length)];
      card.evidence = [...(card.evidence || []), fuzzRandomString(rng) || 'x'];
      return true;
    },
    () => {
      // Prototype-only: swap board.metadata's prototype while preserving its
      // content exactly, when metadata is currently a non-array plain object.
      if (mutated.metadata === null || typeof mutated.metadata !== 'object' || Array.isArray(mutated.metadata)) {
        return null;
      }
      const currentlyNull = Object.getPrototypeOf(mutated.metadata) === null;
      const replacement = currentlyNull ? {} : Object.create(null);
      for (const key of Object.keys(mutated.metadata)) replacement[key] = mutated.metadata[key];
      mutated.metadata = replacement;
      return true;
    },
  ];
  const nonVolatileMutations = [
    () => {
      mutated.pipelineId = `${mutated.pipelineId}-x${Math.floor(rng() * 1000)}`;
      return false;
    },
    () => {
      if (mutated.cards.length === 0) return null;
      const card = mutated.cards[Math.floor(rng() * mutated.cards.length)];
      card.title = `${card.title || ''}-changed-${Math.floor(rng() * 1000)}`;
      return false;
    },
    () => {
      // A bare `mutated.metadata = fuzzRandomValue(...)` can coincidentally
      // reproduce the SAME content as the original (e.g. two independently
      // generated empty objects), which would make a "non-volatile" mutation
      // a silent no-op and wrongly expect a digest change. Wrapping in a key
      // the generator never produces (`k${0..499}` only) guarantees the
      // top-level key set actually changes, so this is unconditionally a
      // real content change.
      mutated.metadata = { __fuzzMarkerNeverGenerated: true, value: fuzzRandomValue(rng, 1) };
      return false;
    },
    () => {
      mutated.newField = fuzzRandomString(rng) || 'added';
      return false;
    },
  ];

  const pool = rng() < 0.5 ? volatileMutations : nonVolatileMutations;
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const strategy = pool[Math.floor(rng() * pool.length)];
    const outcome = strategy();
    if (outcome !== null) return { mutated, isVolatileOrPrototypeOnly: outcome };
  }
  mutated.pipelineId = `${mutated.pipelineId}-fallback`;
  return { mutated, isVolatileOrPrototypeOnly: false };
}

test('F6 property fuzz: digest equality holds iff the projection oracle agrees, over 10,000+ pairs', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const rng = makeFuzzRng(0xf6f6f6);
  const ITERATIONS = 10000;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const board = fuzzRandomBoard(rng);
    const { mutated, isVolatileOrPrototypeOnly } = fuzzMutateBoard(rng, board);
    const left = computeBoardDeclarationDigest(board);
    const right = computeBoardDeclarationDigest(mutated);
    assert.ok(left.ok, `iteration ${i}: board must digest cleanly: ${left.ok ? '' : left.error}`);
    assert.ok(right.ok, `iteration ${i}: mutated board must digest cleanly: ${right.ok ? '' : right.error}`);

    const projectedEqual = boardsEqualUnderProjection(board, mutated);
    assert.equal(
      projectedEqual,
      isVolatileOrPrototypeOnly,
      `iteration ${i}: mutation classification disagreed with the independent projection oracle`
    );
    assert.equal(
      left.digest === right.digest,
      projectedEqual,
      `iteration ${i}: digest equality did not match projected content equality`
    );
  }
});

// ---------------------------------------------------------------------------
// Section 7.3: cross-Node-version determinism via fixed golden vectors. These
// hex digests were computed once against this implementation and are pinned
// here; any future byte-level drift (a Node-version or platform dependency
// slipping into the encoding) fails loudly. The encoding depends only on
// explicit big-endian byte writes and UTF-16 code units, never on locale,
// ICU, or JSON.stringify's own formatting, so it is expected to reproduce
// identically across supported Node majors and platforms.
// ---------------------------------------------------------------------------

test('F6 golden vector: a fixed minimal board digests to a pinned hex value', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const fixedBoard = {
    schemaVersion: 1,
    enabled: true,
    pipelineId: 'golden-vector-pipeline',
    depth: 1,
    correctionCycles: 0,
    pipelineMinutes: 5,
    cards: [
      {
        id: 'only-card',
        title: 'Golden vector card',
        status: 'in_progress',
        role: 'engineering-backend-architect',
        mode: 'writer',
        dependencies: [],
        attempts: 0,
        canSpawn: false,
        stopCondition: 'Stop.',
        evidence: [],
        budget: { turns: 1, toolCalls: 1, workerMinutes: 1, inputTokens: 1, outputTokens: 1, handoffTokens: 1 },
      },
    ],
  };
  const result = computeBoardDeclarationDigest(fixedBoard);
  assert.equal(result.ok, true);
  assert.equal(result.digest, 'acd779c5cb86e7b6875312d7268c9f8a1d119002fad622ae4d793a02076414a9');

  // The digest must not change when a VOLATILE field changes (enabled and
  // correctionCycles are dropped by the projection).
  const sameDeclarationDifferentVolatile = {
    ...fixedBoard,
    enabled: false,
    correctionCycles: 3,
    cards: [{ ...fixedBoard.cards[0], status: 'done', attempts: 2, evidence: ['e1'] }],
  };
  const secondResult = computeBoardDeclarationDigest(sameDeclarationDifferentVolatile);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.digest, result.digest);
});

test('F6 golden vector: a board exercising unicode and negative zero digests to a pinned hex value', () => {
  const { computeBoardDeclarationDigest } = requireApi();
  const fixedBoard = {
    schemaVersion: 1,
    enabled: true,
    pipelineId: 'golden-vector-unicode',
    zero: -0,
    lone: '\uD800tail',
    nested: { b: 1, a: [1, 2, 3] },
  };
  const result = computeBoardDeclarationDigest(fixedBoard);
  assert.equal(result.ok, true);
  assert.equal(result.digest, '2316b60b2aeb731ad670dcb570500ee89b35e361f629d49b07b5acb0471f2e8d');
});
