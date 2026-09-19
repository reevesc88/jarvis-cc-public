# Security policy

## Supported versions

Security maintenance focuses on the latest public 2.x starter release and the current
`main` branch of [jarvis-cc-public](https://github.com/reevesc88/jarvis-cc-public).
Older 1.x personal configurations are not maintained as public starter releases.
Update to the latest public version before reporting when it is safe to do so; an
update does not remove or repair files previously exported into your own home folder.

## Report a vulnerability privately

Use GitHub's **Report a vulnerability** form:

[Send a private security report](https://github.com/reevesc88/jarvis-cc-public/security/advisories/new)

Sign in to GitHub if prompted. This report is private to the maintainers and people
invited into the advisory, rather than a public issue. Describe:

- The affected plugin version or commit, host and operating system.
- What could go wrong and the smallest safe steps to reproduce it.
- Expected and actual behaviour, with a sanitised example if useful.

Do not include real credentials, personal documents, private account data or exploit
results obtained against other people's systems. Use an isolated test project and
made-up data. Do not post vulnerability details in public issues or pull requests.
If the private form is unavailable, open a public issue asking for a private security
contact only, without technical details or sensitive information.

Maintainers will assess the report and coordinate next steps through the private
advisory. There is no guaranteed response time or paid bug-bounty programme. Please
keep details private while a fix and disclosure are coordinated.

## Scope and limits

Reports about bundled scripts, hooks, manifests and unsafe guidance are welcome.
The file gate is a workflow reminder, not a security sandbox or permission grant.
The Agency validator checks declarations; it does not enforce a live execution
boundary. Normal host permissions and the user's decisions remain essential.

JARVIS does not bundle upstream Agency Agents or provide Claude Code or Codex itself.
If a vulnerability is in one of those projects, use its own official security reporting
route. Ordinary bugs and feature requests belong in this repository's public issue
forms after removing sensitive information. Conduct concerns follow the separate
[Code of Conduct](CODE_OF_CONDUCT.md).
