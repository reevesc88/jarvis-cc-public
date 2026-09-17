'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-starter-'));
  const home = path.join(temp, 'home'); fs.mkdirSync(home);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return { temp, home, env, run(args, repo = root, extra = {}) {
    return spawnSync(process.execPath, [path.join(repo, 'scripts/jarvis.js'), ...args], { env, encoding: 'utf8', ...extra });
  } };
}
function put(home, rel, data = '') { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; }
function bundle(temp) { const repo = path.join(temp, 'bundle'); fs.cpSync(root, repo, { recursive: true, filter: p => !p.split(path.sep).includes('.git') }); return repo; }
function snapshot(dir) { const entries = {}; for (const name of fs.readdirSync(dir)) { const p = path.join(dir, name); const st = fs.lstatSync(p); entries[name] = st.isDirectory() ? snapshot(p) : st.isSymbolicLink() ? fs.readlinkSync(p) : fs.readFileSync(p).toString('base64'); } return entries; }

test('startup is neutral and read-only with empty and partially configured homes', t => {
  const f = fixture(t);
  for (const partial of [false, true]) {
    if (partial) { put(f.home, '.claude/CLAUDE.md', 'My existing instructions'); put(f.home, '.claude/settings.json', '{}'); }
    const before = snapshot(f.home);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/hooks/session-context-fallback.js')], { env: f.env, input: JSON.stringify({ hook_event_name: 'SessionStart' }), encoding: 'utf8' });
    assert.equal(result.status, 0); const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /current user/); assert.doesNotMatch(text, /Calum|wiped|missing|conductor-brain/); assert.deepEqual(snapshot(f.home), before);
  }
  for (const input of ['{}', '{bad', JSON.stringify({ hook_event_name: 'Stop' })]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/hooks/session-context-fallback.js')], { env: f.env, input, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(result.stdout), { continue: true });
  }
});
test('doctor passes on empty home and memory is optional', t => { const f=fixture(t); assert.equal(f.run(['doctor']).status,0); const m=f.run(['memory-doctor']); assert.equal(m.status,0);assert.match(m.stdout,/not configured/); assert.deepEqual(snapshot(f.home),{}); });
test('doctor fails precisely for missing required bundle and missing skills', t => {
  const f=fixture(t);const repo=bundle(f.temp);fs.unlinkSync(path.join(repo,'rules/common/security.md'));let r=f.run(['doctor'],repo);assert.equal(r.status,1);assert.match(r.stdout,/security.md/);
  fs.rmSync(path.join(repo,'skills'),{recursive:true});r=f.run(['doctor'],repo);assert.equal(r.status,1);assert.match(r.stdout,/skills.*is missing/);
});
test('preview writes nothing; apply is missing-only and idempotent including empty files', t => {
  const f=fixture(t);put(f.home,'.claude/CLAUDE.md','');put(f.home,'.claude/agents/executor.md','custom agent');const settings=put(f.home,'.claude/settings.json','{"user":"settings"}');
  const before=snapshot(f.home);assert.equal(f.run(['repair']).status,0);assert.deepEqual(snapshot(f.home),before);
  assert.equal(f.run(['repair','--apply']).status,0);assert.equal(fs.readFileSync(path.join(f.home,'.claude/CLAUDE.md'),'utf8'),'');assert.equal(fs.readFileSync(path.join(f.home,'.claude/agents/executor.md'),'utf8'),'custom agent');assert.equal(fs.readFileSync(settings,'utf8'),'{"user":"settings"}');
  assert.equal(fs.existsSync(path.join(f.home,'.claude/hooks')),false);const after=snapshot(f.home);assert.equal(f.run(['repair','--apply']).status,0);assert.deepEqual(snapshot(f.home),after);
});
test('directory targets and unsafe ancestor files fail before writes', t => {
  for(const kind of ['directory','ancestor']) { const f=fixture(t);if(kind==='directory')fs.mkdirSync(path.join(f.home,'.claude/CLAUDE.md'),{recursive:true});else put(f.home,'.claude','not a directory');const before=snapshot(f.home);const r=f.run(['repair','--apply']);assert.equal(r.status,1);assert.match(r.stdout,/not a regular file|unsafe ancestor/);assert.deepEqual(snapshot(f.home),before); }
});
test('symlink or junction ancestors are refused, preserving outside files', t => {
  const f=fixture(t);const outside=path.join(f.temp,'outside');fs.mkdirSync(outside);put(outside,'keep','unchanged');fs.symlinkSync(outside,path.join(f.home,'.claude'),process.platform==='win32'?'junction':'dir');const before=snapshot(outside);const r=f.run(['repair','--apply']);assert.equal(r.status,1);assert.match(r.stdout,/unsafe link or junction/);assert.deepEqual(snapshot(outside),before);
});
test('copy failure returns nonzero and existing settings are untouched', t => {
  const f=fixture(t);const settings=put(f.home,'.claude/settings.json','unchanged');const preload=put(f.temp,'fail-copy.cjs',"require('fs').copyFileSync = () => { const e = new Error('simulated denied copy'); e.code = 'EACCES'; throw e; };");
  const r=spawnSync(process.execPath,['--require',preload,path.join(root,'scripts/jarvis.js'),'repair','--apply'],{env:f.env,encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stdout,/simulated denied copy/);assert.equal(fs.readFileSync(settings,'utf8'),'unchanged');
});
test('unknown CLI flags never enable repair', t => {const f=fixture(t);for(const args of [['repair','--yes'],['repair','--apply','oops'],['doctor','--apply'],['agency-doctor','--unknown']])assert.equal(f.run(args).status,1);assert.deepEqual(snapshot(f.home),{});});
test('active distributed guidance has no personal policy markers or model pins', () => {
  const dirs=['agents','rules','skills'];const files=[path.join(root,'CLAUDE.md')];function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory())walk(f);else if(d.name.endsWith('.md'))files.push(f);}}for(const d of dirs)walk(path.join(root,d));
  for(const f of files)assert.doesNotMatch(fs.readFileSync(f,'utf8'),/Calum|calumai|conductor-brain|Gospel Rule|claude-sonnet-5|claude-opus-4-8|calum-selfhost/,'personal marker in '+f);
  for(const p of fs.readdirSync(path.join(root,'agents')))assert.match(fs.readFileSync(path.join(root,'agents',p),'utf8'),/^model: inherit$/m);
  assert.equal(fs.existsSync(path.join(root,'scripts/hooks-backup/session-greeting.js')),false);
});

