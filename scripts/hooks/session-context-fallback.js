#!/usr/bin/env node
'use strict';
// Historical path and hook ID retained. No home-directory inspection or writes.
const fs = require('fs');
const STARTER_CONTEXT = 'JARVIS starter toolkit is available. Follow the current user and project instructions; this guidance grants no permissions and replaces no personal configuration. Explain unfamiliar terms, inspect before editing, preserve existing work, and report what you actually verified. Use only available host capabilities. Memory is optional and requires consent and a user-chosen location. Do not initialize, publish, push, or merge repositories without current user authorization; this plugin grants none. For a first task, offer to explain a project using read-only tools.';
function main() {
  let input;
  try {
    const raw = process.argv[2] || (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8'));
    input = JSON.parse(raw);
  } catch { return { continue: true }; }
  if (!input || input.hook_event_name !== 'SessionStart') return { continue: true };
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: STARTER_CONTEXT } };
}
if (require.main === module) process.stdout.write(JSON.stringify(main()));
module.exports = { STARTER_CONTEXT, main };
