'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: nodeTypes } = require('node:util');

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TOML_BYTES = 256 * 1024;
const MAX_AGENT_DIRS = 4;
const MAX_AGENT_ENTRIES_PER_DIR = 1000;
const MAX_DISCOVERED_ROLES = 500;
const MAX_PRINTED_ROLES = 50;
const MAX_DOCTOR_OUTPUT_BYTES = 16 * 1024;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_STOP_CONDITION_LENGTH = 500;
const MAX_ATTESTATIONS = 500;
const MAX_EVIDENCE_PER_CARD = 32;
const MAX_DEPENDENCIES_PER_CARD = 8;
const MAX_BOARD_NODES = 50000;
const MAX_BOARD_DEPTH = 64;
// Total enumerated properties across the whole plain-data walk. Object nodes are
// already capped by MAX_BOARD_NODES, but a single dense array/object node can hold
// hundreds of thousands of primitive leaves that Reflect.ownKeys materializes and
// scans - unbounded work under the node cap (a DoS). This bounds that. Generous:
// real boards carry well under 1000 total properties.
const MAX_BOARD_PROPERTIES = 100000;
// F6 (docs/proposals/f6-board-declaration-binding.md) R3: an aggregate cap on the
// total UTF-16 code units summed across every string in a board declaration,
// checked during the pre-projection R4 domain pass (validateDeclarationDomain)
// BEFORE the encoder allocates any string payload. MAX_BOARD_PROPERTIES/NODES
// bound tree shape, not the length of any one string, and an in-process caller
// is not bounded by MAX_JSON_BYTES (CLI-only), so this closes that gap.
const MAX_ENCODED_STRING_UNITS = 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
const UNSAFE_DISPLAY_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

const AGENCY_REPOSITORY = 'https://github.com/msitarzewski/agency-agents';
const AGENCY_COMMIT = 'ebe9c99acb5c96f9468de368d8bead775387d1a7';
const AGENCY_DISCOVERY_MODE = 'runtime-installed-codex-toml';

const ATTESTATION_KINDS = Object.freeze({
  role: 'agency.role-provenance.v1',
  optIn: 'agency.pipeline-opt-in.v1',
  evidence: 'agency.card-evidence.v1',
  accounting: 'agency.accounting.v1',
});

// F6: versions the board-declaration binding SCHEME (projection rule + encoding
// + hash), independently of the attestation KIND above. Carried as the value of
// the `boardBindingKind` field on opt-in and evidence attestations - not itself
// an attestation kind.
const BOARD_BINDING_KIND = 'agency.board-binding.v1';

// F6 Section 5.1: the declaration projection denylist. Dropped from the digest
// encoding exactly here, nothing else - every other field is covered by default
// (allowlist-by-exclusion), including any field not named here.
const BOARD_TOP_LEVEL_VOLATILE_KEYS = Object.freeze(new Set(['enabled', 'correctionCycles']));
const BOARD_CARD_VOLATILE_KEYS = Object.freeze(new Set(['status', 'attempts', 'evidence']));
const EMPTY_KEY_SET = Object.freeze(new Set());

// F6 Section 5.2: one byte type tag per encoded node.
const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;
const TAG_NULL_BUF = Buffer.from([TAG_NULL]);
const TAG_FALSE_BUF = Buffer.from([TAG_FALSE]);
const TAG_TRUE_BUF = Buffer.from([TAG_TRUE]);

// Thrown only inside the encoder's own call graph and always caught at the top
// of encodeBoardDeclaration, converting to a {ok:false, error} result per R3/5.7
// ("cannot throw on shape - it fails closed with an error result").
class BoardDigestError extends Error {}

const REQUIRED_BOARD_STATUSES = Object.freeze(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']);
const REQUIRED_ACTIVE_STATUSES = Object.freeze(['in_progress', 'review']);
const REQUIRED_WORKER_MODES = Object.freeze(['writer', 'reviewer', 'researcher']);
const REQUIRED_DELEGATION = Object.freeze({
  workersMaySpawn: false,
  oneWriter: true,
  oneCorrectionCycle: true,
  requiresStopCondition: true,
  requiresEvidenceForDone: true,
  requiresControllerOptIn: true,
  requiresControllerEvidence: true,
  preferLowestCapableTier: true,
});
const REQUIRED_TRUST = Object.freeze({
  externalContent: 'untrusted',
  promptInstructionsFromExternalContent: 'ignore',
  globalInstallOrConfigMutation: false,
  roleAttestationRequired: true,
  boardPathsRestrictedToWorkspace: true,
  terminalOutputSanitized: true,
  authenticatedControllerVerifierRequired: true,
});
// F6 Section 6/9: contracts.attestations.schemaVersion bumps 1 -> 2 alongside
// these additive keys. This is the CONTRACTS-DOCUMENT policy field
// (contracts.attestations.schemaVersion) - a distinct thing from an individual
// attestation INSTANCE's own top-level `schemaVersion` field (still pinned to 1
// via authenticatedControllerSnapshot's `snapshot.schemaVersion !== 1` check;
// see the naming note in the F6 doc's Section 6). `boardBindingRequired` is
// intentionally NOT in this fixed set - it is the two-phase rollout toggle
// (false in Phase 1, true in Phase 2) and is validated separately, by type
// only, in validateContracts.
const REQUIRED_ATTESTATIONS_FIXED = Object.freeze({
  schemaVersion: 2,
  authenticatedControllerVerifierRequired: true,
  roleKind: ATTESTATION_KINDS.role,
  optInKind: ATTESTATION_KINDS.optIn,
  evidenceKind: ATTESTATION_KINDS.evidence,
  accountingKind: ATTESTATION_KINDS.accounting,
  accountingUsageDigestRequired: true,
  boardBindingKind: BOARD_BINDING_KIND,
});

const REQUIRED_STARTER_ROLES = Object.freeze({
  'product-sprint-prioritizer': Object.freeze({
    title: 'Sprint Prioritizer',
    division: 'product',
    sourcePath: 'product/product-sprint-prioritizer.md',
    promptSha256: 'da5233770ca85a3931b72d80b37dd09616a54fd24075c607667853acf65b000a',
    capabilities: Object.freeze(['backlog-triage', 'dependency-ordering', 'scope-control']),
  }),
  'engineering-backend-architect': Object.freeze({
    title: 'Backend Architect',
    division: 'engineering',
    sourcePath: 'engineering/engineering-backend-architect.md',
    promptSha256: '18f237d054fa91f72a5dcda46a52ddcf7354ea3a3e39e0247629f4ea0f446917',
    capabilities: Object.freeze(['backend-architecture', 'api-design', 'data-boundaries']),
  }),
  'engineering-frontend-developer': Object.freeze({
    title: 'Frontend Developer',
    division: 'engineering',
    sourcePath: 'engineering/engineering-frontend-developer.md',
    promptSha256: '35961da50f408e00eb6189c87825ac5e62e6b1bf9de3dee198a95536c6d2619e',
    capabilities: Object.freeze(['frontend-implementation', 'responsive-ui', 'accessibility']),
  }),
  'testing-reality-checker': Object.freeze({
    title: 'Reality Checker',
    division: 'testing',
    sourcePath: 'testing/testing-reality-checker.md',
    promptSha256: '6d32fcdb114233e13902ec6372d50293b120e85d490b5e81d372c29808f988a1',
    capabilities: Object.freeze(['evidence-review', 'production-readiness', 'scope-verification']),
  }),
});

const REQUIRED_LIMITS = Object.freeze({
  maxDepth: 1,
  maxFanOut: 3,
  maxCards: 8,
  maxAttemptsPerCard: 2,
  maxCorrectionCycles: 1,
  maxTurnsPerCard: 12,
  maxToolCallsPerCard: 40,
  maxWorkerMinutes: 10,
  maxPipelineMinutes: 30,
  maxInputTokensPerCard: 12000,
  maxOutputTokensPerCard: 4000,
  maxHandoffTokens: 200,
  maxActiveWriters: 1,
});

const REQUIRED_DISCOVERY_LIMITS = Object.freeze({
  maxDirectories: MAX_AGENT_DIRS,
  maxEntriesPerDirectory: MAX_AGENT_ENTRIES_PER_DIR,
  maxCandidates: MAX_DISCOVERED_ROLES,
  maxPrintedCandidates: MAX_PRINTED_ROLES,
});

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function displayValue(value, maximum = MAX_IDENTIFIER_LENGTH) {
  // String(value) throws on a value with no primitive conversion - e.g. a
  // null-prototype object (no Symbol.toPrimitive/toString) or an object whose
  // toString/valueOf throws. This is a diagnostic path: an out-of-contract
  // declaration must be reported as a validation error, never crash validation,
  // so fall back to a fixed marker when the conversion throws.
  let raw;
  try {
    raw = String(value);
  } catch (_error) {
    raw = '[unconvertible value]';
  }
  const text = raw.replace(UNSAFE_DISPLAY_CHARACTERS_GLOBAL, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  const truncated = text.length > maximum ? `${text.slice(0, maximum)}...` : text;
  return JSON.stringify(truncated);
}

function displayIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : displayValue(value);
}

function sameFileIdentity(left, right, includeSize = true) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    (!includeSize || left.size === right.size)
  );
}

function assertNoReparseComponents(absolutePath, label) {
  const resolved = path.resolve(absolutePath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const components = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  for (const component of components) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing ${label} with a reparse-point ancestor: ${displayValue(current, 240)}`);
    }
  }
}

function captureContainedFile(filePath, allowedRoot) {
  const rootPath = path.resolve(allowedRoot);
  assertNoReparseComponents(rootPath, 'allowed board root');
  const rootStat = fs.lstatSync(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Allowed board root must be a direct directory: ${displayValue(rootPath, 240)}`);
  }
  const realRoot = fs.realpathSync.native(rootPath);
  assertNoReparseComponents(realRoot, 'allowed board root');
  const requested = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(realRoot, filePath);
  assertNoReparseComponents(requested, 'board file path');
  const realFile = fs.realpathSync.native(requested);
  if (!isPathInside(realRoot, realFile)) {
    throw new Error(`Board file is outside the allowed board root: ${displayValue(realFile, 240)}`);
  }
  assertNoReparseComponents(realFile, 'board file path');
  return { rootPath, rootStat, realRoot, filePath: realFile };
}

