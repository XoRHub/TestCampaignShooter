# Functional documentation

> For the step-by-step portal walkthrough (logging in, creating campaigns,
> tracking, retries), see the [user guide](user-guide.md).

## Overview

TestCampaignShooter orchestrates **test campaigns**: it discovers multi-engine
tests in a source (a git repo or a folder), **selects them by rule** on their
metadata, runs them **in parallel on Kubernetes via Argo Workflows** (one pod
per test), aggregates the results into a single **JUnit** report, persists
them, and visualizes them in a real-time portal.

## Use cases

- QA: smoke/regression/nightly campaigns defined by tags rather than fixed
  lists — newly tagged tests are picked up automatically.
- Teams: "all my team's tests with criticality ≥ 3, excluding flaky ones".
- CI/CD: launching a campaign via an API call after a deployment, automatic
  comparison against the previous run (regressions).
- Debugging: targeted retry of only the failing tests, live logs.

## Campaign lifecycle

1. **Creation** (portal or API): name, test source, selection rule,
   parallelism. The campaign is linked to its **creator** (`createdBy`) and,
   optionally, to a **project** (see § Projects below) that further
   restricts who can see and act on it.
2. **Preview**: the rule is evaluated immediately against the source —
   list of matched tests + metadata issues.
3. **Launch**: manual (portal/API/CI) **or automatic** — every campaign can
   carry a **cron schedule** (`0 6 * * 1-5`, `@hourly`…) that can be
   enabled/disabled; the scheduler then launches the campaign at the
   scheduled times (scheduled runs are attributed to the system account
   "Scheduler (cron)", and a tick is skipped while a run of the campaign is
   still in progress). The selection is evaluated **at launch time** and
   frozen into a **snapshot** (audit + identical replay). Every run keeps its
   trigger (`triggeredBy`) and timestamp.
4. **Execution**: one Argo node per test, controlled parallelism, final
   JUnit aggregation even when there are failures.
5. **Real-time tracking**: progress, per-test state (pending / running /
   done — succeeded, failed, cancelled, timeout), streamed logs, targeted
   retry.
6. **Analysis**: results filterable by run/date/status/engine, **diff**
   against the previous run (regressions, fixes, new, gone, Δ duration),
   per-campaign dashboards.
7. **Replay**: identical (same snapshot) or with overrides (parallelism,
   git revision).
8. **Update/delete**: every update increments the `version` (runs remember
   the version they ran); deletion is **logical** as soon as a run exists.

## Defining a campaign by selection rule

A campaign is **not a list of tests**: it's a **boolean rule** evaluated
against the `metadata.json` properties across the whole tree.

- Composition operators: **AND** (`all`), **OR** (`any`), **NOT** (`not`),
  **nestable to arbitrary depth**.
- Elementary conditions: `eq, ne, in, nin, gt, gte, lt, lte, contains,
matches (regex), exists` on any property (dotted paths allowed,
  e.g. `execution.image`).
- **Subtree** restriction: `{ "pathUnder": "suites/checkout" }`, combinable
  with the rest.

Example — "smoke tests owned by the payments team or critical, non-flaky,
under `suites/`":

```json
{
  "all": [
    { "pathUnder": "suites" },
    { "prop": "tags", "op": "contains", "value": "smoke" },
    {
      "any": [
        { "prop": "team", "op": "eq", "value": "payments" },
        { "prop": "criticality", "op": "gte", "value": 3 }
      ]
    },
    { "not": { "prop": "flaky", "op": "eq", "value": true } }
  ]
}
```

The portal provides a **visual rule builder** with a **live preview** of the
matched tests.

## `metadata.json` format

Each test file `<file>` is accompanied by `<file>.metadata.json`:

