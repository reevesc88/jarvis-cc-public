#!/usr/bin/env node
/**
 * PreToolUse Hook: jarvis-cc Fact-Forcing Gate
 *
 * Standalone, jarvis-cc-owned implementation of path-based file first-touch
 * and exact-command Bash retry reminders inspired by ECC's GateGuard
 * (scripts/hooks/gateguard-fact-force.js in the ecc plugin marketplace).
 * Written independently so this protection keeps working even if the ECC
 * plugin is ever removed or disabled.
 *
 * BEHAVIOR CONTRACT (inferred from reading ECC's real, active hook):
 *   - The FIRST Edit/Write/MultiEdit of a given exact file_path this session
 *     is denied, with a message asking the agent to state facts (importers,
 *     affected API/schema, the user's instruction) before retrying.
 *   - The FIRST attempt of a given exact destructive Bash command string
 *     this session is denied, with a message asking for an impact list and
 *     rollback plan before retrying.
 *   - Later file operations with the same exact file_path are not denied by this hook;
 *     tool type, content and replacement strings are not compared.
 *   - Destructive Bash retries require the identical command string.
 *     The first denied attempt marks that path or command as checked.
 *     This reminder does not authenticate approvals or verify stated facts.
 *   - Routine (non-destructive) Bash commands are never gated by this hook.
 *   - State persists per-session on disk so the gate does not reset between
 *     tool calls in the same session, but does reset for a new session.
 *
 * DIFFERENCES FROM ECC's gateguard-fact-force.js (deliberate, not
 * oversights):
 *   - This is a smaller, single-file implementation. ECC's version has a
 *     much more thorough destructive-command classifier (quote-aware
 *     re-tokenization, subshell/brace-group recursion, per-flag git
 *     subcommand parsing, an operator-extensible regex, a denial-count
 *     "condensed message" dampening mode, path exemption globs, etc). This
 *     file intentionally implements a smaller, "reasonable" destructive
 *     command list per the task brief, not a byte-for-byte port of that
 *     machinery.
 *   - Separate state directory (see STATE_DIR below) so the two hooks never
 *     collide or share session state, even if both are active at once.
 *   - No read-only-git-introspection allowlist, no once-per-session
 *     "routine bash" gate, no ECC_GATEGUARD env var (this hook is not part
 *     of ECC) — a JARVIS_GATEGUARD=off escape hatch is provided instead,
 *     named for this project.
 *
 * STATE
 * -----
 * Per-session JSON file at:
 *   os.homedir() + "/.jarvis-cc/gateguard/state-<sessionId>.json"
 * shaped as { checked: string[], lastActive: <epoch ms> }.
 *
 * "checked" holds:
 *   - exact file_path strings (Edit/Write/MultiEdit first-touch keys)
 *   - "cmd:<sha256 of exact command string>" (destructive Bash first-touch
 *     keys)
 *
 * sessionId is derived the same general way ECC's hook does: prefer an
 * explicit session id carried on the hook payload or in env. Without a
 * stable identity, the hook abstains without recording state.
 *
 * I/O CONTRACT
 * ------------
 * Reads the PreToolUse hook JSON payload from stdin. Writes hook output
 * JSON to stdout:
 *   deny:  {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *           "permissionDecision":"deny","permissionDecisionReason":"..."}}
 *   abstain: {} (normal host permission checks continue)
 * Errors also abstain so this reminder does not replace host permissions.
 *
 * MANUAL TEST:
 *   echo '{"session_id":"manual-example","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | node fact-forcing-gate.js
 *   echo '{"session_id":"manual-example","hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"C:\\ai\\foo.js"}}' | node fact-forcing-gate.js
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.jarvis-cc', 'gateguard');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity -> state expires
const MAX_CHECKED_ENTRIES = 500;


// --- destructive Bash command detection -----------------------------------
//
// Deliberately conservative: false negatives (missing an unusual destructive
// invocation) are acceptable, false positives (blocking an everyday command)
// are not. Each check below looks for a well-known, high-confidence
// destructive shape rather than trying to parse a full shell grammar.

const SQL_DESTRUCTIVE_RE = /\b(drop\s+table|delete\s+from|truncate\s+table)\b/i;

/**
 * Split a command line into segments at unquoted `;`, `|`, `&`, `&&`, `||`,
 * and newlines. Quoted spans are collapsed first so a separator character
 * inside a string literal is not treated as a real segment break.
 * @param {string} command
 * @returns {string[]}
 */
