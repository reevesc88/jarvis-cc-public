> Historical pre-release evidence: the source hashes below identify snapshots in the private development archive. They are not commits available from this clean public repository. Use the current checkout commands below to test the public source; do not attempt to check out those historical hashes here.

# Neutral starter container validation

Tested on 2026-09-17 UTC against source commit
`38d377a0e8352ea78cb6e2cc4884c89c7b61fca2` (plugin 2.0.0).
These results describe that exact candidate, not every later revision. Subsequent changes remove an unreachable status branch and clarify the architect prompt; those changes are not included in this container snapshot.

## Results

| Check | Observed result |
|---|---|
| Node 22.23.2, Linux | 107 tests passed; zero failed or skipped |
| Node 24.21.0, Linux | 107 tests passed; zero failed or skipped |
| Claude Code 2.1.260 | Fresh local marketplace install enabled plugin 2.0.0 |
| Claude no-model SDK initialization | Host returned 28 namespaced commands (22 skills plus 6 commands) and 16 namespaced agents |
| Claude SessionStart | Host emitted a successful hook response with exit code 0 and neutral JARVIS starter context |
| Codex CLI 0.154.0 | Fresh local marketplace install enabled plugin 2.0.0 |
| Codex app-server discovery | 28 enabled plugin skills, including 6 migrated commands; plugin metadata recognized 22 skills and 2 hooks |
| Codex hook discovery | Two enabled, **untrusted** hooks; no hook warnings or errors. Execution was not tested |
| Optional export | Preview wrote nothing; explicit apply preserved existing instructions and Claude settings byte-for-byte; no personal hooks or memory created |
| Agency policy | Passed, with orchestration still disabled |

The Claude host response was `type=system`, `subtype=hook_response`,
`hook_name=SessionStart:startup`, `hook_event=SessionStart`,
`exit_code=0`, `outcome=success`. Its output contained the neutral additional context.
No user prompt or paid model call was sent. Discovery observations came from a custom local
harness using real host control APIs, not file counts. That harness is not shipped here;
the commands below reproduce the test suite and basic installation checks, not all API observations.

The final rerun includes twelve additional review regressions covering missing command resources, missing-bundle reporting, partial-copy cleanup and retry, competing files and unsupported hard links, invalid metadata/hook registrations, escaped diagnostic errors, preservation of original copy failures, and individually missing agent/skill inventory. The required-resource loop also checks both hook executables. Additional cases enforce strict hook shape, marketplace identity, empty optional memory, and read-only source export. The read-only source case passed as unprivileged UID 1000.

## Separate Windows regression run

The coordinating session also ran the full suite on Windows with Node 26.5.1 against
source `38d377a0e8352ea78cb6e2cc4884c89c7b61fca2`: **107/107 passed**, with zero
failed or skipped. This was a local Windows run, separate from the Linux container matrix
and host smoke tests above. From that source checkout, the command was:

```text
node --test tests/starter.test.js tests/agency-orchestration.test.js
```

## Isolation and images

Docker Desktop Linux engine 29.6.2 ran checks with networking disabled, a read-only root
filesystem and source mount, an unprivileged user, dropped capabilities, no-new-privileges,
and temporary home/tmp mounts. Containers had CPU, memory, and process limits. No real home,
authentication directory, or Docker socket was mounted. The host image build downloaded
packages with network access; runtime checks ran offline.

Recorded local **image IDs**, not registry manifest digests:

- `node:22-bookworm-slim`: `sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`
- `node:24-bookworm-slim`: `sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`
- Custom local `jarvis-clean-hosts:validation`: `sha256:5f0819c667f3341722e5606cccde0824fd37694d613ee7f4d8666fabcccca82b`

The custom image was based on Node 22 Bookworm slim with Git and CA certificates, plus
`@openai/codex@0.154.0` and `@anthropic-ai/claude-code@2.1.260`. It is not a published image.
Tags can move; rebuilding today need not produce those image IDs or exact Node patch versions.

## Run the regression suite yourself

From your current public repository checkout, with Docker installed, run in PowerShell. This verifies your checked-out revision; it does not recreate the inaccessible historical snapshot:

