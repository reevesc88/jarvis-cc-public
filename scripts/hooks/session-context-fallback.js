#!/usr/bin/env node
'use strict';
// Historical path and hook ID retained. No home-directory inspection or writes.
const STARTER_CONTEXT = 'JARVIS starter toolkit is available. Follow the current user and project instructions; this guidance grants no permissions and replaces no personal configuration. Explain unfamiliar terms, inspect before editing, preserve existing work, and report what you actually verified. Use only available host capabilities. Memory is optional and requires consent and a user-chosen location. Do not initialize, publish, push, or merge repositories without current user authorization; this plugin grants none. For a first task, offer to explain a project using read-only tools.';

// Decide from a raw payload string. Empty, invalid or non-SessionStart input abstains.
function main(raw) {
  let input;
  try {
    input = JSON.parse(raw === undefined ? (process.argv[2] || '') : raw);
  } catch { return { continue: true }; }
  if (!input || input.hook_event_name !== 'SessionStart') return { continue: true };
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: STARTER_CONTEXT } };
}

// Stream-based read, as in fact-forcing-gate.js: Node may put pipe fd 0 in
// nonblocking mode, and a synchronous read can lose the payload to EAGAIN.
async function readStdin() {
  if (!process.stdin || process.stdin.isTTY) return '';
  try {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input;
  } catch (_) {
    return '';
  }
}

async function run() {
  let result;
  try {
    result = main(process.argv[2] || await readStdin());
  } catch (_) {
    result = { continue: true };
  }
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) run();
module.exports = { STARTER_CONTEXT, main, readStdin };