function secureReadRegularFile(filePath, maximumBytes, label, options = {}) {
  let containment;
  try {
    containment = options.allowedRoot ? captureContainedFile(filePath, options.allowedRoot) : null;
  } catch (error) {
    if (error && typeof error.message === 'string') throw error;
    throw new Error(`Unable to validate ${label} path: ${displayValue(filePath, 240)}`);
  }
  const readPath = containment ? containment.filePath : filePath;
  let directStat;
  try {
    directStat = fs.lstatSync(readPath);
  } catch (_error) {
    throw new Error(`${label} is unavailable: ${displayValue(readPath, 240)}`);
  }
  if (!directStat.isFile() || directStat.isSymbolicLink()) {
    throw new Error(`Refusing non-regular ${label}: ${displayValue(readPath, 240)}`);
  }

  let descriptor;
  try {
    descriptor = fs.openSync(readPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink > 1) {
      throw new Error(`Refusing linked or non-regular ${label}: ${displayValue(readPath, 240)}`);
    }
    if (!sameFileIdentity(directStat, before)) {
      throw new Error(`${label} changed before it was opened: ${displayValue(readPath, 240)}`);
    }
    if (before.size > maximumBytes) {
      throw new Error(`Refusing ${label} larger than ${maximumBytes} bytes: ${displayValue(readPath, 240)}`);
    }
    const contents = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameFileIdentity(before, after)) {
      throw new Error(`${label} changed while being read: ${displayValue(readPath, 240)}`);
    }
    const finalStat = fs.lstatSync(readPath);
    if (finalStat.isSymbolicLink() || !finalStat.isFile() || !sameFileIdentity(after, finalStat)) {
      throw new Error(`${label} path changed while being read: ${displayValue(readPath, 240)}`);
    }
    if (containment) {
      assertNoReparseComponents(containment.rootPath, 'allowed board root');
      assertNoReparseComponents(readPath, 'board file path');
      const finalRootStat = fs.lstatSync(containment.rootPath);
      const finalRealRoot = fs.realpathSync.native(containment.rootPath);
      const finalRealFile = fs.realpathSync.native(readPath);
      if (
        !sameFileIdentity(containment.rootStat, finalRootStat, false) ||
        path.relative(containment.realRoot, finalRealRoot) !== '' ||
        !isPathInside(containment.realRoot, finalRealFile) ||
        path.relative(readPath, finalRealFile) !== ''
      ) {
        throw new Error(`${label} containment changed while being read: ${displayValue(readPath, 240)}`);
      }
    }
    return contents;
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes(label)) throw error;
    throw new Error(`Unable to read ${label} ${displayValue(readPath, 240)}: ${displayValue(error.message, 240)}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readJsonFile(filePath, options = {}) {
  const contents = secureReadRegularFile(filePath, MAX_JSON_BYTES, 'JSON file', options);
  try {
    return JSON.parse(contents.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${displayValue(filePath, 240)}: ${displayValue(error.message, 240)}`);
  }
}

function loadRegistry(pluginRoot) {
  return readJsonFile(path.join(pluginRoot, 'integrations', 'agency-agents', 'registry.json'), {
    allowedRoot: pluginRoot,
  });
}

function loadContracts(pluginRoot) {
  return readJsonFile(path.join(pluginRoot, 'integrations', 'agency-agents', 'contracts.json'), {
    allowedRoot: pluginRoot,
  });
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveContainedFile(filePath, allowedRoot) {
  try {
    return captureContainedFile(filePath, allowedRoot).filePath;
  } catch (error) {
    if (error && typeof error.message === 'string') throw error;
    throw new Error(`Board file is unavailable: ${displayValue(filePath, 240)}`);
  }
}

// Read a thrown value's `message` exactly once inside a try/catch so a hostile
// error - one whose `message` is a getter or Proxy trap that throws - cannot make
// the extraction itself throw. The agency-doctor CLI backstop uses this to derive
// its FAIL reason; without it a throwing `message` accessor would escape the
// backstop and dump an uncaught stack trace, defeating the bounded-output promise.
function safeErrorMessage(error) {
  try {
    const message = error && error.message;
    return typeof message === 'string' ? message : 'unknown error';
  } catch (_error) {
    return 'unknown error';
  }
}

function discoverCodexAgentCandidates(agentDirs) {
  if (!Array.isArray(agentDirs)) throw new Error('agentDirs must be an array');
  if (agentDirs.length > MAX_AGENT_DIRS) {
    throw new Error(`Maximum ${MAX_AGENT_DIRS} agent directories may be inspected`);
  }

  const candidates = [];
  const scannedRoots = new Set();
  for (const dir of agentDirs) {
    let rootStat;
    try {
      rootStat = fs.lstatSync(dir);
    } catch (_error) {
      continue;
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(`Agent directory must be a direct directory: ${displayValue(dir, 240)}`);
    }
    assertNoReparseComponents(path.resolve(dir), 'agent directory');
    const realRoot = fs.realpathSync.native(dir);
    if (scannedRoots.has(realRoot)) continue;
    scannedRoots.add(realRoot);
    const entries = fs.readdirSync(realRoot, { withFileTypes: true });
    if (entries.length > MAX_AGENT_ENTRIES_PER_DIR) {
      throw new Error(`Agent directory exceeds ${MAX_AGENT_ENTRIES_PER_DIR} entries: ${displayValue(realRoot, 240)}`);
    }
    for (const entry of entries) {
      const extension = path.extname(entry.name);
      if (!entry.isFile() || extension.toLowerCase() !== '.toml') continue;
      const name = path.basename(entry.name, extension);
      if (!SAFE_IDENTIFIER.test(name)) continue;
      const filePath = path.join(realRoot, entry.name);
      const realFile = fs.realpathSync.native(filePath);
      if (!isPathInside(realRoot, realFile)) continue;
      const contents = secureReadRegularFile(realFile, MAX_TOML_BYTES, 'TOML role file', {
        allowedRoot: realRoot,
      });
      candidates.push({
        name,
        filePath: realFile,
        tomlSha256: crypto.createHash('sha256').update(contents).digest('hex'),
      });
      if (candidates.length > MAX_DISCOVERED_ROLES) {
        throw new Error(`Discovered role count exceeds maximum ${MAX_DISCOVERED_ROLES}`);
      }
    }
  }
  return candidates.sort((a, b) => compareText(a.name, b.name) || compareText(a.filePath, b.filePath));
}

function discoverCodexAgents(agentDirs, options = {}) {
  const registry = options.registry;
  // Sanitize to non-Proxy plain-data objects BEFORE any `.name` read below. A
  // hostile Proxy attestation whose get trap throws would otherwise crash the
  // countBy/Map construction; dropping it just makes that role ineligible -
  // correct fail-closed behaviour.
  const attestations = (Array.isArray(options.attestations) ? options.attestations : []).filter(
    isPlainAttestationObject
  );
  if (attestations.length > MAX_ATTESTATIONS) throw new Error(`Role attestations exceed maximum ${MAX_ATTESTATIONS}`);
  const candidates = discoverCodexAgentCandidates(agentDirs);
  const candidateCounts = countBy(candidates, (candidate) => candidate.name);
  const attestationCounts = countBy(attestations, (attestation) => attestation && attestation.name);
  const attestationByName = new Map(attestations.map((attestation) => [attestation && attestation.name, attestation]));
  const registeredByName = new Map(
    registry && Array.isArray(registry.roles)
      ? registry.roles.filter((role) => role && typeof role === 'object').map((role) => [role.name, role])
      : []
  );
  const eligible = [];

  for (const candidate of candidates) {
    if (candidateCounts.get(candidate.name) !== 1 || attestationCounts.get(candidate.name) !== 1) continue;
    const attestation = attestationByName.get(candidate.name);
    const registered = pinnedOrRegisteredRole(candidate.name, registeredByName);
    if (!isTrustedRoleAttestation(attestation, candidate, registered, options.controllerAttestationVerifier)) continue;
    eligible.push(candidate.name);
  }
  return [...new Set(eligible)].sort();
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Defence in depth against the accessor form of a snapshot TOCTOU: refuse any
// attestation that is not a plain data object. An own property defined through a
// getter or setter, or a non-Object prototype, is rejected before a snapshot is
// even taken, so a field cannot hand one value to the verifier and a different
// value to a later re-read.
function isPlainDataAttestation(attestation) {
  // Reject any Proxy before any reflection runs. A Proxy's traps (getPrototypeOf,
  // ownKeys, getOwnPropertyDescriptor) can throw or lie during the shape
  // inspection below, so a throwing trap would escape this predicate and crash
  // validateBoard instead of failing closed. util.types.isProxy reads an internal
  // slot and cannot be spoofed from JS, so reject Proxies outright and up front.
  if (nodeTypes.isProxy(attestation)) return false;
  const prototype = Object.getPrototypeOf(attestation);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(attestation)) {
    const descriptor = Object.getOwnPropertyDescriptor(attestation, key);
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return false;
    }
    // F6 R7: authenticatedControllerSnapshot's shallow `Object.freeze({...attestation})`
    // spread copies only ENUMERABLE own properties. A non-enumerable own data
    // property - however malformed or wrong - would otherwise vanish from the
    // snapshot the binding predicates read, becoming indistinguishable from
    // "absent" and warn-accepting under Phase 1 exactly where it must reject.
    // Attestations are always plain, non-array objects (isPlainAttestationObject
    // excludes arrays before this runs), so there is no array/length exemption
    // to carve out here, unlike R3b's array case below.
    if (!descriptor.enumerable) return false;
  }
  return true;
}

// A non-Proxy plain-data attestation OBJECT gate. Mirrors the guards
// authenticatedControllerSnapshot applies before it calls isPlainDataAttestation:
// isPlainDataAttestation rejects a Proxy (via nodeTypes.isProxy) but must NOT be
// called on null, so null/non-object/array are screened first. Use this before
// reading ANY field of a caller-supplied attestation - e.g. its `.name` - so a
// hostile Proxy whose get trap throws is rejected up front and fails closed,
// never crashing the field read.
function isPlainAttestationObject(attestation) {
  return Boolean(
    attestation &&
    typeof attestation === 'object' &&
    !Array.isArray(attestation) &&
    isPlainDataAttestation(attestation)
  );
}

