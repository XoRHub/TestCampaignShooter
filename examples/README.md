# Examples

## Sample test suite (`tests/`)

4 tests covering 3 engines, each with its own `<test>.metadata.json` (technical
fields + free-form selection properties: tags, team, criticality, platform,
environments, owner, flaky…):

| Test                          | Engine         | Notes                                              |
| ----------------------------- | -------------- | -------------------------------------------------- |
| `suites/unit/math.test.js`    | generic-node   | always passes, writes its own JUnit report         |
| `suites/unit/strings.test.js` | generic-node   | **fails on purpose** (`FORCE_PASS=true` to fix it) |
| `suites/checkout/smoke.cy.js` | cypress        | runs in `cypress/included` under Argo              |
| `suites/api/login.robot`      | robotframework | native `--xunit`                                   |

## Rules (`rules/`)

- `smoke-payments.json` — nested AND/OR + negation (smoke ∧ (payments ∨ criticality ≥ 3) ∧ ¬flaky)
- `unit-only.json` — subtree restriction + engine

## Quick tries (CLI, local provider)

```bash
node apps/cli/bin/tcs.mjs discover --source examples/tests
node apps/cli/bin/tcs.mjs preview  --source examples/tests --rule-file examples/rules/smoke-payments.json
node apps/cli/bin/tcs.mjs run      --source examples/tests --rule-file examples/rules/unit-only.json --junit-out junit.xml
# same, but each test encapsulated in its own container image (like an Argo pod)
node apps/cli/bin/tcs.mjs run --docker --source examples/tests --rule-file examples/rules/unit-only.json
```

## Replay scenario

1. Create a "Unit" campaign (source = this folder, rule `unit-only.json`) and
   launch it: `strings` fails → the run **fails**.
2. Open the run in the portal → "↻ retry" on `unit/strings` only: only the
   failure is re-executed (targeted `argo retry` under the hood).
3. Fix the test (`FORCE_PASS=true` in the metadata env, or fix the code),
   then click **"↻ Replay campaign"**: a new run with **the exact same test
   snapshot**, comparable via the **diff** view (the test moves from
   failed → passed = "fixed").