```powershell
$source = (Get-Location).Path
foreach ($major in 22, 24) {
  $image = "node:$major-bookworm-slim"
  docker pull $image
  docker run --rm --network none --read-only --user 1000:1000 --cpus 2 --memory 2g --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=512m --tmpfs /home/node:rw,nosuid,nodev,uid=1000,gid=1000,size=512m --mount "type=bind,source=$source,target=/plugin,readonly" --workdir /plugin $image node --test tests/starter.test.js tests/agency-orchestration.test.js
  if ($LASTEXITCODE -ne 0) { throw "Node $major tests failed" }
}
```

Image pulls require network access; the test runs do not. No host installation is needed
for these Node tests. To check basic host installation separately, use a disposable container
with the pinned host packages already installed, a fresh home, and the repository mounted at
`/plugin`. Inside that container:

```sh
codex plugin marketplace add /plugin --json
codex plugin add jarvis-cc@jarvis-cc
codex plugin list --marketplace jarvis-cc
claude plugin marketplace add /plugin
claude plugin install jarvis-cc@jarvis-cc
claude plugin list --json
```

These commands install into that container's temporary home. They do not establish hook
execution, API discovery, or a successful model response by themselves.

## Not tested

- The suggested first task with a live AI model, billing, or authenticated account.
- A complete virtual computer, graphical desktop, or all supported operating systems.
- Public GitHub fetching; the tested marketplace source was a local read-only mount.
- Codex hook invocation/trust approval or either host's PreToolUse gate invocation.
- Security sandbox enforcement. Codex reported a bundled bubblewrap fallback; its presence
  is not proof that confinement worked.

Discovery followed the isolated export-preservation check. Namespaced plugin entries
separated plugin-provided capabilities from optional exported files. Direct startup-hook
tests and successful Claude SessionStart initialization do not prove every hook or workflow.

## Later source CI verification

A later private development candidate passed **109/109 tests on both Node 22 and Node 24** in GitHub Actions. These are historical CI results, separate from the 107-test container results above, and are not public release evidence. The local Docker backend was unavailable for a fresh full container rerun. The clean public candidate preserves the same runtime, contracts and tests; its public CI must still verify its own release commit.

## Earlier clean public candidate regression run

Before publication, the clean public candidate incorporating source fixes from private development commit `60fec0925c122ac020238b736e64bb39d2fb7df3` ran the full suite locally on Windows: **111 tests, 110 passed, zero failed, one skipped**. The skipped test requires unprivileged POSIX permissions and is expected to run in Linux CI. This does not replace the historical container evidence or establish a public release commit; public CI must verify the published candidate separately.

## Public review correction regression run

After the first public PR review corrections, the local Windows suite ran **114 tests: 113 passed, zero failed, one expected POSIX-permissions skip**. Three new process/CLI regressions cover missing hook session identity, relative memory links and incomplete memory-file reads. This run supersedes the earlier 111-test local candidate count, not its historical container results. Fresh public CI and host installation checks still need to validate the release commit.

## Host-permission correction regression run

The subsequent bounded hook correction ran **115 tests on Windows: 114 passed, zero failed, one expected POSIX-permissions skip**. Non-denial gate paths now abstain with no permission decision, preserving normal host approval checks. The regression covers disabled/sessionless/malformed inputs, ordinary tools, retries and persistence failure. File reminders remain keyed by exact path, not edit contents; destructive Bash reminders retain exact-command keys.

## Final bounded release review regression run

Runtime correction commit `9d822c2e3c86a846918c0733e5a2148d7ff19385` passed **118 tests on Windows: 117 passed, zero failed, one expected POSIX-permissions skip**. Three RED/GREEN regressions cover quoted SQL client command detection, checked-operation activity refresh and expiry, and preservation of publication errors when cleanup also fails. Additional assertions cover exact destructive-command keying and first-touch MultiEdit reminders. Both `doctor` and `agency-doctor` passed, with Agency execution disabled. These tests did not cover a fresh container install or an authenticated model request; the earlier container runs above remain historical evidence.

## Session-state concurrency correction regression run

Runtime correction commit `80204b3c1f68acfc7f7baef261d86b9527100e21` passed **125 tests on Windows: 124 passed, zero failed, one expected POSIX-permissions skip**. Both `doctor` and `agency-doctor` passed, with Agency execution disabled. The hook serializes its read/check/write state transaction; a busy or abandoned lock waits for at most one second before the reminder abstains and leaves normal host permission checks in control. This local regression result does not establish a fresh container install, authenticated model request or release-head CI result. Earlier observations above retain their original commits and counts.