function splitSegments(command) {
  let noQuotes = String(command || '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return noQuotes
    .split(/[\r\n]+|&&|\|\||[;|&]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Tokenize a segment by whitespace (quotes already collapsed by the caller
 * context in most call sites; safe to call standalone too since we only
 * care about flag/word shapes, not literal quoted content).
 * @param {string} segment
 * @returns {string[]}
 */
function tokenize(segment) {
  return String(segment || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Normalize a command token to its bare executable name: strips a leading
 * path and a trailing .exe, lowercases.
 * @param {string} token
 * @returns {string}
 */
function baseCommand(token) {
  if (!token) return '';
  return token.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
}

/**
 * `rm -rf` / `rm -fr` / `rm -r -f` / `rm --recursive --force` in any
 * combined or split flag form.
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructiveRm(tokens) {
  if (baseCommand(tokens[0]) !== 'rm') return false;
  let hasR = false;
  let hasF = false;
  for (const t of tokens.slice(1)) {
    if (t === '--recursive') hasR = true;
    else if (t === '--force') hasF = true;
    else if (/^-[a-zA-Z]+$/.test(t)) {
      if (/r/i.test(t.slice(1))) hasR = true;
      if (/f/.test(t.slice(1))) hasF = true;
    }
  }
  return hasR && hasF;
}

/**
 * `git reset --hard`, `git push --force` (but not `--force-with-lease`),
 * `git checkout -- <path>` / `git checkout .`, `git clean -f...`.
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructiveGit(tokens) {
  if (baseCommand(tokens[0]) !== 'git') return false;
  // Skip global options like `-C <path>` before the subcommand.
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '-c') i += 2;
    else i += 1;
  }
  const sub = (tokens[i] || '').toLowerCase();
  const rest = tokens.slice(i + 1);

  if (sub === 'reset') return rest.includes('--hard');

  if (sub === 'push') {
    const hasLease = rest.some(t => t === '--force-with-lease' || t.startsWith('--force-with-lease='));
    const hasForce = rest.some(t => t === '--force' || t === '-f' || t === '--force=true');
    return hasForce && !hasLease;
  }

  if (sub === 'checkout') {
    return rest.some(t => t === '--' || t === '.' || t === '--force' || t === '-f');
  }

  if (sub === 'clean') {
    return rest.some(t => t === '--force' || (/^-[a-zA-Z]+$/.test(t) && t.slice(1).includes('f')));
  }

  return false;
}

/**
 * `find ... -exec rm ...` (and rmdir / unlink) — the exec'd command runs
 * regardless of the surrounding find flags, so this checks the exec target
 * only.
 * @param {string} segment
 * @returns {boolean}
 */
function isDestructiveFindExec(segment) {
  return /\bfind\b[\s\S]*-exec\s+(?:[\w./\\-]*[\\/])?(rm|rmdir|unlink)(\.exe)?\b/i.test(segment);
}

/**
 * Windows `del /f /s /q ...` / `erase /f /s /q ...` and `rd /s /q ...` /
 * `rmdir /s /q ...` — flags may appear in any order, so this checks flag
 * presence rather than a fixed sequence.
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructiveWindowsDel(tokens) {
  const cmd = baseCommand(tokens[0]);
  const flags = tokens.slice(1).map(t => t.toLowerCase());
  if (cmd === 'del' || cmd === 'erase') {
    return flags.includes('/f') && flags.includes('/s');
  }
  if (cmd === 'rd' || cmd === 'rmdir') {
    return flags.includes('/s');
  }
  return false;
}

/**
 * PowerShell `Remove-Item -Recurse -Force ...` (and its `ri`/`rm`/`rd`/`del`
 * aliases) — flag order/case is not significant in PowerShell.
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructivePowerShellRemove(tokens) {
  const cmd = baseCommand(tokens[0]);
  if (!['remove-item', 'ri', 'rd', 'rmdir'].includes(cmd)) return false;
  const flags = tokens.slice(1).map(t => t.toLowerCase());
  const hasRecurse = flags.some(f => f === '-recurse' || f.startsWith('-recurse:'));
  const hasForce = flags.some(f => f === '-force' || f.startsWith('-force:'));
  return hasRecurse && hasForce;
}

// Recognize common SQL CLI argument forms only. This is not a shell parser:
// substitutions, wrappers and indirect SQL inputs remain outside this reminder.
function hasDestructiveSqlArgument(command) {
  const segments = command.match(/(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^;|&\r\n])+/g) || [];
  for (const segment of segments) {
    const tokens = segment.match(/(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^\s'"])+/g) || [];
    const client = baseCommand(tokens[0]);
    const flag = client === 'psql' ? ['-c', '--command'] : ['mysql', 'mariadb'].includes(client) ? ['-e', '--execute'] : null;
    if (!flag) continue;
    for (let i = 1; i < tokens.length; i++) {
      let sql;
      if (flag.includes(tokens[i])) sql = tokens[++i];
      else if (tokens[i].startsWith(flag[1] + '=')) sql = tokens[i].slice(flag[1].length + 1);
      if (sql && SQL_DESTRUCTIVE_RE.test(sql)) return true;
    }
  }
  return false;
}

/**
 * Decide whether a raw Bash/PowerShell command line contains a destructive
 * action this gate should challenge on first attempt.
 * @param {string} command
 * @returns {boolean}
 */
function isDestructiveCommand(command) {
  const raw = String(command || '');
  if (!raw.trim()) return false;

  const flattenedForSql = raw
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (SQL_DESTRUCTIVE_RE.test(flattenedForSql) || hasDestructiveSqlArgument(raw)) return true;

  for (const segment of splitSegments(raw)) {
    if (isDestructiveFindExec(segment)) return true;
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
    if (isDestructiveWindowsDel(tokens)) return true;
    if (isDestructivePowerShellRemove(tokens)) return true;
  }

  return false;
}

// --- session key / state file resolution -----------------------------------

/**
 * Sanitize an arbitrary session id candidate into a filesystem-safe key.
 * Falls back to a short hash if the raw value is unusably long or empty
 * after stripping unsafe characters.
 * @param {string} value
 * @returns {string}
 */
function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized && sanitized.length <= 80) return sanitized;
  return 'sid-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

/**
 * Resolve a stable session key for this invocation: prefer an explicit
 * session id from the hook payload or environment (mirrors the kinds of
 * fields ECC's own gate checks — session_id/sessionId on the payload,
 * common env vars). Without a stable identity, the gate fails open.
 * @param {object} data
 * @returns {string}
 */
function resolveSessionKey(data) {
  const candidates = [
    data && data.session_id,
    data && data.sessionId,
    data && data.session && data.session.id,
    process.env.CLAUDE_SESSION_ID,
    process.env.JARVIS_SESSION_ID
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeSessionKey(candidate);
    if (sanitized) return sanitized;
  }
  return '';
}

function getStateFile(sessionKey) {
  return path.join(STATE_DIR, `state-${sessionKey}.json`);
}

function loadState(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const lastActive = typeof state.lastActive === 'number' ? state.lastActive : 0;
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        return { checked: [], lastActive: Date.now() };
      }
      return { checked: Array.isArray(state.checked) ? state.checked : [], lastActive };
    }
  } catch (_) {
    /* ignore malformed/unreadable state; start fresh */
  }
  return { checked: [], lastActive: Date.now() };
}

/**
 * Persist state atomically (write to a temp file, then rename), merging
 * with whatever is currently on disk so a concurrent writer's entries are
 * not lost. Never throws; returns false on failure so callers can fail open
 * instead of denying forever.
 * @param {string} stateFile
 * @param {{checked: string[]}} state
 * @returns {boolean}
 */
function saveState(stateFile, state) {
  let tmpFile = null;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });

    let merged = Array.isArray(state.checked) ? state.checked.slice() : [];
    try {
      if (fs.existsSync(stateFile)) {
        const onDisk = loadState(stateFile);
        if (Array.isArray(onDisk.checked)) {
          merged = Array.from(new Set([...onDisk.checked, ...merged]));
        }
      }
    } catch (_) {
      /* ignore corrupt on-disk state, proceed with in-memory version */
    }
    if (merged.length > MAX_CHECKED_ENTRIES) {
      merged = merged.slice(merged.length - MAX_CHECKED_ENTRIES);
    }

    const finalState = { checked: merged, lastActive: Date.now() };
    tmpFile = `${stateFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpFile, JSON.stringify(finalState, null, 2), 'utf8');
    fs.renameSync(tmpFile, stateFile);
    tmpFile = null;
    return true;
  } catch (_) {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
    return false;
  }
}

function isChecked(stateFile, key) {
  const state = loadState(stateFile);
  const checked = state.checked.includes(key);
  if (checked) saveState(stateFile, state); // checked activity also renews the inactivity timer
  return checked;
}

/**
 * Mark a key as checked (first-touch recorded). Returns whether the write
 * succeeded so the caller can fail open (allow) rather than deny forever if
 * persistence is broken.
 * @param {string} stateFile
 * @param {string} key
 * @returns {boolean}
 */
function markChecked(stateFile, key) {
  const state = loadState(stateFile);
  if (!state.checked.includes(key)) {
    state.checked.push(key);
  }
  return saveState(stateFile, state);
}

// --- gate messages -----------------------------------------------------

function sanitizeForMessage(value) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .trim()
    .slice(0, 500);
}

function fileGateMessage(action, filePath) {
  const safe = sanitizeForMessage(filePath);
  return [
    '[jarvis-cc Fact-Forcing Gate]',
    '',
    `Before ${action === 'edit' ? 'editing' : 'creating'} ${safe}, present these facts:`,
    '',
    '1. List the files that import/require/reference this file (search the tree).',
    '2. List the public functions/classes/exports affected by this change.',
    '3. If this file reads/writes data, describe the schema (redacted/synthetic values only).',
    "4. Quote the user's current instruction verbatim.",
    '',
    'Present the facts, then continue the authorized work on this file.',
    'This is a first-touch reminder keyed only by file_path; later content is not compared.',
    'It does not grant permission for a changed task or verify your explanation.',
    '',
    '(Set JARVIS_GATEGUARD=off to disable this gate for authorized repair work.)'
  ].join('\n');
}

function bashGateMessage(command) {
  const safe = sanitizeForMessage(command);
  return [
    '[jarvis-cc Fact-Forcing Gate]',
    '',
    `Destructive command detected: ${safe}`,
    '',
    'Before running it, present these facts:',
    '',
    '1. List all files/data this command will modify or delete.',
    '2. Write a one-line rollback procedure.',
    "3. Quote the user's current instruction verbatim.",
    '',
    'Present the facts, then retry the exact same command string.',
    '',
    '(Set JARVIS_GATEGUARD=off to disable this gate for authorized repair work.)'
  ].join('\n');
}

// --- output helpers -----------------------------------------------------

function emitDeny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
}

function emitAbstain() {
  // No permission decision: the host must apply its normal approval policy.
  process.stdout.write(JSON.stringify({}));
}

function readStdinSync() {
  if (process.stdin && process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function isGateDisabled() {
  const raw = String(process.env.JARVIS_GATEGUARD || '').trim().toLowerCase();
  return raw === 'off' || raw === '0' || raw === 'false' || raw === 'disabled';
}

// --- core logic ----------------------------------------------------------

function run(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : (rawInput || {});
  } catch (_) {
    return emitAbstain(); // malformed input: fail open
  }

  if (isGateDisabled()) {
    return emitAbstain();
  }

  const sessionKey = resolveSessionKey(data);
  if (!sessionKey) return emitAbstain(); // process-local identities cannot support retries
  const stateFile = getStateFile(sessionKey);

  const toolInput = data.tool_input || {};
  const rawToolName = String(data.tool_name || '');
  const TOOL_MAP = { edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', bash: 'Bash' };
  const toolName = TOOL_MAP[rawToolName.toLowerCase()] || rawToolName;

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';
    if (!filePath) return emitAbstain();

    if (isChecked(stateFile, filePath)) return emitAbstain();

    const ok = markChecked(stateFile, filePath);
    if (!ok) return emitAbstain(); // fail open if state cannot be persisted

    return emitDeny(fileGateMessage(toolName === 'Edit' ? 'edit' : 'create', filePath));
  }

  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    for (const edit of edits) {
      const filePath = edit && edit.file_path;
      if (!filePath) continue;
      if (isChecked(stateFile, filePath)) continue;

      const ok = markChecked(stateFile, filePath);
      if (!ok) return emitAbstain();

      return emitDeny(fileGateMessage('edit', filePath));
    }
    return emitAbstain();
  }

  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (!isDestructiveCommand(command)) return emitAbstain();

    const key = 'cmd:' + crypto.createHash('sha256').update(command).digest('hex');
    if (isChecked(stateFile, key)) return emitAbstain();

    const ok = markChecked(stateFile, key);
    if (!ok) return emitAbstain();

    return emitDeny(bashGateMessage(command));
  }

  return emitAbstain();
}

function main() {
  try {
    const raw = readStdinSync();
    run(raw);
  } catch (_) {
    // Last-resort guard: never let a bug in this hook block a tool call.
    try { emitAbstain(); } catch (_) { /* ignore */ }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  run,
  isDestructiveCommand,
  resolveSessionKey,
  sanitizeSessionKey
};