// Generalise the plain-data notion over an entire board tree so validateBoard
// can refuse a non-plain board at the boundary before it reads a single field.
// A getter on any reachable board/card/budget field is an accessor TOCTOU: it
// could return a passing value to validation and a hostile value when the host
// later re-reads the same live object. This returns false for ANY reachable own
// property defined through a getter/setter, any object whose prototype is not
// Object.prototype or null, any array whose prototype is not Array.prototype,
// any node exposing an inherited enumerable property (R3c - the encoder sees own
// keys only, while the host reads fields through the prototype chain), any
// symbol own key, or a tree that exceeds the node or depth caps. The walk is
// ITERATIVE (explicit stack, no recursion) so a pathologically deep board yields
// a bounded false, never a RangeError - it also replaces the bound the removed
// digest encoder used to provide.
function isDeeplyPlainData(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  let properties = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    nodes += 1;
    if (nodes > MAX_BOARD_NODES || depth > MAX_BOARD_DEPTH) return false;
    // Reject any Proxy anywhere in the tree. A Proxy's own-property descriptors
    // mirror its target's real values, but its get trap can return a different
    // value on the live [[Get]] validateBoard performs later - a TOCTOU vector
    // that the descriptor inspection below cannot catch. util.types.isProxy reads
    // an internal slot and cannot be spoofed from JS, so reject Proxies outright.
    if (nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    const isArrayNode = Array.isArray(value);
    if (isArrayNode) {
      if (prototype !== Array.prototype) return false;
      // Bound total enumeration work BEFORE materializing keys for a huge dense
      // array: reject an array longer than the property cap outright, so a
      // pathologically wide array cannot force an O(length) Reflect.ownKeys walk.
      if (value.length > MAX_BOARD_PROPERTIES) return false;
      // F6 R3a: own keys must be EXACTLY the dense indices 0..length-1 plus
      // "length" itself - no more, no fewer. A bare cardinality check
      // (Reflect.ownKeys(value).length === value.length + 1) is NOT sufficient:
      // a missing index (a hole) and an unrelated extra own property (e.g.
      // `cards.approval = "x"`) can cancel out and preserve the expected count
      // while both defects are present. Checking membership directly closes
      // that: every index must be an OWN property (Object.hasOwn, not `in`,
      // which is also true for an INHERITED numeric property via a polluted
      // prototype and would treat a hole as filled when it is not truly own),
      // and the only key besides those `length` indices may be "length" itself
      // (enforced by the exact ownKeys.length match below, since exactly
      // `length` real index checks plus one leftover slot for "length" leaves
      // no room for any other key once both are accounted for).
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1) return false;
      for (let i = 0; i < value.length; i += 1) {
        if (!Object.hasOwn(value, i)) return false;
      }
      if (!ownKeys.includes('length')) return false;
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      // Bound the total properties enumerated across the whole walk, so a wide
      // object (or the dense array above) cannot force unbounded scanning.
      properties += 1;
      if (properties > MAX_BOARD_PROPERTIES) return false;
      if (typeof key === 'symbol') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        return false;
      }
      // F6 R3b: a non-enumerable own property on a NON-ARRAY object is invisible
      // to Object.keys, which the declaration encoder (5.5) uses as its single
      // source of truth for object keys - an accepted-but-invisible field could
      // then change without changing the digest. Arrays are exempted here
      // because their own `length` is always non-enumerable by ECMAScript
      // specification (a blanket ban would reject every array, contradicting
      // R3a and the 0x05 array encoding); arrays are instead fully covered by
      // the exact-index check above, which is more precise than this rule for
      // the array case.
      if (!isArrayNode && !descriptor.enumerable) return false;
      const child = descriptor.value;
      // A function/callable is not plain data and could carry executable
      // behaviour or traps on the same object the host may later dispatch.
      // typeof catches both plain functions and callable Proxies (a Proxy whose
      // target is a function), neither of which the object walk below would
      // otherwise inspect - only typeof 'object' children are pushed.
      if (typeof child === 'function') return false;
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
    // F6 R3c: reject any node that exposes an INHERITED enumerable property.
    // Every check above, plus validateDeclarationDomain and the encoder, reads
    // OWN keys only (Reflect.ownKeys / Object.keys), while validateBoard and the
    // host read individual fields with ordinary property access -
    // `card.stopCondition`, `budget.turns`, `board.pipelineId` - which walks the
    // prototype chain. In a prototype-polluted process (the classic
    // `Object.prototype.stopCondition = '...'` gadget, reachable from a
    // data-driven merge/clone over attacker JSON elsewhere in the host), a card
    // merely MISSING that key as an own property is encoded without it while
    // validation still consumes the inherited value - so one digest pairs with
    // two different effective declarations, which is exactly the binding F6
    // exists to provide. R3a already applies the own-property rule to array
    // indices (Object.hasOwn, not `in`, precisely so an inherited numeric
    // property cannot pass a hole off as filled); this extends the identical
    // rule to every key of every node. It does not contradict R1's deliberate
    // prototype-blind quotient: R1 says two nodes with identical CONTENT digest
    // alike whether their prototype is Object.prototype or null, which holds
    // only because a pristine prototype contributes no content - this check is
    // what makes that premise true instead of assumed.
    //
    // Bounded without its own counter: for...in never yields the same key twice,
    // so every iteration before the first inherited key consumed one of THIS
    // node's own enumerable keys, and the first inherited key returns false
    // immediately. The loop therefore runs at most (own enumerable keys) + 1
    // times - work already charged against MAX_BOARD_PROPERTIES by the own-key
    // loop above, which runs first, so the whole walk stays inside a constant
    // factor of that same bound and no prototype, however wide, can spin it up.
    // Charging these iterations to the shared counter as well would halve the
    // effective cap for every board, changing an existing bound rather than
    // adding a check.
    //
    // Residual, stated rather than left implied: an inherited NON-enumerable
    // property (Object.defineProperty against an intrinsic prototype) is
    // invisible to for...in and is not caught here. Unlike assignment-based
    // pollution it is not reachable through a data-driven merge gadget, only by
    // arbitrary in-process code execution, at which point no gate in this file
    // means anything anyway.
    for (const key in value) {
      if (!Object.hasOwn(value, key)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// F6 (docs/proposals/f6-board-declaration-binding.md): bind attestations to a
// SHA-256 digest of the exact board declaration a controller approved, instead
// of only a free-form pipelineId (the gap tracked as issue #5). Every function
// below implements one part of the doc's Section 5 encoding spec. Two ordered
// passes, per Section 5.1's check order (run only on a board isDeeplyPlainData
// has already accepted): validateDeclarationDomain walks the COMPLETE board
// (including the volatile fields projection will later drop) enforcing R4
// (reject non-finite numbers, undefined, bigint) and the R3 aggregate string
// cap; encodeBoardDeclaration then walks only the surviving (non-volatile)
// fields, producing the injective byte encoding that computeBoardDeclarationDigest
// hashes. Every "normalize then hash" step is where the four historical
// collision classes (Section 2) came from, so nothing here transcodes or
// re-materializes - values outside the canonical domain are REJECTED, never
// coerced.
// ---------------------------------------------------------------------------

// R4 + R3: an iterative (explicit stack, never recursive - a pathologically
// deep board must yield a bounded error, not a RangeError), pre-projection walk
// over the WHOLE board. Non-finite numbers, and any value of type undefined,
// bigint, symbol, or function are a hard error (R4); isDeeplyPlainData already
// rejects symbols/functions/accessors/Proxies structurally, so this is a
// defensive re-check for those, and the real work here is the numeric-finiteness
// and string-unit checks isDeeplyPlainData does not perform. The aggregate
// code-unit total is accumulated across EVERY string in the tree - object own
// keys as well as values, since encodeStringNode (5.4/5.5) encodes both -
// including inside fields the projection will later drop (5.1: a large string
// hidden in `evidence` on a non-done card must still fail closed here), and
// the check fails BEFORE the oversized payload would be allocated by the
// encoder.
function validateDeclarationDomain(board) {
  const stack = [{ value: board, depth: 0 }];
  let nodes = 0;
  let properties = 0;
  let stringUnits = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (value === null) continue;
    const type = typeof value;
    if (type === 'object') {
      nodes += 1;
      if (nodes > MAX_BOARD_NODES) return { ok: false, error: 'board declaration exceeds maximum node count' };
      if (depth > MAX_BOARD_DEPTH) return { ok: false, error: 'board declaration exceeds maximum depth' };
      if (Array.isArray(value)) {
        if (value.length > MAX_BOARD_PROPERTIES) {
          return { ok: false, error: 'board declaration exceeds maximum property count' };
        }
        for (let i = 0; i < value.length; i += 1) {
          properties += 1;
          if (properties > MAX_BOARD_PROPERTIES) {
            return { ok: false, error: 'board declaration exceeds maximum property count' };
          }
          stack.push({ value: value[i], depth: depth + 1 });
        }
      } else {
        for (const key of Object.keys(value)) {
          properties += 1;
          if (properties > MAX_BOARD_PROPERTIES) {
            return { ok: false, error: 'board declaration exceeds maximum property count' };
          }
          // R3: object keys are encoded too (encodeStringNode is used for both
          // keys and values - 5.5), so a key's code units must count toward the
          // same aggregate cap as string values, checked here before the
          // encoder ever allocates a payload for it. Without this, a single
          // oversized own-key (or enough cumulative key text) would sail
          // through this pre-projection pass unbounded and only be caught -
          // too late for a fail-closed gate - once encoding actually runs.
          stringUnits += key.length;
          if (stringUnits > MAX_ENCODED_STRING_UNITS) {
            return {
              ok: false,
              error: `board declaration string content exceeds the maximum ${MAX_ENCODED_STRING_UNITS} aggregate UTF-16 code units`,
            };
          }
          stack.push({ value: value[key], depth: depth + 1 });
        }
      }
      continue;
    }
    if (type === 'number') {
      if (!Number.isFinite(value)) {
        return { ok: false, error: 'board declaration contains a non-finite number and cannot be digested' };
      }
      continue;
    }
    if (type === 'string') {
      stringUnits += value.length;
      if (stringUnits > MAX_ENCODED_STRING_UNITS) {
        return {
          ok: false,
          error: `board declaration string content exceeds the maximum ${MAX_ENCODED_STRING_UNITS} aggregate UTF-16 code units`,
        };
      }
      continue;
    }
    if (type === 'boolean') continue;
    // undefined, bigint, symbol, function: outside the canonical domain (R4).
    return { ok: false, error: `board declaration contains an unsupported value of type ${type} and cannot be digested` };
  }
  return { ok: true };
}

// 5.4: length-prefixed UTF-16 code units - 4-byte BE count, then each
// charCodeAt(i) as 2 bytes BE. Lossless for every JS string including lone
// surrogates (class 3 cannot occur: no transcoding step exists). Also used to
// encode object KEYS (5.5), so entries can be sorted by the encoded bytes.
function encodeStringNode(value) {
  if (value.length > 0xffffffff) {
    throw new BoardDigestError('board declaration string exceeds the maximum encodable length');
  }
  const header = Buffer.alloc(5);
  header.writeUInt8(TAG_STRING, 0);
  header.writeUInt32BE(value.length, 1);
  const payload = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    payload.writeUInt16BE(value.charCodeAt(i), i * 2);
  }
  return Buffer.concat([header, payload]);
}

// 5.3: 8-byte big-endian IEEE-754 binary64 bit pattern. -0 and +0 have distinct
// bit patterns and therefore distinct digests (SameValue, per R1) -
// DataView/Buffer float writers respect the sign of zero, so no special-casing
// is needed. Finite-only; the caller (validateDeclarationDomain) already
// rejects non-finite numbers, so this is a defensive re-check.
function encodeNumberLeaf(value) {
  if (!Number.isFinite(value)) {
    throw new BoardDigestError('board declaration contains a non-finite number and cannot be digested');
  }
  const buffer = Buffer.alloc(9);
  buffer.writeUInt8(TAG_NUMBER, 0);
  buffer.writeDoubleBE(value, 1);
  return buffer;
}

function encodeLeafValue(value) {
  if (value === null) return TAG_NULL_BUF;
  const type = typeof value;
  if (type === 'boolean') return value ? TAG_TRUE_BUF : TAG_FALSE_BUF;
  if (type === 'number') return encodeNumberLeaf(value);
  if (type === 'string') return encodeStringNode(value);
  throw new BoardDigestError(`cannot digest board declaration value of type ${type}`);
}

// Builds one traversal frame for a composite (object or array) node, computing
// this node's children up front so the iterative walk below never recurses
// through the JS call stack (R3: "iterative..., never recursive" - a 20,000+
// level board must not overflow it). `contextSpec` carries the projection
// context the PARENT assigned to this specific child position:
//   - volatileKeys: keys to drop from THIS object's own entries (5.1). Only the
//     root (top-level board) and elements of the root's own `cards` array ever
//     carry a non-empty set; projection is purely structural/positional, never
//     a name-based recursive strip, so a `status` field nested somewhere else
//     entirely is never dropped.
//   - isTopLevelBoard: true only for the root frame, so only the board's OWN
//     `cards` key (not a same-named key anywhere else) triggers per-card
//     stripping of that array's elements.
//   - isCardsArray: true only for the array frame created for the root's own
//     `cards` value, so its elements (when plain non-array objects) receive
//     BOARD_CARD_VOLATILE_KEYS.
//   - resultIndex: where this frame's finished buffer is written back into the
//     parent frame's `results` array once complete.
function createDeclarationFrame(value, depth, contextSpec, state) {
  state.nodes += 1;
  if (state.nodes > MAX_BOARD_NODES) throw new BoardDigestError('board declaration exceeds maximum node count');
  if (depth > MAX_BOARD_DEPTH) throw new BoardDigestError('board declaration exceeds maximum depth');

  if (Array.isArray(value)) {
    if (value.length > 0xffffffff) {
      throw new BoardDigestError('board declaration array exceeds the maximum encodable length');
    }
    const elementVolatileKeys =
      contextSpec && contextSpec.isCardsArray ? BOARD_CARD_VOLATILE_KEYS : EMPTY_KEY_SET;
    const childSpecs = [];
    for (let i = 0; i < value.length; i += 1) {
      state.properties += 1;
      if (state.properties > MAX_BOARD_PROPERTIES) {
        throw new BoardDigestError('board declaration exceeds maximum property count');
      }
      childSpecs.push({ rawValue: value[i], volatileKeys: elementVolatileKeys, isTopLevelBoard: false, isCardsArray: false });
    }
    return {
      kind: 'array',
      depth,
      childSpecs,
      cursor: 0,
      results: new Array(childSpecs.length),
      resultIndex: contextSpec ? contextSpec.resultIndex : undefined,
    };
  }

  // Plain non-array object (guaranteed by the isDeeplyPlainData gate the caller
  // already ran): Object.keys is the single source of truth for its keys - R3b
  // guarantees no non-enumerable own property can hide a field from this list.
  const volatileKeys = (contextSpec && contextSpec.volatileKeys) || EMPTY_KEY_SET;
  const isTopLevelBoard = Boolean(contextSpec && contextSpec.isTopLevelBoard);
  const keys = Object.keys(value).filter((key) => !volatileKeys.has(key));
  const childSpecs = keys.map((key) => {
    state.properties += 1;
    if (state.properties > MAX_BOARD_PROPERTIES) {
      throw new BoardDigestError('board declaration exceeds maximum property count');
    }
    const rawValue = value[key];
    return {
      key,
      keyBuffer: encodeStringNode(key),
      rawValue,
      volatileKeys: EMPTY_KEY_SET,
      isTopLevelBoard: false,
      isCardsArray: isTopLevelBoard && key === 'cards' && Array.isArray(rawValue),
    };
  });
  return {
    kind: 'object',
    depth,
    childSpecs,
    cursor: 0,
    results: new Array(childSpecs.length),
    resultIndex: contextSpec ? contextSpec.resultIndex : undefined,
  };
}

function finalizeDeclarationFrame(frame) {
  if (frame.kind === 'array') {
    const header = Buffer.alloc(5);
    header.writeUInt8(TAG_ARRAY, 0);
    header.writeUInt32BE(frame.childSpecs.length, 1);
    return Buffer.concat([header, ...frame.results]);
  }
  // 5.5: entries sorted by BYTEWISE comparison of the encoded key bytes
  // (tag+length+payload), not the string form - no locale, no ICU (R2). Own
  // string keys are unique, so this order is total and deterministic.
  const entries = frame.childSpecs.map((spec, index) => ({ keyBuffer: spec.keyBuffer, valueBuffer: frame.results[index] }));
  entries.sort((a, b) => Buffer.compare(a.keyBuffer, b.keyBuffer));
  const header = Buffer.alloc(5);
  header.writeUInt8(TAG_OBJECT, 0);
  header.writeUInt32BE(entries.length, 1);
  const parts = [header];
  for (const entry of entries) parts.push(entry.keyBuffer, entry.valueBuffer);
  return Buffer.concat(parts);
}

// The iterative (explicit-stack) post-order walk itself. Each frame resolves
// its children one at a time; a leaf resolves immediately, a composite child
// pushes a new frame and this frame waits (its `cursor` does not advance again
// until that child's frame pops and bubbles its buffer back via resultIndex).
// This is a manual simulation of recursive descent using the array-based stack
// mirroring isDeeplyPlainData's own walk, never the JS call stack - see R3.
function runDeclarationEncode(board, state) {
  const rootSpec = {
    volatileKeys: BOARD_TOP_LEVEL_VOLATILE_KEYS,
    isTopLevelBoard: true,
    isCardsArray: false,
    resultIndex: undefined,
  };
  const stack = [createDeclarationFrame(board, 0, rootSpec, state)];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.cursor >= frame.childSpecs.length) {
      const buffer = finalizeDeclarationFrame(frame);
      stack.pop();
      if (stack.length === 0) return buffer;
      const parent = stack[stack.length - 1];
      parent.results[frame.resultIndex] = buffer;
      continue;
    }
    const spec = frame.childSpecs[frame.cursor];
    const index = frame.cursor;
    frame.cursor += 1;
    const value = spec.rawValue;
    if (value === null || typeof value !== 'object') {
      frame.results[index] = encodeLeafValue(value);
      continue;
    }
    stack.push(createDeclarationFrame(value, frame.depth + 1, { ...spec, resultIndex: index }, state));
  }
  throw new BoardDigestError('board declaration encoding produced no result');
}

