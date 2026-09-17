![JARVIS-CC: a colourful path from learning to building with AI](docs/assets/jarvis-banner.png)

# JARVIS-CC

**Get curious. Try a first task. Build your confidence.**

[Start here](#start-here) · [Try a first task](#try-a-first-task) · [What is included](#what-is-included)

A welcoming toolkit for Claude Code and Codex, with reusable skills, specialist agent prompts, hooks, and tools for inspecting your setup.

Created by Calum Reeves · AI1AU Solutions. JARVIS now ships neutral starter guidance for anyone learning or building with AI. You do not need to edit a name, private path, or personal account before using it. JARVIS is an add-on: it does not install Claude Code or Codex, provide an AI account, or restore projects and credentials.

<p><img src="docs/assets/ai1au-solutions-logo.svg" alt="AI1AU Solutions logo" width="400"></p>

## Start here

Choose **one** host to begin with. Claude Code is Anthropic's coding assistant; Codex is OpenAI's coding assistant. You do not need both. If you later use both, install JARVIS separately in each host; installing it in one does not enable it in the other.

1. Install and sign in to your chosen host. Follow the [Claude Code terminal guide](https://code.claude.com/docs/en/terminal-guide) or the [Codex quickstart](https://developers.openai.com/codex/quickstart).
2. Install [Node.js](https://nodejs.org/en/download) and confirm `node --version` works in your terminal. JARVIS hooks and maintenance tools need Node on `PATH`; the repository's automated checks use Node 22 and 24. There is no `npm install` step for JARVIS.
3. Install [Git](https://git-scm.com/downloads) and confirm `git --version` works in your terminal. Git lets the plugin marketplace fetch this repository. Normal marketplace installation from this public repository does not require a GitHub account or manual clone.
4. Read the starter-defaults note below, then follow the installation steps for your host.

A **terminal** means PowerShell, Terminal, or your shell. An **assistant prompt** is the box where you normally chat with Claude Code or Codex. Commands starting with `/` below go inside Claude Code, not PowerShell.

### Your setup stays yours

Version 2 ships neutral, additive [starter guidance](CLAUDE.md). It does not assume your name, operating system, private services, preferred model, or memory store. Existing project and user instructions remain authoritative. The SessionStart hook adds a short introduction without reading or writing your home configuration.

No Git publishing, automatic memory creation, paid work, or global configuration change is authorized by installing JARVIS. Memory is optional and requires consent and a destination you choose. Agent prompts inherit your configured model; actual role/tool support depends on your host.

**Upgrading from 1.x:** old files exported with `repair` remain untouched, including any personal instructions from that version. Review those files separately. Updating or uninstalling this plugin never removes your files. In 2.0, `repair` previews only; `repair --apply` explicitly exports missing neutral files and is not an installation step.

## Install in Claude Code

Open Claude Code and enter these two commands into its **interactive prompt**, one at a time:

```text
/plugin marketplace add reevesc88/jarvis-cc-public
/plugin install jarvis-cc@jarvis-cc
```

The first adds the catalog; the second installs its JARVIS plugin. Follow Claude Code's prompts, then restart Claude Code. Open `/plugin` and check its installed-plugins view for `jarvis-cc` and any errors.

See Anthropic's [plugin installation guide](https://code.claude.com/docs/en/discover-plugins) if your interface differs.

## Install in Codex

These commands were checked against the Codex CLI `0.154.0`. Use a Codex version that supports plugins; an older CLI may not recognize them. Open your **terminal**, not a chat prompt, and run:

```text
codex plugin marketplace add reevesc88/jarvis-cc-public
codex plugin add jarvis-cc@jarvis-cc
codex plugin list --marketplace jarvis-cc
```

Confirm the list includes JARVIS, review and trust only the hooks you intend to enable, then start a new Codex session. The [official Codex plugin guide](https://developers.openai.com/codex/plugins) also explains the `/plugins` interface. If the commands are unavailable, update Codex through its official installation method before continuing.

Host support differs: the Claude command names and Markdown agent bundle below are not a promise that Codex installs equivalent global agents or loads all rules. The hook manifest is compatible with the checked Codex version, but that does not prove its Claude-style tool matchers cover every Codex editing or shell tool.

## Try a first task

Open a small project you are comfortable inspecting. In your assistant's **chat prompt**, try:

> Explain what this project does in plain English. List the JARVIS skills you can actually access and suggest one that would help me understand it. Only read files; do not edit, install, publish, or repair anything.

A useful first result is a short project explanation and a skill suggestion. The assistant should report unavailable capabilities instead of claiming they are installed. You can then ask it to explain one file or propose a small change for your approval.

## What is included

| Component | What you get |
|---|---|
| 16 agent prompts | Four original roles plus 12 adapted from ECC, including code review, security review, testing, and troubleshooting |
| 22 skills | Reusable workflows for understanding code, development, review, and related tasks |
| 11 common rule files | Bundled engineering guidance; their presence in the plugin does not make them always loaded in every host |
| Two registered hooks | Neutral starter context and a first-attempt gate for matching edit/destructive-command tools |
| Maintenance CLI | Read-only inspection plus optional missing-file export for `~/.claude` |
| Skills Hub | An optional local Python/Tkinter dashboard that scans the bundled catalog; it does not monitor live agents |
| Agency validation | Checks policy and authenticated work-plan declarations; it does not execute workers |

The Fact-Forcing Gate asks for facts on the first Edit, Write or MultiEdit of each exact file path. Later operations on that path are not denied by this hook, without comparing their content or tool type. For matching destructive Bash commands, the first exact command string is denied and a byte-identical retry is not denied by this hook. The gate does not verify explanations or grant authorization. It is a workflow aid, not a security sandbox; non-denial paths return no permission decision, so normal host permission checks still apply. Missing session identity or state-write failures also leave the decision to the host.

## Commands and diagnostics

These are **Claude Code interactive commands**:

| Command | Purpose |
|---|---|
| `/jarvis-cc:list-installed` | Compare optional home exports with bundled copies; read-only |
| `/jarvis-cc:doctor` | Validate bundled resources, manifests and hooks; read-only |
| `/jarvis-cc:memory-doctor` | Inspect Claude-home memory links and naming; read-only |
| `/jarvis-cc:agency-doctor` | Check the disabled-by-default Agency policy and report local role candidates; read-only |
| `/jarvis-cc:dashboard` | Open the optional catalog window; requires Python 3 with Tkinter and a graphical desktop |
| `/jarvis-cc:repair` | Preview optional missing neutral files for `~/.claude`; writes nothing |

**A clean home is supported.** `doctor` checks the plugin bundle, not a required personal folder layout. Home exports and memory are optional; `memory-doctor` reports “not configured” successfully when no memory exists. These checks do not prove the host loaded the plugin.

`repair` previews missing exports. Only `repair --apply` writes them. It preserves existing files under stable user-owned directories and rejects links, junctions, and unsafe targets detected during checks. Do not run exports while another process is replacing those directories. It never edits `settings.json`. It exports no personal backup hooks, accounts, credentials, or projects. This optional export does not provide hostile-filesystem containment. Files are published only after a complete temporary copy, without replacing a competing file. If the filesystem does not support safe hard-link publication, export fails without a fallback; an interrupted run may leave a temporary file, but never publishes a partial copy.

### Run diagnostics without an assistant

If you have a downloaded or cloned copy of this repository, open a **terminal in that folder** (the folder containing this README) and run:

```text
node scripts/jarvis.js doctor
node scripts/jarvis.js agency-doctor
node scripts/jarvis.js list-installed
```

These commands are read-only. They check the bundle, Agency policy, and optional Claude-home exports. None proves that a host has loaded the plugin. You do not need to clone the repository for normal marketplace installation.

### Common questions

- **`node` is not recognized:** install Node.js, reopen your terminal and assistant, and retry `node --version`.
- **The dashboard does not open:** check `python --version` and `python -m tkinter` in your terminal. Tkinter and a graphical desktop are required; the dashboard is optional.
- **A command or skill is missing:** confirm the plugin is enabled in your host and start a new session. Claude slash-command names do not necessarily apply in Codex.
- **An old personal instruction still appears after upgrading:** restart the host and inspect any files you previously exported using version 1.x. Version 2 leaves those existing files untouched; it cannot remove or override your own configuration.
- **The file gate denies a first touch:** read its explanation and present the requested facts before continuing authorized work on that file. It tracks the exact file path, not edit contents. For a destructive Bash denial, retry the byte-identical authorized command after presenting the facts; do not rephrase commands to evade the reminder.

## Update or remove

Run the following in your **terminal**. Restart the assistant after an update or removal so existing sessions stop using cached plugin content.

| Host | Update | Remove |
|---|---|---|
| Claude Code | `claude plugin marketplace update jarvis-cc`, then `claude plugin update jarvis-cc@jarvis-cc` | `claude plugin uninstall jarvis-cc@jarvis-cc` |
| Codex | `codex plugin marketplace upgrade jarvis-cc`, then `codex plugin add jarvis-cc@jarvis-cc` | `codex plugin remove jarvis-cc@jarvis-cc` |

Use the same installation scope when managing Claude plugins if you chose a non-default scope. Removing the plugin does not undo files you previously copied into `~/.claude` with `repair`; review those separately before removing anything.

## What has been tested?

Historical snapshots from the private development archive passed **107/107 tests in Linux containers on both Node 22.23.2 and 24.21.0**. In those historical snapshots, fresh offline local installations worked in Claude Code 2.1.260 and Codex CLI 0.154.0, with capabilities discovered by the real hosts. Claude also successfully invoked the neutral SessionStart hook during initialization.

See the [container validation report](docs/testing/starter-container-validation.md) for the exact source commit, image IDs, isolation, commands, and limits. This was not a desktop VM or a live AI first-task conversation. Codex hook execution, PreToolUse invocation, sandbox enforcement, and public GitHub installation remain untested.

The checkout does not enable external MCP servers, live web search or permission overrides. Its `.codex/config.toml` declares optional local roles; choose any additional integrations in your own host configuration.

## Add Agency Agents when you need a specialist

[Agency Agents](https://github.com/msitarzewski/agency-agents) is an optional external dependency for Agency specialist roles. Base JARVIS works without it. JARVIS does not bundle or automatically install the upstream catalog.

Start with the official [Agency Agents desktop download](https://github.com/msitarzewski/agency-agents-app/releases/latest) for Windows, macOS or Linux, then follow our [short Claude Code and Codex setup guide](docs/agency-agents-quickstart.md). Install one useful role and a reviewer when needed, then ask your host to use those named agents and show its actual worker activity. The guide includes a prerequisites check, selected-agent installation and a copyable first request.

No custom JARVIS dispatcher is required for this workflow. Your host runs the agents using its own permissions and capabilities.

### Advanced: declaration validation

JARVIS also retains an optional, disabled-by-default Agency validator. It checks work-plan declarations and authenticated approvals; it does not execute workers or enforce runtime budgets, file ownership or process isolation. Current compatibility mode accepts approvals without exact-plan binding with a warning. The [technical Agency skill](skills/agency-orchestration/SKILL.md) documents these contracts. Its pinned upstream provenance is independent of direct host installation.

Repository maintainers can read [how automated checks work](docs/repository-checks.md).

## License

MIT. See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and license terms. Several agents and skills are adapted from [ECC](https://github.com/affaan-m/ECC), also MIT-licensed. The Agency integration references the MIT-licensed Agency Agents catalog without redistributing its upstream prompt files.
