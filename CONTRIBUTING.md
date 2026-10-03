# Contributing to JARVIS-CC

First-time contributors are welcome. You can help by reporting a confusing step,
suggesting clearer wording, fixing a typo, or improving a skill. You do not need to
know both Claude Code and Codex.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). For a possible security
vulnerability, use the private route in [SECURITY.md](SECURITY.md), not a public issue.

## Start with a small contribution

1. Check [existing issues](https://github.com/reevesc88/jarvis-cc-public/issues) to
   avoid duplicating a report. An open issue may describe work that is still pending.
2. Use the bug report or feature request form for a new report. Questions are welcome
   too. Describe the result you wanted and what actually happened, in plain English.
3. For a larger change, discuss the scope in an issue first. Small wording fixes can
   go straight to a pull request, which is a proposed change for review.

Public issues and pull requests are visible to everyone. Remove passwords, tokens,
private paths, account details, personal documents, and identifying information from
logs and screenshots before sharing them. Share a small made-up example when possible.

## Edit and check a change

You need a GitHub account to propose changes, but not to install the public plugin.
For a small documentation edit, use GitHub's file editor and its option to propose a
change. GitHub will guide you through making your own copy (a fork) and a pull request.

For local development, fork the repository, clone your fork, and create a branch for
your change. Open a terminal in the cloned folder. Read `AGENTS.md`, `.codex/AGENTS.md`
and `.agents/skills/jarvis-cc/SKILL.md` before changing plugin behaviour.

Use Node.js 22 or 24 and Git. There is no `npm install` step: the JavaScript tools
use Node's built-in modules. For changes to scripts, hooks, tests or manifests, run:

```text
node --check scripts/jarvis.js
node --check scripts/lib/agency-orchestration.js
node --test tests/starter.test.js tests/agency-orchestration.test.js
node scripts/jarvis.js doctor
node scripts/jarvis.js agency-doctor
```

CI (automated checks on GitHub) also tests both Node versions. You can run one locally
and report which version you used. Tests use isolated homes. Never test exports or
`repair --apply` against your real home configuration. The Agency doctor validates
policy; it does not run agents. A detected local role does not prove worker execution.

For a documentation-only change, preview the Markdown and check links and command
wording. A full test run is not required for a typo. If you change a runnable example,
check it safely in an isolated fixture and describe the result. Do not run examples
against live accounts, databases, credentials or paid services just to validate text.
The optional Python dashboard needs Python 3 with Tkinter for visual checks.

## Open a pull request

- Explain the problem and what your change does. Link a related issue if one exists.
- Keep the change focused. Preserve existing user settings and concurrent work.
- List checks actually run and their results; say clearly when something was not run.
- Keep instructions inclusive, additive and free of personal defaults or permission grants.
- Disclose relevant AI assistance and verify its output. Generated text or a review
  bot's status is not proof of correctness.

Maintainers review the exact revision and required checks before merging. Please
respond to findings and expect another review when the change needs corrections.
Installing this plugin never grants an assistant permission to publish or merge work.
See [repository checks](docs/repository-checks.md) for the current automation.