// Section 5 entry point: never throws (R3/5.7) - any domain violation or bound
// overrun becomes {ok:false, error}.
function encodeBoardDeclaration(board) {
  try {
    const state = { nodes: 0, properties: 0 };
    const buffer = runDeclarationEncode(board, state);
    return { ok: true, buffer };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof BoardDigestError ? error.message : 'unable to encode board declaration',
    };
  }
}

// Top-level Section 5 entry point: R4 domain validation over the complete
// board, then Section 5.1-5.6 projection + encoding, then SHA-256 over the
// resulting byte stream. The 64-char lowercase hex digest is what travels in
// the `boardDigest` attestation field (Section 6). Exported for direct/test
// use, so this function enforces its own isDeeplyPlainData gate rather than
// merely documenting the precondition: validateDeclarationDomain walks the
// tree with Object.keys/property access, which can invoke a Proxy trap or a
// throwing getter, and does not itself check for non-enumerable properties
// the way isDeeplyPlainData does. validateBoard also runs isDeeplyPlainData
// first, so for that caller this is a defensive re-check, not new behavior.
function computeBoardDeclarationDigest(board) {
  // Root-type gate, run BEFORE isDeeplyPlainData: isDeeplyPlainData only
  // rejects non-plain composites, but for a non-object root its own walk
  // starts from an empty stack (the `typeof value !== 'object'` continue
  // fires once and the stack is then empty) and returns true - a primitive
  // root is not itself a "reachable node" that walk was ever built to check.
  // validateDeclarationDomain then accepts a finite number, string, or
  // boolean root outright (R4 only screens VALUE types, not root shape), so
  // both gates pass a primitive straight through to createDeclarationFrame,
  // whose non-array branch calls Object.keys(value) - and Object.keys on a
  // boxed primitive can silently alias a plain object's encoding: 0, true,
  // and '' all yield no own keys (colliding with {}), and a string like 'ab'
  // yields exactly the indexed keys a matching object literal would
  // ({0:'a',1:'b'}). No supported caller or documented API intends a
  // primitive board declaration, so reject the shape outright here, before
  // either existing gate gets a chance to wave it through.
  if (board === null || typeof board !== 'object' || Array.isArray(board)) {
    return { ok: false, error: 'board declaration must be a plain object' };
  }
  if (!isDeeplyPlainData(board)) {
    return { ok: false, error: 'board declaration must be plain data' };
  }
  const domain = validateDeclarationDomain(board);
  if (!domain.ok) return { ok: false, error: domain.error };
  const encoded = encodeBoardDeclaration(board);
  if (!encoded.ok) return { ok: false, error: encoded.error };
  const digest = crypto.createHash('sha256').update(encoded.buffer).digest('hex');
  return { ok: true, digest };
}