test('doctor requires every command and its shipped executable resources', t => {
  const f = fixture(t); const repo = bundle(f.temp);
  for (const rel of ['commands/agency-doctor.md', 'commands/dashboard.md', 'commands/doctor.md', 'commands/list-installed.md', 'commands/memory-doctor.md', 'commands/repair.md', 'scripts/dashboard/jarvis_dashboard.py', 'integrations/agency-agents/contracts.json', 'integrations/agency-agents/registry.json', 'scripts/hooks/fact-forcing-gate.js', 'scripts/hooks/session-context-fallback.js']) {
    const p = path.join(repo, rel); const original = fs.readFileSync(p);
    fs.unlinkSync(p); let result = f.run(['doctor'], repo);
    assert.equal(result.status, 1, rel + ' missing'); assert.ok(result.stdout.includes(path.basename(rel)));
    fs.writeFileSync(p, ''); result = f.run(['doctor'], repo);
    assert.equal(result.status, 1, rel + ' empty'); fs.writeFileSync(p, original);
  }
  fs.rmSync(path.join(repo, 'commands'), { recursive: true });
  assert.equal(f.run(['doctor'], repo).status, 1);
});
test('list-installed prioritizes a missing bundled source over absent optional export', t => {
  const f = fixture(t); const repo = bundle(f.temp); fs.unlinkSync(path.join(repo, 'rules/common/security.md'));
  const result = f.run(['list-installed'], repo);
  const line = result.stdout.split('\n').find(line => line.includes('security.md'));
  assert.match(line, /MISSING-BUNDLED/);
});
test('partial copy never publishes a final file, cleans temporary files, and retry succeeds', t => {
  const f = fixture(t);
  const preload = put(f.temp, 'partial-copy.cjs', "const fs = require('fs'); fs.copyFileSync = (source, target) => { fs.writeFileSync(target, 'partial'); throw new Error('simulated full disk'); }; ");
  const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/jarvis.js'), 'repair', '--apply'], {env:f.env, encoding:'utf8'});
  assert.equal(result.status, 1); assert.match(result.stdout, /simulated full disk/);
  assert.equal(fs.existsSync(path.join(f.home, '.claude/CLAUDE.md')), false);
  const files = snapshot(f.home); assert.doesNotMatch(JSON.stringify(files), /jarvis-export|partial/);
  assert.equal(f.run(['repair', '--apply']).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.home, '.claude/CLAUDE.md')), fs.readFileSync(path.join(root, 'CLAUDE.md')));
});
test('competing final file survives publication and unsupported hard links fail closed', t => {
  for (const mode of ['competing', 'unsupported']) {
    const f = fixture(t);
    const preload = put(f.temp, 'link-failure.cjs', "const fs = require('fs'); const link = fs.linkSync; fs.linkSync = (source, target) => { " + (mode === 'competing' ? "fs.writeFileSync(target, 'concurrent user file', {flag:'wx'}); return link(source,target);" : "throw new Error('hard links unavailable');") + " }; ");
    const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/jarvis.js'), 'repair', '--apply'], {env:f.env, encoding:'utf8'});
    assert.equal(result.status, 1);
    const target = path.join(f.home, '.claude/CLAUDE.md');
    if (mode === 'competing') assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent user file');
    else assert.equal(fs.existsSync(target), false);
    assert.doesNotMatch(JSON.stringify(snapshot(f.home)), /jarvis-export/);
  }
});

