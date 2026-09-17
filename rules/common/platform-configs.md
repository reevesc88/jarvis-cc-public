# Host configuration

Use the current host's documented configuration format. Claude Code and Codex are separate
hosts: installing a plugin in one does not install it in the other.

- Claude Code uses CLAUDE.md project instructions and supports plugin Markdown agents.
- Codex uses AGENTS.md project instructions; capabilities depend on the installed version.
- Discover actual configuration locations. Never assume a username, drive letter, private
  endpoint, memory service, or another person's home directory.
- Keep credentials and private service configuration outside the plugin and repository.
- Do not copy or modify global settings without the current user's authorization.
- A bundled file is not proof the host loaded it. Verify available commands and agents.
