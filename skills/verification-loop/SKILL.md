---
name: verification-loop
description: "A comprehensive verification system for Claude Code sessions."
---

# Verification Loop Skill

Before invoking a CLI, inspect the project manifest and resolve its existing local executable. The `./node_modules/.bin/` examples below are for Bash and fail if the executable is absent; do not fall back to a registry runner. In PowerShell, use the verified `.cmd` shim where applicable. For other package layouts, inspect and use an existing project script or resolved executable. A local executable can itself perform network or write operations; its location grants no authorization for those actions.


A comprehensive verification system for Claude Code sessions.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

Discover the current project's documented scripts and installed tools first; examples below are conditional on those tools existing. Report unavailable checks without installing packages implicitly.

Run each check directly and inspect its exit status before continuing. If output must be saved, capture it without replacing the check's status with a display/filter command.

### Phase 1: Build Verification
```bash
# Check if project builds
npm run build
# OR
pnpm build
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
# TypeScript projects
./node_modules/.bin/tsc --noEmit

# Python projects
pyright .
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
# JavaScript/TypeScript
npm run lint

# Python
ruff check .
```

### Phase 4: Test Suite
```bash
# Run tests with coverage
npm run test -- --coverage

# Check coverage threshold
# Target: 80% minimum
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 5: Security Scan
```bash
# Candidate paths only; never print matching secret values. Prefer a redaction-aware scanner.
if rg -l -e "sk-" -e "api_key" -g "*.ts" -g "*.js" .; then
  printf 'Review the candidate paths using a redaction-aware scanner.\n'
else
  scan_status=$?
  if [ "$scan_status" -ne 1 ]; then exit "$scan_status"; fi
  printf 'No candidate matches.\n'
fi

# Check for console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### Phase 6: Diff Review
```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Run: /verify
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.