// Section 6 disposition matrix: both `agency.pipeline-opt-in.v1` and
// `agency.card-evidence.v1` apply this identically. `snapshot` must already be
// an authenticated, plain-data (R7-protected) snapshot - hasOwnProperty here
// only ever sees a truly absent field, never one hidden behind a non-enumerable
// descriptor, because isPlainDataAttestation rejects those attestations outright
// before a snapshot is ever taken. `declarationDigest` is the current board's
// digest, or null when computeBoardDeclarationDigest failed (an encoder failure
// is reported as its own board error separately; a null digest here just means
// nothing can ever match, so a present boardDigest field always fails).
//
// The returned `blockedByDigestFailure` flag is a caller convenience, not a
// distinct disposition: it is true only when the attestation side is fully
// well-formed (correct boardBindingKind, syntactically valid 64-hex
// boardDigest) and rejection happened solely because `declarationDigest` is
// null, i.e. the BOARD's own digest computation failed upstream - never
// because of anything wrong with the attestation itself. validateBoard already
// reports the digest-computation failure as its own specific board error, so a
// caller can use this flag to skip a second, generic "attestation required"
// message that would otherwise misleadingly suggest the attestation was
// missing or invalid when it was not. It never changes `accepted` and never
// suppresses rejection - only which redundant message a caller chooses to add.
function evaluateBoardBindingDisposition(snapshot, declarationDigest, boardBindingRequired) {
  const hasKind = Object.prototype.hasOwnProperty.call(snapshot, 'boardBindingKind');
  const hasDigest = Object.prototype.hasOwnProperty.call(snapshot, 'boardDigest');

  if (!hasKind && !hasDigest) {
    // Fully absent: Phase 1 (boardBindingRequired: false) warns and accepts;
    // Phase 2 rejects. The only row where phase changes the outcome.
    return boardBindingRequired
      ? { accepted: false, warnAbsent: false, blockedByDigestFailure: false }
      : { accepted: true, warnAbsent: true, blockedByDigestFailure: false };
  }
  // Partial binding (only one field present) is never valid, in either phase.
  if (!hasKind || !hasDigest) return { accepted: false, warnAbsent: false, blockedByDigestFailure: false };
  // A present-but-wrong boardBindingKind is wrong, not absent, regardless of
  // boardDigest's own state - malformed (non-string) and wrong-value both land
  // here identically.
  if (snapshot.boardBindingKind !== BOARD_BINDING_KIND) {
    return { accepted: false, warnAbsent: false, blockedByDigestFailure: false };
  }
  const boardDigestWellFormed = typeof snapshot.boardDigest === 'string' && /^[0-9a-f]{64}$/.test(snapshot.boardDigest);
  const digestValid = declarationDigest !== null && boardDigestWellFormed && snapshot.boardDigest === declarationDigest;
  return {
    accepted: digestValid,
    warnAbsent: false,
    blockedByDigestFailure: !digestValid && boardDigestWellFormed && declarationDigest === null,
  };
}

function boardBindingAbsentWarning(label) {
  return `F6 (issue #5): ${label} carries no board declaration binding (boardBindingKind/boardDigest absent); accepted only while boardBindingRequired is false.`;
}

// Authenticate a controller attestation and return the EXACT immutable snapshot
// the verifier approved. Every purpose predicate must read its bound fields from
// this returned snapshot, never from the original attestation object, so a
// getter or Proxy cannot present an authentic value to the verifier and then a
// different value on a later re-read. Returns null when the attestation is not
// an authenticated controller attestation of the requested kind.
function authenticatedControllerSnapshot(attestation, kind, verifier) {
  if (
    !attestation ||
    typeof attestation !== 'object' ||
    Array.isArray(attestation) ||
    typeof verifier !== 'function' ||
    !isPlainDataAttestation(attestation)
  ) {
    return null;
  }
  const snapshot = Object.freeze({ ...attestation });
  // This is the ATTESTATION INSTANCE's own schemaVersion (this one object's
  // shape version) and is intentionally pinned to 1, unlike the unrelated
  // contracts.attestations.schemaVersion policy field (now 2 - see
  // REQUIRED_ATTESTATIONS_FIXED above and the F6 doc's Section 6 naming note).
  // Two different fields share the name; do not bump this one when that one bumps.
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.kind !== kind ||
    typeof snapshot.attestationId !== 'string' ||
    !SAFE_IDENTIFIER.test(snapshot.attestationId) ||
    typeof snapshot.controllerId !== 'string' ||
    !SAFE_IDENTIFIER.test(snapshot.controllerId)
  ) {
    return null;
  }
  try {
    return verifier(snapshot, Object.freeze({ kind })) === true ? snapshot : null;
  } catch (_error) {
    return null;
  }
}

function isAuthenticatedControllerAttestation(attestation, kind, verifier) {
  return authenticatedControllerSnapshot(attestation, kind, verifier) !== null;
}

// A reserved starter name resolves to its pinned entry and to nothing else. A
// caller-supplied registry record for the same name is ignored entirely, so a
// forged registry.json or a forged registryRoles argument cannot redefine the
// provenance a starter attestation is checked against. Names outside the pin
// still resolve through the supplied registry, so this pins rather than
// blanket-denies. hasOwnProperty keeps a name like "constructor" or
// "toString" from resolving off the prototype chain.
function pinnedOrRegisteredRole(name, registeredByName) {
  if (Object.prototype.hasOwnProperty.call(REQUIRED_STARTER_ROLES, name)) {
    return REQUIRED_STARTER_ROLES[name];
  }
  return registeredByName.get(name);
}

// Returns the authenticated snapshot when the role attestation's shape and
// provenance bind `name` (and the registered record, when present); null
// otherwise. Every field is read from the snapshot, never the original object.
function trustedRoleAttestationSnapshot(attestation, name, registered, verifier) {
  const snapshot = authenticatedControllerSnapshot(attestation, ATTESTATION_KINDS.role, verifier);
  if (
    !snapshot ||
    snapshot.name !== name ||
    snapshot.repository !== AGENCY_REPOSITORY ||
    snapshot.upstreamCommit !== AGENCY_COMMIT ||
    typeof snapshot.sourcePath !== 'string' ||
    path.isAbsolute(snapshot.sourcePath) ||
    snapshot.sourcePath.includes('..') ||
    !/^[0-9a-f]{64}$/.test(snapshot.sourcePromptSha256 || '') ||
    !/^[0-9a-f]{64}$/.test(snapshot.tomlSha256 || '') ||
    (registered &&
      (snapshot.sourcePath !== registered.sourcePath ||
        snapshot.sourcePromptSha256 !== registered.promptSha256))
  ) {
    return null;
  }
  return snapshot;
}

function isTrustedRoleAttestationShape(attestation, name, registered, verifier) {
  return trustedRoleAttestationSnapshot(attestation, name, registered, verifier) !== null;
}

function isTrustedRoleAttestation(attestation, candidate, registered, verifier) {
  const snapshot = trustedRoleAttestationSnapshot(attestation, candidate.name, registered, verifier);
  return Boolean(snapshot && snapshot.tomlSha256 === candidate.tomlSha256);
}

// Opt-in, evidence, and accounting each read their bound fields from the
// authenticated controller snapshot. Opt-in and evidence additionally bind a
// digest of the exact board declaration (F6, Section 6) - the disposition of
// that binding (accept/warn/reject) is applied by the caller (validateBoard),
// via evaluateBoardBindingDisposition, once it has the board's own digest and
// the contract's boardBindingRequired phase; this only authenticates the
// pipeline/decisionId binding and returns the snapshot for that check.
function pipelineOptInSnapshot(attestation, pipelineId, verifier) {
  const snapshot = authenticatedControllerSnapshot(attestation, ATTESTATION_KINDS.optIn, verifier);
  if (
    !snapshot ||
    snapshot.pipelineId !== pipelineId ||
    typeof snapshot.decisionId !== 'string' ||
    !SAFE_IDENTIFIER.test(snapshot.decisionId)
  ) {
    return null;
  }
  return snapshot;
}

// Evidence attestations are authenticated once and indexed by their
// (pipelineId, cardId, evidenceId) tuple inside validateBoard (see the evidence
// index there), so a per-lookup predicate is not needed. The binding rules it
// enforces - exact pipeline/card/evidence id match, a valid evidence hash, and
// (F6) the board-declaration binding disposition - are applied when the index
// is built.

function isAccountingAttestation(attestation, pipelineId, verifier) {
  const snapshot = authenticatedControllerSnapshot(attestation, ATTESTATION_KINDS.accounting, verifier);
  return Boolean(
    snapshot &&
      snapshot.pipelineId === pipelineId &&
      /^[0-9a-f]{64}$/.test(snapshot.usageDigestSha256 || '') &&
      Number.isInteger(snapshot.usageRecordCount) &&
      snapshot.usageRecordCount >= 0
  );
}

function isExactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validateExactObject(actual, expected, label, errors) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    errors.push(`${label} is required`);
    return;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (!isExactArray(actualKeys, expectedKeys)) {
    errors.push(`${label} keys must be exactly ${expectedKeys.join(', ')}`);
  }
  for (const [name, value] of Object.entries(expected)) {
    if (actual[name] !== value) errors.push(`${label}.${name} must be ${String(value)}`);
  }
}

