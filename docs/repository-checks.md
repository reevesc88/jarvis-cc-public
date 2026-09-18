# Repository checks

The public repository includes two GitHub Actions workflows:

- **CI** runs syntax checks, neutral starter tests, Agency validation tests and the unattested-board rejection check on Node 22 and 24.
- **AgentShield Security Scan** reports findings in its job log. It is report-only and does not block merging by itself.

Both workflows use read-only repository permissions. They do not require a personal Claude credential or configure an assistant that writes repository changes.

Claude mention automation and credential-dependent Claude review automation are not included in this public starter. An owner can arrange an external read-only review service later after choosing its access, credentials and cost policy. Installing the JARVIS plugin does not enable such a service or grant publishing authority.