test('doctor rejects inconsistent metadata and malformed hook registrations', t => {
  const f = fixture(t); const repo = bundle(f.temp);
  const cases = [
    ['.claude-plugin/marketplace.json', json => { json.plugins[0].version = '0.0.0'; }, /inconsistent plugin manifests/],
    ['hooks/hooks.json', json => { json.extra = true; }, /unsupported hook manifest property/],
    ['hooks/hooks.json', json => { json.hooks.SessionStart[0].hooks[0].command = 'wrong'; }, /invalid SessionStart registration/],
    ['hooks/hooks.json', json => { json.hooks.PreToolUse[0].hooks[0].command = 'wrong'; }, /invalid PreToolUse registration/],
  ];
  for (const [rel, mutate, expected] of cases) {
    const target = path.join(repo, rel); const original = fs.readFileSync(target); const json = JSON.parse(original);
    mutate(json); fs.writeFileSync(target, JSON.stringify(json));
    const result = f.run(['doctor'], repo); assert.equal(result.status, 1); assert.match(result.stdout, expected);
    fs.writeFileSync(target, original);
  }
});
test('diagnostic errors escape terminal controls and bound long messages', t => {
  const f = fixture(t);
  const preload = put(f.temp, 'unsafe-error.cjs', "const fs = require('fs'); fs.copyFileSync = () => { throw new Error(String.fromCharCode(27) + '[31m' + String.fromCharCode(10, 0x202e) + 'X'.repeat(1000)); };");
  const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/jarvis.js'), 'repair', '--apply'], { env:f.env, encoding:'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes(String.fromCharCode(27)), false);
  assert.equal(result.stdout.includes(String.fromCharCode(0x202e)), false);
  const lines = result.stdout.split('\n').filter(line => line.includes('[ERROR]'));
  assert.ok(lines.length > 0); for (const line of lines) assert.ok(line.length < 400);
});

test('copy cleanup ENOENT does not mask the original copy failure', t => {
  const f = fixture(t);
  const preload = put(f.temp, 'removed-temp.cjs', "const fs = require('fs'); fs.copyFileSync = (source, target) => { fs.unlinkSync(target); const error = new Error('ENOSPC original copy failure'); error.code = 'ENOSPC'; throw error; };");
  const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/jarvis.js'), 'repair', '--apply'], {env:f.env, encoding:'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stdout, /ENOSPC original copy failure/);
  assert.doesNotMatch(result.stdout, /ENOENT/);
  assert.equal(fs.existsSync(path.join(f.home, '.claude/CLAUDE.md')), false);
});