function validateContracts(contracts) {
  const errors = [];
  if (!contracts || contracts.schemaVersion !== 1) errors.push('contracts.schemaVersion must be 1');
  if (!contracts || !isExactArray(contracts.boardStatuses, REQUIRED_BOARD_STATUSES)) {
    errors.push(`contracts.boardStatuses must be exactly ${REQUIRED_BOARD_STATUSES.join(', ')}`);
  }
  if (!contracts || !isExactArray(contracts.activeStatuses, REQUIRED_ACTIVE_STATUSES)) {
    errors.push(`contracts.activeStatuses must be exactly ${REQUIRED_ACTIVE_STATUSES.join(', ')}`);
  }
  if (!contracts || !isExactArray(contracts.workerModes, REQUIRED_WORKER_MODES)) {
    errors.push(`contracts.workerModes must be exactly ${REQUIRED_WORKER_MODES.join(', ')}`);
  }
  if (!contracts || !contracts.limits) errors.push('contracts.limits is required');
  else {
    const actualLimitKeys = Object.keys(contracts.limits).sort();
    const expectedLimitKeys = Object.keys(REQUIRED_LIMITS).sort();
    if (!isExactArray(actualLimitKeys, expectedLimitKeys)) {
      errors.push(`contracts.limits keys must be exactly ${expectedLimitKeys.join(', ')}`);
    }
    for (const [name, expected] of Object.entries(REQUIRED_LIMITS)) {
      if (contracts.limits[name] !== expected) errors.push(`contracts.limits.${name} must be ${expected}`);
    }
  }
  validateExactObject(contracts && contracts.delegation, REQUIRED_DELEGATION, 'contracts.delegation', errors);
  validateExactObject(contracts && contracts.trust, REQUIRED_TRUST, 'contracts.trust', errors);
  // contracts.attestations cannot use validateExactObject wholesale: every key
  // except boardBindingRequired is a pinned constant, but boardBindingRequired
  // is the F6 two-phase rollout toggle (false in Phase 1, true in Phase 2) and
  // must be allowed to be either boolean value - only its TYPE is fixed.
  const attestations = contracts && contracts.attestations;
  if (!attestations || typeof attestations !== 'object' || Array.isArray(attestations)) {
    errors.push('contracts.attestations is required');
  } else {
    const actualAttestationKeys = Object.keys(attestations).sort();
    const expectedAttestationKeys = [...Object.keys(REQUIRED_ATTESTATIONS_FIXED), 'boardBindingRequired'].sort();
    if (!isExactArray(actualAttestationKeys, expectedAttestationKeys)) {
      errors.push(`contracts.attestations keys must be exactly ${expectedAttestationKeys.join(', ')}`);
    }
    for (const [name, expected] of Object.entries(REQUIRED_ATTESTATIONS_FIXED)) {
      if (attestations[name] !== expected) errors.push(`contracts.attestations.${name} must be ${String(expected)}`);
    }
    if (typeof attestations.boardBindingRequired !== 'boolean') {
      errors.push('contracts.attestations.boardBindingRequired must be a boolean');
    }
  }
  if (!contracts || !contracts.costCeiling || contracts.costCeiling.mode !== 'advisory') {
    errors.push('contracts.costCeiling.mode must be advisory');
  }
  if (
    !contracts ||
    !contracts.costCeiling ||
    contracts.costCeiling.hardEnforcementRequires !== 'verified-controller-accounting'
  ) {
    errors.push('contracts.costCeiling.hardEnforcementRequires must be verified-controller-accounting');
  }
  return errors;
}

function validatePolicy(registry, contracts) {
  const errors = [];
  if (!registry || registry.schemaVersion !== 1) errors.push('registry.schemaVersion must be 1');
  if (!registry || registry.enabledByDefault !== false) errors.push('registry.enabledByDefault must be false');
  if (!registry || !registry.upstream || !/^[0-9a-f]{40}$/.test(registry.upstream.commit || '')) {
    errors.push('registry.upstream.commit must be a 40-character Git SHA');
  }
  if (!registry || !registry.upstream || registry.upstream.repository !== AGENCY_REPOSITORY) {
    errors.push(`registry.upstream.repository must be ${AGENCY_REPOSITORY}`);
  }
  if (!registry || !registry.upstream || registry.upstream.commit !== AGENCY_COMMIT) {
    errors.push(`registry.upstream.commit must be ${AGENCY_COMMIT}`);
  }
  if (!registry || !registry.upstream || registry.upstream.license !== 'MIT') {
    errors.push('registry.upstream.license must be MIT');
  }
  if (!registry || !registry.discovery || registry.discovery.mode !== AGENCY_DISCOVERY_MODE) {
    errors.push(`registry.discovery.mode must be ${AGENCY_DISCOVERY_MODE}`);
  }
  if (!registry || !registry.discovery || registry.discovery.vendorPrompts !== false) {
    errors.push('registry.discovery.vendorPrompts must be false');
  }
  if (!registry || !registry.discovery || registry.discovery.globalMutation !== false) {
    errors.push('registry.discovery.globalMutation must be false');
  }
  if (!registry || !registry.discovery || registry.discovery.requiresControllerAttestation !== true) {
    errors.push('registry.discovery.requiresControllerAttestation must be true');
  }
  if (!registry || !registry.discovery || !Array.isArray(registry.discovery.trustedRoots)) {
    errors.push('registry.discovery.trustedRoots must be an array');
  } else if (
    registry.discovery.trustedRoots.length !== 2 ||
    registry.discovery.trustedRoots[0] !== 'workspace:.codex/agents' ||
    registry.discovery.trustedRoots[1] !== 'user:.codex/agents'
  ) {
    errors.push('registry.discovery.trustedRoots must be the workspace and user Codex agent directories');
  }
  for (const [name, expected] of Object.entries(REQUIRED_DISCOVERY_LIMITS)) {
    if (!registry || !registry.discovery || registry.discovery[name] !== expected) {
      errors.push(`registry.discovery.${name} must be ${expected}`);
    }
  }
  if (!registry || !Array.isArray(registry.roles)) {
    errors.push('registry.roles must be an array');
  } else {
    const names = new Set();
    for (const [index, role] of registry.roles.entries()) {
      if (!role || typeof role.name !== 'string' || !role.name) errors.push(`registry.roles[${index}].name is required`);
      else if (names.has(role.name)) errors.push(`registry contains duplicate role ${displayIdentifier(role.name)}`);
      else names.add(role.name);
      if (!role || !/^[0-9a-f]{64}$/.test(role.promptSha256 || '')) {
        errors.push(`registry.roles[${index}].promptSha256 must be SHA-256`);
      }
      if (!role || typeof role.sourcePath !== 'string' || path.isAbsolute(role.sourcePath) || role.sourcePath.includes('..')) {
        errors.push(`registry.roles[${index}].sourcePath must be a safe relative path`);
      }
    }
    for (const [name, expected] of Object.entries(REQUIRED_STARTER_ROLES)) {
      const role = registry.roles.find((candidate) => candidate && candidate.name === name);
      if (!role) errors.push(`registry starter role ${name} is required`);
      else {
        if (role.title !== expected.title) errors.push(`registry starter role ${name} title drifted`);
        if (role.division !== expected.division) errors.push(`registry starter role ${name} division drifted`);
        if (role.sourcePath !== expected.sourcePath) errors.push(`registry starter role ${name} sourcePath drifted`);
        if (role.promptSha256 !== expected.promptSha256) errors.push(`registry starter role ${name} promptSha256 drifted`);
        if (!isExactArray(role.capabilities, expected.capabilities)) {
          errors.push(`registry starter role ${name} capabilities drifted`);
        }
      }
    }
  }
  errors.push(...validateContracts(contracts));
  return errors;
}

function deriveTrustedBoardRoles(options) {
  const roleAttestations = Array.isArray(options.roleAttestations)
    ? options.roleAttestations.slice(0, MAX_ATTESTATIONS)
    : [];
  const registeredByName = new Map(
    Array.isArray(options.registryRoles)
      ? options.registryRoles
          .filter((role) => role && typeof role.name === 'string')
          .map((role) => [role.name, role])
      : []
  );
  const attested = new Set();
  for (const attestation of roleAttestations) {
    if (attested.size >= MAX_DISCOVERED_ROLES) break;
    // Gate on a non-Proxy/plain-data object BEFORE reading any field. A hostile
    // Proxy whose get trap throws on `.name` would otherwise crash this read;
    // rejecting it here fails closed (the role stays ineligible).
    if (!isPlainAttestationObject(attestation)) continue;
    const name = attestation.name;
    if (typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) continue;
    const registered = pinnedOrRegisteredRole(name, registeredByName);
    if (
      !isTrustedRoleAttestationShape(attestation, name, registered, options.controllerAttestationVerifier)
    ) {
      continue;
    }
    attested.add(name);
  }
  // The discovery-derived narrowing set is MANDATORY for eligibility. A role is
  // eligible only if it is BOTH backed by an authenticated role-provenance
  // attestation AND present in the caller-supplied verifiedRoles set (which
  // runAgencyDoctor computes from discoverCodexAgents, cross-checking each
  // attestation's tomlSha256 against a discovered candidate). Without that set,
  // no role is eligible - fail closed - so a stale attestation cannot keep
  // authorising a role after its installed TOML changed or was removed.
  if (!Array.isArray(options.verifiedRoles)) return new Set();
  const narrowing = new Set(options.verifiedRoles.slice(0, MAX_DISCOVERED_ROLES));
  return new Set([...attested].filter((name) => narrowing.has(name)));
}

