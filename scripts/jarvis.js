#!/usr/bin/env node
'use strict';

/**
 * jarvis-cc maintenance CLI.
 *
 * Node built-ins only (fs, path, os, crypto, child_process) - no external
 * dependencies. Install Node separately and keep it available on PATH.
 *
 * Subcommands (dispatched on argv[2]):
 *   list-installed  - report every file jarvis-cc manages: live vs bundled,
 *                      byte-identical or diverged.
 *   doctor          - read-only diagnostics, pass/fail report, exit 0/1.
 *   repair          - preview optional missing neutral exports; --apply writes them.
 *   memory-doctor   - focused memory-system checks + wiki-link ([[slug]])
 *                      resolution across ~/.claude/memory/*.md.
 *   agency-doctor   - read-only validation of the opt-in Agency registry,
 *                      board contract, and local TOML role candidates.
 *
 * This file never touches ~/.claude/settings.json, under any subcommand.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { runAgencyDoctor, escapeTerminalLine, safeErrorMessage } = require('./lib/agency-orchestration');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const HOME_CLAUDE = path.join(os.homedir(), '.claude');
const SETTINGS_JSON_PATH = path.join(HOME_CLAUDE, 'settings.json');

// ---------------------------------------------------------------------------
// Manifest: every file jarvis-cc manages, bundled copy -> live restore target
// ---------------------------------------------------------------------------

// Required release inventory is independent of disk discovery: a missing file must not vanish.
// Update these lists deliberately when adding/removing shipped agents or skills.
const EXPECTED_AGENT_FILES = [
  'architect.md', 'build-error-resolver.md', 'code-reviewer.md', 'database-reviewer.md',
  'doc-updater.md', 'e2e-runner.md', 'executor.md', 'explorer.md', 'memory-agent.md',
  'performance-optimizer.md', 'react-reviewer.md', 'refactor-cleaner.md',
  'security-reviewer.md', 'silent-failure-hunter.md', 'tdd-guide.md', 'typescript-reviewer.md',
];
const EXPECTED_SKILL_DIRS = [
  'agency-orchestration', 'api-design', 'architecture-decision-records', 'backend-patterns',
  'benchmark', 'codebase-onboarding', 'database-migrations', 'deployment-patterns',
  'docker-patterns', 'e2e-testing', 'error-handling', 'frontend-patterns', 'github-ops',
  'mcp-server-patterns', 'production-audit', 'react-performance', 'search-first',
  'security-review', 'strategic-compact', 'tdd-workflow', 'verification-loop', 'workspace-surface-audit',
];
const AGENT_FILES = [...new Set([...EXPECTED_AGENT_FILES, ...listMdFilesDirect(path.join(PLUGIN_ROOT, 'agents'))])].sort();

// jarvis-cc's own bundled rules/common files, mirrored to ~/.claude/rules/common/
const RULE_FILES = [
  'agents.md',
  'code-review.md',
  'coding-style.md',
  'development-workflow.md',
  'git-workflow.md',
  'hooks.md',
  'patterns.md',
  'performance.md',
  'platform-configs.md',
  'security.md',
  'testing.md',
];

function buildManifest() {
  const entries = [];

  entries.push({
    category: 'core',
    label: 'CLAUDE.md',
    bundled: path.join(PLUGIN_ROOT, 'CLAUDE.md'),
    live: path.join(HOME_CLAUDE, 'CLAUDE.md'),
  });

  for (const f of EXPECTED_AGENT_FILES) {
    entries.push({
      category: 'agent',
      label: path.join('agents', f),
      bundled: path.join(PLUGIN_ROOT, 'agents', f),
      live: path.join(HOME_CLAUDE, 'agents', f),
    });
  }

  for (const f of RULE_FILES) {
    entries.push({
      category: 'rule',
      label: path.join('rules', 'common', f),
      bundled: path.join(PLUGIN_ROOT, 'rules', 'common', f),
      live: path.join(HOME_CLAUDE, 'rules', 'common', f),
    });
  }


  return entries;
}

// ---------------------------------------------------------------------------
// Small fs helpers
// ---------------------------------------------------------------------------

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function filesByteIdentical(a, b) {
  try {
    const bufA = fs.readFileSync(a);
    const bufB = fs.readFileSync(b);
    return Buffer.compare(bufA, bufB) === 0;
  } catch (e) {
    return false;
  }
}

function listMdFilesDirect(dir) {
  // *.md files directly under dir (non-recursive), sorted.
  if (!dirExists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
    .map((d) => d.name)
    .sort();
}

function mkdirpFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// ---------------------------------------------------------------------------
// Status computation for the manifest (shared by list-installed / doctor)
// ---------------------------------------------------------------------------

function statusOf(entry) {
  const bundledExists = fileExists(entry.bundled);
  const liveExists = fileExists(entry.live);
  let match = 'N/A';
  if (!bundledExists) {
    match = 'MISSING-BUNDLED';
  } else if (bundledExists && liveExists) {
    match = filesByteIdentical(entry.bundled, entry.live) ? 'MATCH' : 'DIVERGED';
  } else if (!liveExists) {
    match = 'NOT-EXPORTED';
  }
  return { bundledExists, liveExists, match };
}

// ---------------------------------------------------------------------------
// list-installed
// ---------------------------------------------------------------------------

function reportUnmanagedAgents() {
  for (const file of AGENT_FILES.filter(file => !EXPECTED_AGENT_FILES.includes(file))) {
    console.log('[UNMANAGED] bundled agents/' + escapeTerminalLine(file) + ' (not exported by repair)');
  }
}

function cmdListInstalled() {
  reportUnmanagedAgents();
  const manifest = buildManifest();
  console.log('jarvis-cc optional Claude-home exports (absence is normal)');
  console.log('plugin root: ' + PLUGIN_ROOT);
  console.log('live root:   ' + HOME_CLAUDE);
  console.log('');

  const rows = manifest.map((entry) => {
    const s = statusOf(entry);
    return {
      category: entry.category,
      label: entry.label,
      liveExists: s.liveExists ? 'yes' : 'no',
      status: s.match,
    };
  });

  const colCategory = Math.max(8, ...rows.map((r) => r.category.length));
  const colLabel = Math.max(5, ...rows.map((r) => r.label.length));
  const colLive = 4;

  const header =
    pad('CATEGORY', colCategory) + '  ' + pad('PATH', colLabel) + '  ' + pad('LIVE', colLive) + '  STATUS';
  console.log(header);
  console.log('-'.repeat(header.length));

  let matchCount = 0;
  let divergedCount = 0;
  let missingLiveCount = 0;
  let missingBundledCount = 0;

  for (const r of rows) {
    console.log(
      pad(r.category, colCategory) + '  ' + pad(r.label, colLabel) + '  ' + pad(r.liveExists, colLive) + '  ' + r.status
    );
    if (r.status === 'MATCH') matchCount++;
    else if (r.status === 'DIVERGED') divergedCount++;
    else if (r.status === 'NOT-EXPORTED') missingLiveCount++;
    else if (r.status === 'MISSING-BUNDLED') missingBundledCount++;
  }

  console.log('');
  console.log(
    `Summary: ${rows.length} tracked, ${matchCount} match, ${divergedCount} diverged, ` +
      `${missingLiveCount} not-exported, ${missingBundledCount} missing-bundled.`
  );

  return 0;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ---------------------------------------------------------------------------
// Memory-system checks (shared by doctor and memory-doctor)
// ---------------------------------------------------------------------------

function checkMemoryCollision() {
  const rootMemoryMd = path.join(HOME_CLAUDE, 'MEMORY.md');
  const subMemoryMd = path.join(HOME_CLAUDE, 'memory', 'MEMORY.md');
  const rootExists = fileExists(rootMemoryMd);
  const subExists = fileExists(subMemoryMd);
  return { rootMemoryMd, subMemoryMd, rootExists, subExists, collision: rootExists && subExists };
}

function extractMarkdownLinkTargets(text, indexPath) {
  // Resolve local Markdown targets against the index, preserving directories.
  const targets = new Set();
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].trim();
    if (target.startsWith('<') && target.includes('>')) target = target.slice(1, target.indexOf('>'));
    else target = target.split(/\s/)[0];
    target = target.split(/[?#]/)[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
    try { target = decodeURIComponent(target); } catch (_) { continue; }
    if (target.toLowerCase().endsWith('.md')) {
      targets.add(path.resolve(path.dirname(indexPath), target));
    }
  }
  return targets;
}

function findOrphanedMemoryFiles() {
  const memoryDir = path.join(HOME_CLAUDE, 'memory');
  const indexPath = path.join(memoryDir, 'MEMORY.md');
  const mdFiles = listMdFilesDirect(memoryDir).filter((f) => f !== 'MEMORY.md');

  if (!fileExists(indexPath)) {
    // No index to check links against - everything is unverifiable, report
    // as-is rather than silently passing.
    return { indexExists: false, orphaned: mdFiles, checked: 0 };
  }

  const indexText = fs.readFileSync(indexPath, 'utf8');
  const linked = extractMarkdownLinkTargets(indexText, indexPath);
  const orphaned = mdFiles.filter((f) => !linked.has(path.resolve(memoryDir, f)));
  return { indexExists: true, orphaned, checked: mdFiles.length };
}

function extractWikiLinkSlugs(text) {
  const slugs = [];
  const re = /\[\[([^\]|#]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    slugs.push(m[1].trim());
  }
  return slugs;
}

function findBrokenWikiLinks() {
  const memoryDir = path.join(HOME_CLAUDE, 'memory');
  const mdFiles = listMdFilesDirect(memoryDir);
  const broken = [];
  const unreadable = [];
  let totalLinks = 0;

  for (const f of mdFiles) {
    const full = path.join(memoryDir, f);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      unreadable.push({ file: f, error: displayError(e) });
      continue;
    }
    const slugs = extractWikiLinkSlugs(text);
    for (const slug of slugs) {
      totalLinks++;
      if (!mdFiles.includes(slug + '.md')) {
        broken.push({ from: f, slug, expected: path.join('memory', slug + '.md') });
      }
    }
  }

  return { filesScanned: mdFiles.length - unreadable.length, totalLinks, broken, unreadable };
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

function cmdDoctor() {
  reportUnmanagedAgents();
  console.log('jarvis-cc doctor: bundled resources (home exports are optional)');
  let problems = 0;
  const skillsDir = path.join(PLUGIN_ROOT, 'skills');
  const discoveredSkills = dirExists(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  const skillDirs = [...new Set([...EXPECTED_SKILL_DIRS, ...discoveredSkills])].sort();
  if (discoveredSkills.length === 0) { console.log('[FAIL] bundled skills/ is missing or empty'); problems++; }
  const required = [...skillDirs.map(d => path.join(skillsDir, d, 'SKILL.md')), ...buildManifest().map(e => e.bundled),
    ...['commands/agency-doctor.md', 'commands/dashboard.md', 'commands/doctor.md',
      'commands/list-installed.md', 'commands/memory-doctor.md', 'commands/repair.md',
      'scripts/jarvis.js', 'scripts/lib/agency-orchestration.js', 'scripts/dashboard/jarvis_dashboard.py', 'integrations/agency-agents/contracts.json', 'integrations/agency-agents/registry.json',
      '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json',
      'scripts/hooks/fact-forcing-gate.js', 'scripts/hooks/session-context-fallback.js'].map(p => path.join(PLUGIN_ROOT, p))];
  if (AGENT_FILES.length === 0) { console.log('[FAIL] bundled agents/ is missing or empty'); problems++; }
  for (const p of required) {
    if (!fileExists(p) || fs.statSync(p).size === 0) { console.log('[FAIL] missing/empty bundled ' + path.relative(PLUGIN_ROOT, p)); problems++; }
    else {
      try { fs.readFileSync(p); } catch (error) {
        console.log('[FAIL] unreadable bundled ' + path.relative(PLUGIN_ROOT, p) + ': ' + displayError(error));
        problems++;
      }
    }
  }
  try {
    const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json')));
    const market = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin/marketplace.json')));
    const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
    if (plugin.name !== 'jarvis-cc' || typeof plugin.version !== 'string' || !versionPattern.test(plugin.version)
      || market.name !== 'jarvis-cc' || !Array.isArray(market.plugins) || market.plugins.length !== 1
      || market.plugins[0]?.name !== plugin.name || market.plugins[0]?.source !== './'
      || market.plugins[0]?.version !== plugin.version) throw Error('inconsistent plugin manifests');
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks/hooks.json')));
    const objectWithKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    if (!objectWithKeys(hooks, ['hooks'])) throw Error('unsupported hook manifest property');
    if (!objectWithKeys(hooks.hooks, ['SessionStart', 'PreToolUse'])) throw Error('unsupported hook events');
    for (const [event, script, id] of [
      ['SessionStart', 'session-context-fallback.js', 'session-start:jarvis-cc:context-fallback'],
      ['PreToolUse', 'fact-forcing-gate.js', 'pre:jarvis-cc:fact-forcing-gate'],
    ]) {
      const command = 'node "' + String.fromCharCode(36) + '{CLAUDE_PLUGIN_ROOT}/scripts/hooks/' + script + '"';
      const groups = hooks.hooks[event];
      const group = Array.isArray(groups) && groups.length === 1 ? groups[0] : null;
      const keys = event === 'PreToolUse' ? ['hooks', 'description', 'id', 'matcher'] : ['hooks', 'description', 'id'];
      if (!objectWithKeys(group, keys) || typeof group.description !== 'string' || group.id !== id
        || (event === 'PreToolUse' && group.matcher !== 'Bash|Edit|Write|MultiEdit')
        || !Array.isArray(group.hooks) || group.hooks.length !== 1
        || !objectWithKeys(group.hooks[0], ['type', 'command'])
        || group.hooks[0].type !== 'command' || group.hooks[0].command !== command) {
        throw Error('missing/invalid ' + event + ' registration');
      }
    }
  } catch (error) { console.log('[FAIL] ' + displayError(error)); problems++; }
  console.log(problems ? 'doctor: FAIL (' + problems + ' problems)' : 'doctor: PASS (bundle valid; host loading is a separate check)');
  return problems ? 1 : 0;
}
function report(ok, label) { console.log('[' + (ok ? 'OK' : 'FAIL') + '] ' + label); }

// Validate existing path components, including home; reject detected links/junctions.
// This optional local-user export assumes user-owned ancestors are not concurrently replaced.
// Path rechecks are not hostile-concurrent-filesystem containment.
function inspectTarget(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let st;
    try { st = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (st.isSymbolicLink()) throw Error('unsafe link or junction: ' + current);
    if (i < parts.length - 1 && !st.isDirectory()) throw Error('unsafe ancestor: ' + current);
    if (i === parts.length - 1 && !st.isFile()) throw Error('target is not a regular file: ' + current);
  }
}

// Publish a complete file without ever overwriting a concurrently created target.
// Hard links must be supported; no unsafe rename/copy-to-final fallback is used.
function publishMissing(source, target) {
  const temporary = path.join(path.dirname(target), '.jarvis-export-' + randomUUID() + '.tmp');
  let ownsTemporary = false;
  try {
    // Reserve our random path first so cleanup never removes somebody else's file.
    const reserved = fs.openSync(temporary, 'wx');
    ownsTemporary = true;
    fs.closeSync(reserved);
    fs.copyFileSync(source, temporary);
    // The owned neutral export is user-readable/writable even when its source is 0444.
    // Do not change source permissions; apply before publication, never to a final target.
    fs.chmodSync(temporary, 0o600);
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    inspectTarget(target);
    try { fs.linkSync(temporary, target); } catch (error) {
      throw new Error('Safe no-clobber publication failed; no fallback used: ' + safeErrorMessage(error));
    }
  } finally {
    if (ownsTemporary) {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (error.code !== 'ENOENT') console.log('[WARN] temporary export file left behind: ' + displayError(error));
      }
    }
  }
}

function displayError(error) {
  return escapeTerminalLine(safeErrorMessage(error).slice(0, 240));
}

function cmdRepair(apply) {
  console.log('jarvis-cc repair: ' + (apply ? 'APPLY missing neutral exports' : 'PREVIEW only; use repair --apply to export'));
  console.log('Optional Claude-home exports; not required for plugin installation. Existing files and settings remain unchanged.');
  const pending = [];
  let errors = 0;
  for (const entry of buildManifest()) {
    try {
      if (!fileExists(entry.bundled)) throw Error('missing bundled source: ' + entry.label);
      if (fs.readFileSync(entry.bundled).length === 0) throw Error('empty bundled source: ' + entry.label);
      inspectTarget(entry.live);
      if (fileExists(entry.live)) { console.log('[KEEP] ' + entry.label); continue; }
      pending.push(entry);
      console.log('[MISSING] ' + entry.label);
    } catch (error) { console.log('[ERROR] ' + displayError(error)); errors++; }
  }
  // Preflight all targets before any writes. Never partially apply a known-unsafe plan.
  if (errors || !apply) return errors ? 1 : 0;
  for (const entry of pending) {
    try {
      inspectTarget(entry.live);
      fs.mkdirSync(path.dirname(entry.live), { recursive: true });
      inspectTarget(entry.live);
      publishMissing(entry.bundled, entry.live);
      console.log('[EXPORTED] ' + entry.label);
    } catch (error) { console.log('[ERROR] ' + entry.label + ': ' + displayError(error)); errors++; }
  }
  return errors ? 1 : 0;
}

// ---------------------------------------------------------------------------
// memory-doctor
// ---------------------------------------------------------------------------

function cmdMemoryDoctor() {
  if (!fileExists(path.join(HOME_CLAUDE, 'MEMORY.md')) && listMdFilesDirect(path.join(HOME_CLAUDE, 'memory')).length === 0) {
    console.log('memory-doctor: not configured (optional; no files created)');
    return 0;
  }
  let problems = 0;
  console.log('jarvis-cc memory-doctor');
  console.log('live root: ' + HOME_CLAUDE);
  console.log('');

  // (e) naming collision
  const collision = checkMemoryCollision();
  if (collision.collision) {
    problems++;
    console.log(`[FLAG] naming collision: two different files both named MEMORY.md exist:`);
    console.log(`      ${collision.rootMemoryMd}`);
    console.log(`      ${collision.subMemoryMd}`);
    console.log(`      These are DIFFERENT files at different directory levels - needs your own review.`);
  } else {
    report(true, `no ~/.claude/MEMORY.md vs ~/.claude/memory/MEMORY.md naming collision`);
    if (!collision.rootExists) console.log(`      note: ${collision.rootMemoryMd} does not exist`);
    if (!collision.subExists) console.log(`      note: ${collision.subMemoryMd} does not exist`);
  }

  console.log('');

  // (f) orphaned memory files
  const orphan = findOrphanedMemoryFiles();
  if (!orphan.indexExists) {
    problems++;
    console.log(`[FAIL] ~/.claude/memory/MEMORY.md does not exist - cannot check for orphaned files`);
  } else if (orphan.orphaned.length > 0) {
    problems++;
    console.log(
      `[FLAG] ${orphan.orphaned.length} of ${orphan.checked} memory/*.md file(s) are NOT linked from memory/MEMORY.md:`
    );
    for (const f of orphan.orphaned) console.log(`      orphaned: memory/${escapeTerminalLine(f)}`);
  } else {
    report(true, `all ${orphan.checked} memory/*.md file(s) are linked from memory/MEMORY.md`);
  }

  console.log('');

  // wiki-link ([[slug]]) cross-reference check
  const wiki = findBrokenWikiLinks();
  console.log(`Scanned ${wiki.filesScanned} file(s) under memory/, found ${wiki.totalLinks} [[wiki-link]] reference(s).`);
  if (wiki.unreadable.length > 0) {
    problems++;
    for (const item of wiki.unreadable) console.log(`[FAIL] unreadable memory/${escapeTerminalLine(item.file)}: ${item.error}`);
  }
  if (wiki.broken.length > 0) {
    problems++;
    console.log(`[FLAG] ${wiki.broken.length} broken [[wiki-link]] reference(s):`);
    for (const b of wiki.broken) {
      console.log(`      memory/${escapeTerminalLine(b.from)} -> [[${escapeTerminalLine(b.slug)}]]  (expected ${escapeTerminalLine(b.expected)}, not found)`);
    }
  } else if (wiki.unreadable.length === 0) {
    report(true, `all [[wiki-link]] references resolve to an actual file`);
  }

  console.log('');
  if (problems === 0) {
    console.log('memory-doctor: PASS (no problems found)');
  } else {
    console.log(`memory-doctor: FAIL (${problems} problem area${problems === 1 ? '' : 's'} found)`);
  }

  return problems === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function usage() {
  console.log('Usage: node jarvis.js <list-installed|doctor|repair|memory-doctor|agency-doctor> [board.json | --apply]');
}

function main() {
  const sub = process.argv[2];
  const args = process.argv.slice(3);
  const valid = sub === 'repair' ? (args.length === 0 || (args.length === 1 && args[0] === '--apply'))
    : sub === 'agency-doctor' ? (args.length <= 1 && !args[0]?.startsWith('-')) : args.length === 0;
  if (!valid) { console.error('Invalid arguments. repair accepts only --apply; agency-doctor accepts one board path.'); return 1; }
  switch (sub) {
    case 'list-installed':
      return cmdListInstalled();
    case 'doctor':
      return cmdDoctor();
    case 'repair':
      return cmdRepair(args[0] === '--apply');
    case 'memory-doctor':
      return cmdMemoryDoctor();
    case 'agency-doctor':
      // runAgencyDoctor is designed to fail closed with an exit code, never to
      // throw. This is a defense-in-depth backstop: if any future path throws,
      // print a bounded FAIL line and exit 1 rather than dumping a stack trace.
      try {
        return runAgencyDoctor({ pluginRoot: PLUGIN_ROOT, boardPath: process.argv[3] }).exitCode;
      } catch (error) {
        const reason = safeErrorMessage(error);
        console.log('jarvis-cc agency-doctor');
        console.log('policy: FAIL');
        console.log(`  ERROR: agency-doctor failed: ${escapeTerminalLine(reason.slice(0, 240))}`);
        return 1;
      }
    default:
      usage();
      return sub ? 1 : 0;
  }
}

try { process.exitCode = main(); } catch (error) { console.error('[ERROR] ' + displayError(error)); process.exitCode = 1; }