test('required inventory detects an individually removed agent and skill directory', t => {
  const f = fixture(t); const repo = bundle(f.temp);
  fs.unlinkSync(path.join(repo, 'agents/explorer.md'));
  let result = f.run(['doctor'], repo); assert.equal(result.status, 1); assert.match(result.stdout, /explorer.md/);
  const listing = f.run(['list-installed'], repo).stdout.split('\n').find(line => line.includes('explorer.md'));
  assert.match(listing, /MISSING-BUNDLED/);
  fs.rmSync(path.join(repo, 'skills/api-design'), { recursive: true });
  result = f.run(['doctor'], repo); assert.equal(result.status, 1); assert.match(result.stdout, /api-design/);
});

test('doctor requires exact shipped hook structure and typed metadata', t => {
  const f=fixture(t);const repo=bundle(f.temp);const p=path.join(repo,'hooks/hooks.json');const original=fs.readFileSync(p);
  const mutations=[
    j=>{j.hooks.Stop=[];}, j=>{j.hooks.SessionStart.push(j.hooks.SessionStart[0]);},
    j=>{j.hooks.PreToolUse[0].hooks.push({type:'command',command:'extra'});},
    j=>{j.hooks.PreToolUse[0].matcher='.*';},j=>{j.hooks.SessionStart[0].matcher='startup';},
    j=>{j.hooks.SessionStart[0].hooks[0].timeout=500;},j=>{j.hooks.PreToolUse[0].async=true;},
    j=>{j.hooks.SessionStart[0].id='wrong';},j=>{j.hooks.SessionStart[0].description={text:'invalid'};},
  ];
  for(const mutate of mutations){const j=JSON.parse(original);mutate(j);fs.writeFileSync(p,JSON.stringify(j));const result=f.run(['doctor'],repo);assert.equal(result.status,1);assert.match(result.stdout,/hook|registration/);}
});
test('doctor crosschecks marketplace identity and valid consistent versions', t => {
  const f=fixture(t);const repo=bundle(f.temp);const p=path.join(repo,'.claude-plugin/marketplace.json');const original=fs.readFileSync(p);const plugin=path.join(repo,'.claude-plugin/plugin.json');const pluginOriginal=fs.readFileSync(plugin);
  for(const mutate of [j=>{j.name='other';},j=>{j.plugins[0].name='other';},j=>{j.plugins[0].source='../other';},j=>{j.plugins.push(j.plugins[0]);}]) { const j=JSON.parse(original);mutate(j);fs.writeFileSync(p,JSON.stringify(j));const result=f.run(['doctor'],repo);assert.equal(result.status,1);assert.match(result.stdout,/inconsistent plugin manifests/); }
  for(const version of [2,'invalid','02.0.0','2.0']) {const j=JSON.parse(original);j.plugins[0].version=version;fs.writeFileSync(p,JSON.stringify(j));const config=JSON.parse(pluginOriginal);config.version=version;fs.writeFileSync(plugin,JSON.stringify(config));assert.equal(f.run(['doctor'],repo).status,1);}
});
test('an empty optional memory directory is not configured', t => {const f=fixture(t);fs.mkdirSync(path.join(f.home,'.claude/memory'),{recursive:true});const before=snapshot(f.home);const result=f.run(['memory-doctor']);assert.equal(result.status,0);assert.match(result.stdout,/not configured/);assert.deepEqual(snapshot(f.home),before);});
test('read-only bundled source exports completely without changing its permissions', t => {
  const f=fixture(t);const repo=bundle(f.temp);const source=path.join(repo,'CLAUDE.md');fs.chmodSync(source,0o444);
  try{const before=fs.statSync(source).mode;const result=f.run(['repair','--apply'],repo);assert.equal(result.status,0,result.stdout);assert.equal(fs.statSync(source).mode,before);assert.deepEqual(fs.readFileSync(path.join(f.home,'.claude/CLAUDE.md')),fs.readFileSync(source));if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.home,'.claude/CLAUDE.md')).mode & 0o777,0o600);}
  finally{fs.chmodSync(source,0o644);}
});

