# Agency Agents: a small, practical start

Checked against upstream documentation on 17 September 2026. Selected Claude installation was also tested in an isolated temporary home; see the verification limits below. These instructions do not grant permission to change your own setup.

## What you need

Agency Agents is an optional external dependency for specialist roles. Base JARVIS works without it. You need a working, signed-in Claude Code or Codex installation first. Agency Agents supplies roles; it does not include your host account or model access.

**Easiest start:** download the official [Agency Agents desktop app](https://github.com/msitarzewski/agency-agents-app/releases/latest) for Windows, macOS or Linux. The [upstream project](https://github.com/msitarzewski/agency-agents) recommends this app for browsing roles and installing them into supported hosts, including Claude Code and Codex. Review the roles and destination before installing a small selection. This app is separate from JARVIS's optional Skills Hub dashboard. We have checked the upstream links, not run the desktop app.

If the selected role is already available in your host, skip installation and go to step 3. Otherwise use the desktop app or the selective command-line path below. Do not install the whole catalog simply to complete one task.

JARVIS's advanced declaration validator remains disabled by default and is not required here. Direct host use does not provide custom JARVIS budgets, isolation or attestation enforcement. Its pinned upstream provenance is separate from the upstream version you choose to install.

Before installing, you can ask your assistant:

> Check whether Frontend Developer and Reality Checker are already available as native agents in this host. Check only the prerequisites needed for the selected installation method. Show me any missing tools, the two selected roles, installation destinations and files that would be overwritten. Do not install or change configuration until I approve that plan. Do not install unrelated agents or dependencies.

## 1. Pick one useful role

Start with **Frontend Developer** for a small UI task. Add **Reality Checker** for a separate review. These names exist in the upstream catalog. Installing a catalog does not run it; select only the roles useful to this task. [Frontend Developer](https://github.com/msitarzewski/agency-agents/blob/main/engineering/engineering-frontend-developer.md), [Reality Checker](https://github.com/msitarzewski/agency-agents/blob/main/testing/testing-reality-checker.md)

## 2. Choose reference use or native agent installation

**Smallest option, either host:** open the selected upstream Markdown file and supply it as a reference for a scoped task. Say: “Use the attached role's relevant review checklist for this component. Follow our project instructions and permissions.” This is prompt/reference use in the current conversation. It does not prove a separate worker was launched. [Upstream reference-use option](https://github.com/msitarzewski/agency-agents#-quick-start)

**Command-line alternative:** check that Git, Bash and the usual Bash core utilities are available. Codex conversion also requires Perl. On Windows use Git Bash, not PowerShell, for the commands below; check `git --version`, `bash --version` and `perl --version` there before choosing Codex conversion. If a prerequisite is missing, use the desktop option or install that prerequisite explicitly before continuing. Use a separate upstream clone and choose a new directory name if `agency-agents` already exists.

```bash
git clone https://github.com/msitarzewski/agency-agents.git
cd agency-agents
```

Choose only your host's block below. These commands intentionally install two roles, not the whole catalog. The installer supports the selection flags and Windows Git Bash. It can overwrite same-named installed files, so inspect the preview and existing target files before the actual install. [Official installer](https://github.com/msitarzewski/agency-agents/blob/main/scripts/install.sh)

### Claude Code

Preview:

```bash
./scripts/install.sh --tool claude-code --agent frontend-developer,reality-checker --no-interactive --dry-run
```

Then, when you want those selected roles installed:

```bash
./scripts/install.sh --tool claude-code --agent frontend-developer,reality-checker --no-interactive
```

The default destination is `~/.claude/agents/`; configured environment overrides can change it. The dry-run confirms selection and mode, but does not print the destination. Inspect environment overrides and existing files in the actual destination yourself before installing.

### Codex

Generate the TOML integration catalog inside the clone, then preview installation of only the two selected roles. Conversion creates the full generated catalog in the clone; the install selection controls what is copied into your host:

```bash
./scripts/convert.sh --tool codex
./scripts/install.sh --tool codex --agent frontend-developer,reality-checker --no-interactive --dry-run
```

Then, when you want those selected roles installed:

```bash
./scripts/install.sh --tool codex --agent frontend-developer,reality-checker --no-interactive
```

The default destination is `~/.codex/agents/`. Codex uses each TOML file's `name` field, such as `Frontend Developer`, for role selection. Generating files is not proof the host loaded them. [Official Codex integration](https://github.com/msitarzewski/agency-agents/blob/main/integrations/codex/README.md)

The selected slugs above come from the catalog names through upstream's own slug function. They are not Jarvis's registry identifiers, which include division prefixes. [Upstream naming helper](https://github.com/msitarzewski/agency-agents/blob/main/scripts/lib.sh)

## 3. Give the host one bounded request

Open a fresh host session in your project, then ask:

> Delegate this component change to the Frontend Developer agent. Only edit src/components/SearchBox.tsx. Preserve other people's work. Then have Reality Checker review the resulting diff without editing. Do not start additional tasks. Report the actual worker names, invocation identifiers where available, files examined or changed, checks run, findings, and unresolved items. If either role cannot be launched, report that instead of claiming it was used.

Replace the example file with your actual target. If the host only offers prompt/reference use, use the smallest option above and label it honestly.

## 4. Check what actually happened

- **Installed:** the intended Markdown or TOML exists and the host recognizes the role.
- **Selected:** the host's tool/activity history shows an actual named subagent invocation or worker session.
- **Used:** that worker returned a result tied to the requested task, with inspectable files, findings, or check output.

A sentence saying “Frontend Developer mode activated” is not a worker receipt. A tool success is not proof the resulting code works. Ask for actual checks and inspect the diff. A normal task may need one agent, two, or none; nobody needs to force the entire catalog into every request.

## What this does not claim

Direct host agents use the host's own permissions and runtime behavior. This guide does not certify hard token budgets, hostile-process isolation or automatic reviews. Installation command syntax and role names were checked against upstream commit `ad9264e309bd5e5422c04784372d7841b1e5d604`. In Windows Git Bash, the selected Claude dry-run wrote nothing and the real install copied exactly two agent files into an isolated temporary home. No real user configuration was changed. Codex conversion and installation are not yet verified by this guide. Desktop installation, host loading and actual worker dispatch remain to be verified in your chosen session; no model or provider request was made.