function validateBoard(board, contracts, options = {}) {
  const errors = [];
  const warnings = [];
  const verifiedRoles = deriveTrustedBoardRoles(options);

  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return { enabled: false, errors: ['board must be an object'], warnings };
  }
  // Reject a hostile board SHAPE once, at the boundary, before any board, card,
  // or budget field is read. An accessor anywhere in the tree is a TOCTOU: it
  // could hand a passing value to this validation and a different value when the
  // host later reads the same live object. This also bounds a pathologically
  // deep or wide board (node and depth caps) so validation never throws.
  if (!isDeeplyPlainData(board)) {
    return {
      enabled: false,
      errors: [
        'board must be plain data: no accessor properties, exotic prototypes, inherited enumerable properties, or symbol keys, and within the depth and node bounds',
      ],
      warnings,
    };
  }
  const contractErrors = validateContracts(contracts);
  if (contractErrors.length > 0) {
    return {
      enabled: board.enabled === true,
      errors: contractErrors.map((error) => `board validation refused because policy is invalid: ${error}`),
      warnings,
    };
  }
  if (board.schemaVersion !== 1) errors.push('board.schemaVersion must be 1');
  if (board.enabled !== true && board.enabled !== false) errors.push('board.enabled must be boolean');
  const enabled = board.enabled === true;
  if (!enabled) return { enabled, errors, warnings };

  const limits = contracts.limits;
  const cards = Array.isArray(board.cards) ? board.cards : [];
  const cardsToValidate = cards.slice(0, limits.maxCards);
  const pipelineIdValid = typeof board.pipelineId === 'string' && SAFE_IDENTIFIER.test(board.pipelineId);
  if (!pipelineIdValid) errors.push('board.pipelineId must be a safe identifier of at most 128 characters');

  // F6 (docs/proposals/f6-board-declaration-binding.md): compute the board
  // declaration digest once, after the plain-data gate and before attestation
  // checks, and treat encoder failure as its own board validation error (5.7).
  // A failed digest means no boardDigest field can ever match it below.
  //
  // Known, accepted cost: this runs unconditionally for every enabled board,
  // including Phase 1 (boardBindingRequired: false) calls where no supplied
  // attestation carries boardBindingKind/boardDigest at all, so the digest is
  // never actually compared. Bounded by the same caps as the rest of the
  // encoder (not a DoS vector), just wasted CPU on that path. Skipping it
  // would require inspecting the raw, not-yet-authenticated opt-in/evidence
  // attestations for those two fields BEFORE authentication, which is exactly
  // the getter/Proxy TOCTOU shape isPlainDataAttestation/authenticatedControllerSnapshot
  // exist to close - not a safe shortcut in this file. Left as a documented
  // known cost rather than risk reintroducing that class of bug for a
  // CPU-only optimization.
  const boardBindingRequired = contracts.attestations.boardBindingRequired === true;
  const declarationDigestResult = computeBoardDeclarationDigest(board);
  if (!declarationDigestResult.ok) {
    errors.push(`board declaration cannot be digested for board-declaration binding: ${declarationDigestResult.error}`);
  }
  const declarationDigest = declarationDigestResult.ok ? declarationDigestResult.digest : null;

  const optInSnapshot = pipelineOptInSnapshot(
    options.optInAttestation,
    board.pipelineId,
    options.controllerAttestationVerifier
  );
  if (!optInSnapshot) {
    errors.push('trusted controller opt-in attestation is required for this pipeline');
  } else {
    const optInDisposition = evaluateBoardBindingDisposition(optInSnapshot, declarationDigest, boardBindingRequired);
    if (!optInDisposition.accepted) {
      // Skip the generic message when a syntactically valid, matching-shaped
      // opt-in was supplied and the ONLY reason it was rejected is that this
      // board's own digest computation failed upstream (declarationDigest ===
      // null): the specific "board declaration cannot be digested..." error
      // above already names the real cause, and the generic message here would
      // misleadingly suggest the opt-in itself was missing or invalid. The
      // board is still correctly rejected either way via that specific error.
      if (!optInDisposition.blockedByDigestFailure) {
        errors.push('trusted controller opt-in attestation is required for this pipeline');
      }
    } else if (optInDisposition.warnAbsent) {
      warnings.push(boardBindingAbsentWarning(`pipeline opt-in attestation for pipeline ${displayIdentifier(board.pipelineId)}`));
    }
  }
  if (!Array.isArray(board.cards)) errors.push('board.cards must be an array');
  if (!Number.isInteger(board.depth) || board.depth < 0) errors.push('board.depth must be a non-negative integer');
  else if (board.depth > limits.maxDepth) errors.push(`board depth ${board.depth} exceeds maximum ${limits.maxDepth}`);
  if (!Number.isInteger(board.correctionCycles) || board.correctionCycles < 0) {
    errors.push('board.correctionCycles must be a non-negative integer');
  } else if (board.correctionCycles > limits.maxCorrectionCycles) {
    errors.push(`board correction cycles ${board.correctionCycles} exceeds maximum ${limits.maxCorrectionCycles}`);
  }
  if (!Number.isInteger(board.pipelineMinutes) || board.pipelineMinutes < 0) {
    errors.push('board.pipelineMinutes must be a non-negative integer');
  } else if (board.pipelineMinutes > limits.maxPipelineMinutes) {
    errors.push(`board pipelineMinutes ${board.pipelineMinutes} exceeds maximum ${limits.maxPipelineMinutes}`);
  }
  if (cards.length > limits.maxCards) errors.push(`board has ${cards.length} cards; maximum ${limits.maxCards}`);

  const activeStatuses = new Set(contracts.activeStatuses);
  const allowedStatuses = new Set(contracts.boardStatuses);
  const workerModes = new Set(contracts.workerModes);
  const activeCards = cardsToValidate.filter((card) => card && activeStatuses.has(card.status));
  if (activeCards.length > limits.maxFanOut) {
    errors.push(`board has ${activeCards.length} active cards; fan-out maximum ${limits.maxFanOut}`);
  }
  const writers = cardsToValidate.filter((card) => card && card.mode === 'writer');
  if (writers.length !== 1) errors.push(`enabled board must have exactly one writer; found ${writers.length}`);
  const activeWriters = writers.filter((card) => activeStatuses.has(card.status));
  if (activeWriters.length > limits.maxActiveWriters) {
    errors.push(
      `board has ${activeWriters.length} active writer cards; active writer maximum ${limits.maxActiveWriters}`
    );
  }

  const idCounts = new Map();
  for (const card of cardsToValidate) {
    if (card && typeof card.id === 'string') idCounts.set(card.id, (idCounts.get(card.id) || 0) + 1);
  }
  for (const [id, count] of [...idCounts.entries()].sort()) {
    if (count > 1) errors.push(`duplicate card id: ${displayIdentifier(id)}`);
  }
  const cardsById = new Map(
    cardsToValidate.filter((card) => card && typeof card.id === 'string').map((card) => [card.id, card])
  );
  const cycle = findDependencyCycle(cardsById, MAX_DEPENDENCIES_PER_CARD);
  if (cycle) errors.push(`board dependency cycle: ${cycle.map(displayIdentifier).join(' -> ')}`);

  const evidenceAttestations = Array.isArray(options.evidenceAttestations)
    ? options.evidenceAttestations.slice(0, MAX_ATTESTATIONS)
    : [];
  if (Array.isArray(options.evidenceAttestations) && options.evidenceAttestations.length > MAX_ATTESTATIONS) {
    errors.push(`evidence attestations exceed maximum ${MAX_ATTESTATIONS}`);
  }
  // Authenticate each evidence attestation AT MOST ONCE, then index the
  // authenticated snapshots by their (pipelineId, cardId, evidenceId) tuple. The
  // verifiedDoneCards pass and the per-card evidence checks below then do O(1)
  // lookups instead of re-authenticating every attestation for every card and
  // evidence id. This preserves the exact accept/reject outcomes of the previous
  // nested every/some scan (a lookup matches iff an authenticated evidence
  // snapshot bound the same three ids and carried a valid evidence hash) while
  // dropping the verifier call count from cards x evidence x attestations to one
  // per attestation - closing the controller-verifier DoS. The number
  // authenticated is bounded by the MAX_ATTESTATIONS cap already applied above.
  const verifiedEvidenceIndex = new Map();
  for (const attestation of evidenceAttestations) {
    const snapshot = authenticatedControllerSnapshot(
      attestation,
      ATTESTATION_KINDS.evidence,
      options.controllerAttestationVerifier
    );
    if (!snapshot || !/^[0-9a-f]{64}$/.test(snapshot.evidenceSha256 || '')) continue;
    // F6: apply the same disposition matrix as the opt-in check (Section 6 -
    // "the evidence-index predicate applies the same binding-kind check as the
    // opt-in predicate"), so evidence with a correct digest but a missing or
    // wrong binding kind is never indexed. A fully-absent binding under Phase 1
    // still indexes (with a warning); every other non-accepted disposition is
    // simply not indexed, same as any other authentication failure above.
    const evidenceDisposition = evaluateBoardBindingDisposition(snapshot, declarationDigest, boardBindingRequired);
    if (!evidenceDisposition.accepted) continue;
    if (evidenceDisposition.warnAbsent) {
      warnings.push(
        boardBindingAbsentWarning(
          `card-evidence attestation ${displayIdentifier(snapshot.evidenceId || '')} for card ${displayIdentifier(snapshot.cardId || '')}`
        )
      );
    }
    let byCard = verifiedEvidenceIndex.get(snapshot.pipelineId);
    if (!byCard) {
      byCard = new Map();
      verifiedEvidenceIndex.set(snapshot.pipelineId, byCard);
    }
    let evidenceIds = byCard.get(snapshot.cardId);
    if (!evidenceIds) {
      evidenceIds = new Set();
      byCard.set(snapshot.cardId, evidenceIds);
    }
    evidenceIds.add(snapshot.evidenceId);
  }
  const hasVerifiedEvidence = (cardId, evidenceId) => {
    const byCard = verifiedEvidenceIndex.get(board.pipelineId);
    if (!byCard) return false;
    const evidenceIds = byCard.get(cardId);
    return Boolean(evidenceIds && evidenceIds.has(evidenceId));
  };

  const verifiedDoneCards = new Set();
  for (const card of cardsToValidate) {
    if (!card || card.status !== 'done' || !Array.isArray(card.evidence) || card.evidence.length === 0) continue;
    const evidence = card.evidence.slice(0, MAX_EVIDENCE_PER_CARD);
    const allVerified =
      card.evidence.length <= MAX_EVIDENCE_PER_CARD &&
      evidence.every((evidenceId) => hasVerifiedEvidence(card.id, evidenceId));
    if (allVerified) verifiedDoneCards.add(card.id);
  }

  cardsToValidate.forEach((card, index) => {
    const label = card && typeof card.id === 'string' ? `card ${displayIdentifier(card.id)}` : `card[${index}]`;
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      errors.push(`card[${index}] must be an object`);
      return;
    }
    if (typeof card.id !== 'string' || !SAFE_IDENTIFIER.test(card.id)) {
      errors.push(`card[${index}].id must be a safe identifier of at most ${MAX_IDENTIFIER_LENGTH} characters`);
    }
    if (!isSafeText(card.title, MAX_TITLE_LENGTH)) errors.push(`${label}.title is required and must be safe text`);
    if (!allowedStatuses.has(card.status)) errors.push(`${label}.status is not allowed`);
    if (!workerModes.has(card.mode)) errors.push(`${label}.mode is not allowed`);
    if (typeof card.role !== 'string' || !SAFE_IDENTIFIER.test(card.role)) {
      errors.push(`${label} role ${displayIdentifier(card.role)} is not a safe role identifier`);
    } else if (!verifiedRoles.has(card.role)) {
      errors.push(`${label} role ${card.role} is not verified as installed`);
    }
    if (card.canSpawn !== false) errors.push(`${label} cannot spawn workers`);
    if (!Number.isInteger(card.attempts) || card.attempts < 0) errors.push(`${label}.attempts must be a non-negative integer`);
    else if (card.attempts > limits.maxAttemptsPerCard) {
      errors.push(`${label} attempts ${card.attempts} exceeds maximum ${limits.maxAttemptsPerCard}`);
    }
    if (!isSafeText(card.stopCondition, MAX_STOP_CONDITION_LENGTH)) {
      errors.push(`${label}.stopCondition is required and must be safe text`);
    }

    if (card.status === 'done') {
      if (!Array.isArray(card.evidence) || card.evidence.length === 0) errors.push(`${label} is done but has no evidence`);
      else {
        if (card.evidence.length > MAX_EVIDENCE_PER_CARD) {
          errors.push(`${label} has ${card.evidence.length} evidence ids; maximum ${MAX_EVIDENCE_PER_CARD}`);
        }
        for (const evidenceId of card.evidence.slice(0, MAX_EVIDENCE_PER_CARD)) {
          if (typeof evidenceId !== 'string' || !SAFE_IDENTIFIER.test(evidenceId)) {
            errors.push(`${label} evidence ${displayIdentifier(evidenceId)} is not a safe identifier`);
            continue;
          }
          if (!hasVerifiedEvidence(card.id, evidenceId)) {
            errors.push(`${label} evidence ${evidenceId} is not controller-verified`);
          }
        }
      }
    }

    const dependencies = Array.isArray(card.dependencies)
      ? card.dependencies.slice(0, MAX_DEPENDENCIES_PER_CARD)
      : [];
    if (!Array.isArray(card.dependencies)) errors.push(`${label}.dependencies must be an array`);
    else if (card.dependencies.length > MAX_DEPENDENCIES_PER_CARD) {
      errors.push(`${label} has ${card.dependencies.length} dependencies; maximum ${MAX_DEPENDENCIES_PER_CARD}`);
    }
    for (const dependencyId of dependencies) {
      if (typeof dependencyId !== 'string' || !SAFE_IDENTIFIER.test(dependencyId)) {
        errors.push(`${label} dependency ${displayIdentifier(dependencyId)} is not a safe identifier`);
        continue;
      }
      const dependency = cardsById.get(dependencyId);
      if (!dependency) errors.push(`${label} dependency ${dependencyId} does not exist`);
      else if (
        (activeStatuses.has(card.status) || card.status === 'done') &&
        !verifiedDoneCards.has(dependencyId)
      ) {
        errors.push(
          `${label} cannot be ${card.status} until dependency ${dependencyId} has controller-verified done evidence`
        );
      }
    }

    const budget = card.budget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
      errors.push(`${label}.budget is required`);
      return;
    }
    validateBudget(label, budget, 'turns', limits.maxTurnsPerCard, errors);
    validateBudget(label, budget, 'toolCalls', limits.maxToolCallsPerCard, errors);
    validateBudget(label, budget, 'workerMinutes', limits.maxWorkerMinutes, errors);
    validateBudget(label, budget, 'inputTokens', limits.maxInputTokensPerCard, errors);
    validateBudget(label, budget, 'outputTokens', limits.maxOutputTokensPerCard, errors);
    validateBudget(label, budget, 'handoffTokens', limits.maxHandoffTokens, errors);
  });

  if (!isAccountingAttestation(
    options.controllerAccountingAttestation,
    board.pipelineId,
    options.controllerAttestationVerifier
  )) {
    warnings.push('Cost ceiling is advisory until verified controller accounting is available.');
  }
  return { enabled, errors, warnings };
}