test('doctor rejects an unreadable required non-JSON resource', { skip: process.platform === 'win32' ? 'POSIX permissions require an unprivileged Linux run' : false }, t => {
  assert.notEqual(process.getuid(), 0, 'Run this permission regression as an unprivileged user');
  const f = fixture(t); const repo = bundle(f.temp); const resource = path.join(repo, 'rules/common/security.md');
  fs.chmodSync(resource, 0o000);
  try {
    const result = f.run(['doctor'], repo);
    assert.equal(result.status, 1, 'Unreadable required guidance must fail bundle diagnostics');
    assert.match(result.stdout, /security.md/); assert.match(result.stdout, /unreadable|EACCES/);
    const before = snapshot(f.home);
    const repair = f.run(['repair', '--apply'], repo);
    assert.equal(repair.status, 1, repair.stdout);
    assert.match(repair.stdout, /EACCES/);
    assert.deepEqual(snapshot(f.home), before);
  } finally { fs.chmodSync(resource, 0o644); }
});

test('exported workflow supports a host without optional services or specialist agents', t => {
  const f=fixture(t);assert.equal(f.run(['repair','--apply']).status,0);
  const workflow=fs.readFileSync(path.join(f.home,'.claude/rules/common/development-workflow.md'),'utf8');
  assert.match(workflow,/No specific service or optional agent is required/);
  assert.match(workflow,/local project/);assert.match(workflow,/primary vendor documentation/);
  assert.doesNotMatch(workflow,/GitHub code search first|Use \*\*planner\*\* agent|Use Exa for/);
  assert.match(workflow,/Write tests first/);assert.match(workflow,/CRITICAL and HIGH/);
  const review=fs.readFileSync(path.join(f.home,'.claude/rules/common/code-review.md'),'utf8');
  assert.match(review,/unavailable.*review.*unmet/i);
});

test('repair exports only release agents and reports extra bundled agents without managing them', t => {
  const f = fixture(t); const repo = bundle(f.temp);
  put(repo, 'agents/unexpected.md', 'Additional local agent');
  put(f.home, '.claude/agents/user-extra.md', 'User-owned agent');
  const result = f.run(['repair', '--apply'], repo);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(fs.existsSync(path.join(f.home, '.claude/agents/unexpected.md')), false);
  assert.equal(fs.readFileSync(path.join(f.home, '.claude/agents/user-extra.md'), 'utf8'), 'User-owned agent');
  for (const command of ['doctor', 'list-installed']) {
    const report = f.run([command], repo);
    assert.equal(report.status, 0, report.stdout);
    assert.match(report.stdout, /UNMANAGED.*unexpected.md/);
  }
});

test('repair rejects an empty managed source before creating any home exports', t => {
  const f = fixture(t); const repo = bundle(f.temp);
  put(repo, 'rules/common/testing.md', '');
  const before = snapshot(f.home);
  const result = f.run(['repair', '--apply'], repo);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /empty bundled source/);
  assert.deepEqual(snapshot(f.home), before);
});