```jsonc
{
  "id": "checkout/smoke", // optional — defaults to the file's relative path
  "name": "Checkout smoke", // optional — defaults to the file name
  "engine": "cypress", // REQUIRED: id of a registered adapter
  "execution": {
    // technical fields (strictly validated)
    "image": "cypress/included:13.17.0",
    "command": ["npx", "cypress", "run", "--spec", "{{testFile}}"],
    "junitPath": "results/junit.xml",
    "timeoutSeconds": 600,
    "env": { "BASE_URL": "https://staging.example.com" },
    "resources": { "cpu": "500m", "memory": "1Gi" },
    "workingDir": "sub/dir",
  },
  // ——— FREE-FORM properties (the schema is open) — feed the selection rules ———
  "tags": ["smoke", "checkout"],
  "team": "payments",
  "criticality": 3,
  "category": "e2e",
  "platform": "chrome",
  "environments": ["staging", "prod"],
  "owner": "alice@example.com",
  "flaky": false,
}
```

- The `{{testFile}}` and `{{testId}}` placeholders are substituted into the
  command.
- Each engine provides **defaults** (image, command, junitPath); the generic
  runners (`generic-java|node|python`) require an explicit `command`.
- At discovery time, every metadata file is **validated**: invalid JSON,
  schema violations, unknown engines, duplicate ids, and "orphaned" test
  files (no metadata) are all reported as explicit issues without blocking
  the rest.

## Supported engines (v1)

Robot Framework, Selenium, Cypress, Protractor _(deprecated — isolated, to be
migrated away from)_, and the generic **Java** (Maven/Gradle: JUnit,
TestNG…), **Node.js** (Jest, Mocha, Playwright…) and **Python** (pytest,
unittest…) runners. The unified output format is **JUnit XML**. Beyond these
built-ins, engines can also be added or overridden at runtime via a
downloadable manifest, at the instance or campaign level — see
[adapter-plugins.md](adapter-plugins.md).

## Users, roles and authentication

- **Independently toggleable authentication methods**:
  - **OIDC** (Keycloak, Azure AD, Google, Okta…): on first login, the
    profile is **auto-provisioned from the claims** (JIT) then resynced on
    every subsequent login.
  - **Local password** (bcrypt hash), with a bootstrap admin account.
  - The portal **adapts its login screen** to whichever methods are active.
- **Roles** (application-level RBAC, from OIDC claims or assigned locally):
  - `viewer`: read access (campaigns, runs, results, logs).
  - `editor`: + create/edit/delete **their own** campaigns, launch/replay/retry/cancel.
  - `admin`: + act on other users' campaigns.
- **Ownership**: every campaign shows its creator; every run shows its
  trigger (audit trail).

## Projects (API/portal only)

A **project** groups campaigns and restricts who can see them — a
lightweight workspace, layered on top of the roles above rather than
replacing them. Not available in the CLI (which never talks to the
server/DB).

- A project has a **creator** and any number of **members** (existing
  users, added by email).
- **Visibility**: only the creator, its members, and `admin`s can see a
  project and the campaigns inside it. A campaign with **no** project keeps
  today's behavior — visible to any `viewer`.
- **Mutation**: the project's creator (or an `admin`) can edit/delete the
  project, manage its members, and edit/delete **any** campaign inside it —
  on top of the usual rule (an `editor` can already edit/delete campaigns
  they created themselves, project or not).
- A project can be attached to a campaign by anyone who can already access
  that project (creator, member, or admin) — an `editor` can't attach a
  campaign to a project they have no access to.
- Deleting a project is **logical** as soon as it has campaigns (same
  spirit as campaign deletion): history stays browsable.

See [technical.md](technical.md) for the `/api/projects*` routes and the
`Project`/`ProjectMember` schema, and [user-guide.md](user-guide.md) for the
portal walkthrough.

## Portal

- **Projects**: list (yours + those you're a member of), create, manage
  members, and browse a project's campaigns from its page.
- **Campaigns**: list (creator, run count, project badge if any, ⏰ badge +
  next launch time for scheduled campaigns), full CRUD, visual rule builder
  - live preview, **cron scheduling** (expression + toggle), "Launch"
    button.
- **Real-time run view**: overall progress (done/remaining, ETA), per-test
  state (badges), **streamed logs** + download, **targeted retry** of one
  test or of all failures, cancellation, **replay**. At the end of the run,
  the table switches to the **persisted results** from the aggregated JUnit
  report (status, duration, failure message per test) — also available when
  coming back to a historical run later.
- **Analysis**: run-to-run diff, per-campaign dashboards (success rate and
  duration per run, summary tiles), artifacts, aggregated JUnit download.