function isSafeText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !UNSAFE_DISPLAY_CHARACTERS.test(value);
}

function validateBudget(label, budget, field, maximum, errors) {
  const value = budget[field];
  if (!Number.isInteger(value) || value < 0) errors.push(`${label}.budget.${field} must be a non-negative integer`);
  else if (value > maximum) errors.push(`${label}.budget.${field} ${value} exceeds maximum ${maximum}`);
}

function findDependencyCycle(cardsById, maximumDependencies) {
  const state = new Map();
  const stack = [];

  function visit(id) {
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    state.set(id, 'visiting');
    stack.push(id);
    const card = cardsById.get(id);
    const dependencies =
      card && Array.isArray(card.dependencies)
        ? card.dependencies
            .slice(0, maximumDependencies)
            .filter((dependency) => typeof dependency === 'string')
            .sort()
        : [];
    for (const dependencyId of dependencies) {
      if (!cardsById.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  }

  for (const id of [...cardsById.keys()].sort()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

function defaultAgentDirs(workspaceRoot) {
  return [path.join(workspaceRoot, '.codex', 'agents'), path.join(os.homedir(), '.codex', 'agents')];
}

function safeOutput(lines) {
  let output = `${lines.map((line) => escapeTerminalLine(line)).join('\n')}\n`;
  if (Buffer.byteLength(output, 'utf8') > MAX_DOCTOR_OUTPUT_BYTES) {
    output = `${Buffer.from(output, 'utf8').subarray(0, MAX_DOCTOR_OUTPUT_BYTES - 64).toString('utf8')}\n... output truncated ...\n`;
  }
  return output;
}

function escapeTerminalLine(line) {
  return String(line).replace(UNSAFE_DISPLAY_CHARACTERS_GLOBAL, (character) => {
    if (character === '\n') return '\\n';
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

function summarizeNames(names) {
  if (names.length === 0) return '(none)';
  const shown = names.slice(0, MAX_PRINTED_ROLES).map(displayIdentifier).join(', ');
  return names.length > MAX_PRINTED_ROLES ? `${shown}, ... (${names.length - MAX_PRINTED_ROLES} more)` : shown;
}

function policyLoadFailure(error, print) {
  const output = safeOutput([
    'jarvis-cc agency-doctor',
    'agency orchestration: DISABLED (policy unavailable)',
    'policy: FAIL',
    `  ERROR: unable to load Agency policy: ${displayValue(error.message, 240)}`,
  ]);
  if (print !== false) process.stdout.write(output);
  return {
    exitCode: 1,
    output,
    candidates: [],
    roles: [],
    policyErrors: ['unable to load Agency policy'],
    boardErrors: [],
    boardWarnings: [],
  };
}

function runAgencyDoctor(options = {}) {
  const pluginRoot = options.pluginRoot || path.resolve(__dirname, '..', '..');
  let registry;
  let contracts;
  try {
    registry = loadRegistry(pluginRoot);
    contracts = loadContracts(pluginRoot);
  } catch (error) {
    return policyLoadFailure(error, options.print);
  }

  const workspaceRoot = options.workspaceRoot || process.cwd();
  const permittedAgentDirs = defaultAgentDirs(workspaceRoot).map((dir) => path.resolve(dir));
  const agentDirs = options.agentDirs || permittedAgentDirs;
  const policyErrors = validatePolicy(registry, contracts);
  let candidates = [];
  let roles = [];
  let discoveryError = null;
  try {
    if (Array.isArray(options.agentDirs)) {
      for (const dir of options.agentDirs) {
        if (typeof dir !== 'string') throw new Error('Agent directory must be a string path');
        const resolved = path.resolve(dir);
        if (!permittedAgentDirs.includes(resolved)) {
          throw new Error(`Agent directory is outside the declared trusted roots: ${displayValue(resolved, 240)}`);
        }
      }
    }
    candidates = discoverCodexAgentCandidates(agentDirs);
    roles = discoverCodexAgents(agentDirs, {
      registry,
      attestations: options.roleAttestations || [],
      controllerAttestationVerifier: options.controllerAttestationVerifier,
    });
  } catch (error) {
    discoveryError = error.message;
  }

  // The report lines must never throw on a malformed registry: validatePolicy
  // has already turned every such defect into a policy error that drives the
  // exit code below. These derivations are display-only defaults so a registry
  // missing `upstream`, `roles`, or the whole object still prints a FAIL report
  // instead of crashing with an uncaught TypeError.
  const enabledByDefault = Boolean(registry && registry.enabledByDefault === true);
  const upstream = registry && typeof registry.upstream === 'object' && registry.upstream ? registry.upstream : {};
  const upstreamRepository = typeof upstream.repository === 'string' ? upstream.repository : '(unknown)';
  const upstreamCommit = typeof upstream.commit === 'string' ? upstream.commit : '(unknown)';
  const registryRoles = registry && Array.isArray(registry.roles) ? registry.roles : [];

  const lines = [
    'jarvis-cc agency-doctor',
    `agency orchestration: ${enabledByDefault ? 'ENABLED' : 'DISABLED by default (explicit opt-in required)'}`,
    `policy: ${policyErrors.length === 0 ? 'PASS' : 'FAIL'}`,
    `source: ${upstreamRepository}@${upstreamCommit}`,
    `discovered Codex roles (unverified candidates): ${summarizeNames(candidates.map((candidate) => candidate.name))}`,
    `verified Agency roles: ${summarizeNames(roles)}`,
  ];
  for (const error of policyErrors) lines.push(`  ERROR: ${error}`);
  if (discoveryError) lines.push(`role discovery: FAIL`, `  ERROR: ${displayValue(discoveryError, 240)}`);

  let boardErrors = [];
  let boardWarnings = [];
  if (options.boardPath) {
    try {
      const boardRoot = options.boardRoot || workspaceRoot;
      // The board root itself must equal or be contained by the workspace root,
      // per the contract's boardPathsRestrictedToWorkspace. A board root pointed
      // at a sibling or parent of the workspace is refused before any file is
      // read, so a board outside the workspace can never validate as a pass.
      const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
      const resolvedBoardRoot = path.resolve(boardRoot);
      if (
        resolvedBoardRoot !== resolvedWorkspaceRoot &&
        !isPathInside(resolvedWorkspaceRoot, resolvedBoardRoot)
      ) {
        throw new Error(`Board root is outside the workspace root: ${displayValue(resolvedBoardRoot, 240)}`);
      }
      const boardPath = resolveContainedFile(options.boardPath, boardRoot);
      const board = readJsonFile(boardPath, { allowedRoot: boardRoot });
      const result = validateBoard(board, contracts, {
        verifiedRoles: roles,
        roleAttestations: options.roleAttestations || [],
        registryRoles,
        optInAttestation: options.optInAttestation,
        evidenceAttestations: options.evidenceAttestations,
        controllerAccountingAttestation: options.controllerAccountingAttestation,
        controllerAttestationVerifier: options.controllerAttestationVerifier,
      });
      boardErrors = result.errors;
      boardWarnings = result.warnings;
      lines.push(`board: ${boardErrors.length === 0 ? 'PASS' : 'FAIL'} (${displayValue(boardPath, 240)})`);
      for (const error of boardErrors) lines.push(`  ERROR: ${error}`);
      for (const warning of boardWarnings) lines.push(`  WARN: ${warning}`);
    } catch (error) {
      boardErrors = [error.message];
      lines.push('board: FAIL');
      lines.push(`  ERROR: ${displayValue(error.message, 240)}`);
    }
  } else {
    lines.push('board: not supplied (policy-only validation; no opt-in or dispatch)');
  }

  const exitCode = policyErrors.length === 0 && !discoveryError && boardErrors.length === 0 ? 0 : 1;
  const output = safeOutput(lines);
  if (options.print !== false) process.stdout.write(output);
  return {
    exitCode,
    output,
    candidates: candidates.map((candidate) => candidate.name),
    roles,
    policyErrors,
    boardErrors,
    boardWarnings,
  };
}

module.exports = {
  BOARD_BINDING_KIND,
  computeBoardDeclarationDigest,
  discoverCodexAgentCandidates,
  discoverCodexAgents,
  escapeTerminalLine,
  loadContracts,
  loadRegistry,
  readJsonFile,
  resolveContainedFile,
  runAgencyDoctor,
  safeErrorMessage,
  validateBoard,
  validatePolicy,
};