test('gate allows separate invocations when no stable session identity is supplied', t => {
  const f=fixture(t); const env={...f.env}; delete env.CLAUDE_SESSION_ID; delete env.JARVIS_SESSION_ID; delete env.JARVIS_GATEGUARD;
  for(let i=0;i<2;i++) {
    const r=spawnSync(process.execPath,[path.join(root,'scripts/hooks/fact-forcing-gate.js')],{env,encoding:'utf8',input:JSON.stringify({tool_name:'Edit',tool_input:{file_path:path.join(f.temp,'file.txt')}})});
    assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny',false);
  }
  const input=JSON.stringify({session_id:'test-'+path.basename(f.temp),tool_name:'Edit',tool_input:{file_path:path.join(f.temp,'file.txt')}});
  const invoke=()=>JSON.parse(spawnSync(process.execPath,[path.join(root,'scripts/hooks/fact-forcing-gate.js')],{env,encoding:'utf8',input}).stdout);
  assert.equal(invoke().hookSpecificOutput.permissionDecision,'deny');
  assert.notEqual(invoke().hookSpecificOutput?.permissionDecision,'deny');
  const changed=JSON.stringify({session_id:'test-'+path.basename(f.temp),tool_name:'Write',tool_input:{file_path:path.join(f.temp,'file.txt'),content:'different content'}});
  const later=spawnSync(process.execPath,[path.join(root,'scripts/hooks/fact-forcing-gate.js')],{env,encoding:'utf8',input:changed});
  assert.equal(later.status,0);assert.notEqual(JSON.parse(later.stdout).hookSpecificOutput?.permissionDecision,'deny');
});

test('memory index resolves fragments and relative paths without basename collisions', t => {
 const f=fixture(t);put(f.home,'.claude/memory/note.md','note');put(f.home,'.claude/memory/MEMORY.md','[note](note.md#section)');
 assert.equal(f.run(['memory-doctor']).status,0);
 put(f.home,'.claude/memory/MEMORY.md','[wrong](missing/note.md)');const r=f.run(['memory-doctor']);assert.equal(r.status,1);assert.match(r.stdout,/orphaned: memory\/note.md/);
});

test('memory doctor reports an incomplete scan when a note cannot be read', t => {
 const f=fixture(t);put(f.home,'.claude/memory/note.md','[[missing]]');put(f.home,'.claude/memory/MEMORY.md','[note](note.md)');
 const loader=put(f.temp,'deny-read.cjs',"const fs=require('fs');const read=fs.readFileSync;fs.readFileSync=function(p,...args){if(String(p).endsWith('note.md')){const e=new Error('fixture unreadable');e.code='EACCES';throw e;}return read.call(this,p,...args);};");
 const r=f.run(['memory-doctor'],root,{env:{...f.env,NODE_OPTIONS:'--require '+JSON.stringify(loader)}});assert.equal(r.status,1);assert.match(r.stdout,/unreadable.*note.md/);assert.doesNotMatch(r.stdout,/all \[\[wiki-link\]\] references resolve/);
});

test('gate abstains instead of granting permission on every non-denial path', t => {
 const f=fixture(t);const env={...f.env};delete env.CLAUDE_SESSION_ID;delete env.JARVIS_SESSION_ID;delete env.JARVIS_GATEGUARD;
 const hook=path.join(root,'scripts/hooks/fact-forcing-gate.js');
 const run=(data,extra={})=>{const r=spawnSync(process.execPath,[hook],{env:{...env,...extra},encoding:'utf8',input:typeof data==='string'?data:JSON.stringify(data)});assert.equal(r.status,0);return JSON.parse(r.stdout);};
 for(const data of ['{bad',{}, {tool_name:'Read'}, {session_id:'test-'+path.basename(f.temp),tool_name:'Bash',tool_input:{command:'git status'}}, {session_id:'x',tool_name:'Edit',tool_input:{}}, {session_id:'x',tool_name:'MultiEdit',tool_input:{edits:[]}}])assert.deepEqual(run(data),{});
 const edit={session_id:'test-'+path.basename(f.temp),tool_name:'Write',tool_input:{file_path:'test.txt',content:'test'}};
 assert.deepEqual(run(edit,{JARVIS_GATEGUARD:'off'}),{});
 assert.equal(run(edit).hookSpecificOutput.permissionDecision,'deny');assert.deepEqual(run(edit),{});
 const bash={session_id:edit.session_id,tool_name:'Bash',tool_input:{command:'rm -rf example.txt'}};
 assert.equal(run(bash).hookSpecificOutput.permissionDecision,'deny');assert.deepEqual(run(bash),{});
 const blocked=path.join(f.temp,'blocked-home');fs.mkdirSync(blocked);put(blocked,'.jarvis-cc','block state directory');
 assert.deepEqual(run(edit,{HOME:blocked,USERPROFILE:blocked}),{});
});
