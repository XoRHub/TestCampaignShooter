# User guide — TestCampaignShooter portal

This guide is for **portal users** (QA, developers, managers): how to log
in, create and launch campaigns, track runs, retry failures, schedule
automatic launches, and analyze results.

> Technical aspects (the full API, formats, deployment) are covered
> elsewhere: [functional.md](functional.md) (concepts),
> [technical.md](technical.md) (API/interfaces),
> [deployment.md](deployment.md) (install/configuration),
> [getting-started.md](getting-started.md) (developer runbook).

---

## 1. Logging in / getting an account

Open the portal URL your team gave you (in dev:
http://localhost:3000). The login screen **adapts to whichever
authentication methods are active** on the server — you'll see one or the
other (or both):

- **"Log in with SSO (OIDC)"** — authentication via your organization's
  directory (Keycloak, Azure AD, Google, Okta…). **There's nothing to sign
  up for**: on your **first SSO login, your account is created
  automatically** (name, email and roles taken from the directory, then
  resynced on every login). Without a role provided by the directory, you
  start as `viewer` — ask an administrator (or the directory team) for an
  elevation if needed.
- **Email + password** — local accounts. There's **no self-registration**:
  local accounts are created by an administrator (the first admin account
  is provisioned when the server starts; in a dev environment:
  `admin@example.com` / `admin`).

The session lasts 12 hours by default; past that, the portal asks you to
log in again. **Logging out**: the logout button in the navigation bar.

### Roles and permissions

| Action                                                   | `viewer` |   `editor`    | `admin` |
| -------------------------------------------------------- | :------: | :-----------: | :-----: |
| View campaigns, runs, results, logs, diffs, dashboards   |    ✔     |       ✔       |    ✔    |
| Preview a selection rule                                 |    ✔     |       ✔       |    ✔    |
| Create a campaign                                        |          |       ✔       |    ✔    |
| Edit / delete / schedule a campaign                      |          | **their own** |   all   |
| Launch, replay, retry, cancel a run                      |          |       ✔       |    ✔    |
| Create a project, see/manage the ones you belong to (§3) |          |       ✔       |    ✔    |
| Manage adapter manifests (instance or campaign, §10)     |          |               |    ✔    |

Every campaign shows its **creator**, every run its **trigger** — only the
creator (or an admin) can edit or delete a campaign. If a button doesn't
show up (e.g. "▶ Launch"), it's because your role doesn't allow it.

---

## 2. Preparing your tests

The portal doesn't host the tests: it **discovers them in a source** that
you point the campaign at — a **git repo** (recommended, mandatory in an
Argo production setup) or a **local folder / .zip** (dev only).

Every test file must be accompanied by a
**`<test_name>.metadata.json`** file next to it:

```jsonc
{
  "engine": "cypress", // REQUIRED: execution engine
  "execution": {
    // optional: the engine has defaults
    "command": ["npx", "cypress", "run", "--spec", "{{testFile}}"],
    "timeoutSeconds": 600,
  },
  // FREE-FORM properties — your campaigns select on these:
  "tags": ["smoke", "checkout"],
  "team": "payments",
  "criticality": 3,
  "flaky": false,
}
```

- **Available engines**: Robot Framework, Selenium, Cypress, Protractor
  (deprecated), and the generic Java, Node.js and Python runners (Jest,
  pytest, Maven…). The exact list is visible in the campaign form.
- **Free-form properties**: `tags`, `team`, `criticality`… or any key of
  your choosing — they feed the selection rules (§4).
- Detailed format, per-engine defaults and placeholders:
  [functional.md § metadata.json format](functional.md#metadatajson-format).

If a metadata file is invalid (broken JSON, unknown engine, duplicate
id…), the test doesn't block the others: the issue shows up in the
**"Discovery issues"** area of the preview, with the file and the cause.

---

## 3. Projects (optional workspace)

A **project** groups campaigns and restricts who can see them — useful for
a team or a client whose campaigns shouldn't be visible to everyone. It's
entirely optional: a campaign with no project stays visible to any
`viewer`, exactly as before this feature existed. (API/portal only — not
available from the CLI.)

From the **Projects** page (`editor` role to create one):

1. **"+ New project"**: name + optional description. You become its
   **creator**.
2. On a project's page, **add members** by email (they must already have
   an account) — a member gets the same **view** access as you to every
   campaign in the project. Only you (the creator) or an admin can add/
   remove members, rename/delete the project, or edit/delete a campaign
   you didn't personally create inside it.
3. When creating or editing a campaign, pick the project in the
   **"Project"** field of the form (or leave it on "None"). You can only
   attach a campaign to a project you already have access to.
4. **Deleting** a project is logical as soon as it has campaigns (same
   spirit as campaign deletion) — history stays browsable.

> If you don't see a campaign you expect in the main **Campaigns** list,
> check whether it belongs to a project you're not a member of — ask its
> creator (visible on the project's page) to add you.

---

## 4. Creating a campaign

From the **Campaigns** page → **"+ New campaign"** (`editor` role
required). The form has five sections:

1. **Identity** — name, description, **parallelism** (number of tests run
   simultaneously, 1–200), and an optional **project** (§3).
2. **Automatic scheduling (cron)** — optional, see §5.
3. **Test source**:
   - **Git repo**: repo URL + optional revision (branch, tag or SHA —
     empty = default branch). Private repos are handled server-side (a
     token configured by administrators).
   - **Local folder (dev)**: the **absolute** path to a folder (or a
     `.zip`) visible to the server — dev only.
4. **Selection rule** — the heart of a campaign (below).

### The selection rule

A campaign is **not a fixed list of tests**: it's a **rule** evaluated
against the `metadata.json` properties on every launch. A newly tagged
`smoke` test automatically joins the "smoke" campaign — without editing
the campaign.

The **visual builder** lets you compose:

- **conditions**: `property` + operator + value. Operators: equal / not
  equal (`eq`, `ne`), in a list (`in`, `nin`), comparisons (`gt`, `gte`,
  `lt`, `lte`), `contains` (an array contains the value, or a string
  contains the substring), `matches` (regex), `exists` (the property is
  set). Dotted paths are accepted (e.g. `execution.image`);
- **groups**, nestable as deep as you like: **AND** (all conditions),
  **OR** (at least one), **NOT** (inversion);
- a **subtree** restriction: "only tests under `suites/checkout`".

Example: _smoke tests owned by the payments team **or** with criticality
≥ 3, non-flaky, under `suites/`_.

### Previewing before creating

The **"Preview the selection"** button evaluates the rule immediately
against the source and shows:

- the number of tests **selected / discovered**, with the list (name,
  file, engine);
- any **discovery issues** (⚠): invalid metadata, unknown engine, an
  "orphaned" test with no metadata…

Adjust the rule until you get the selection you want, then **"Create
campaign"**.

> **Editing later**: the "Edit" button on the campaign's page. Every edit
> increments the **version**; past runs remember which version they ran.
> **Deleting**: deletion is logical as soon as a run exists (history stays
> browsable, "deleted" badge).

---

## 5. Scheduling automatic launches (cron)

In the campaign form, the **"Automatic scheduling (cron)"** section:

1. enter a **5-field cron expression** (`minute hour day month
day-of-week`):
   - `*/30 * * * *` — every 30 minutes;
   - `0 3 * * *` — every night at 3am;
   - `0 6 * * 1-5` — at 6am, Monday through Friday;
   - `0 8 * * 1` — Mondays at 8am;
2. check **"Enable automatic scheduled launch"** (the checkbox is only
   active once an expression is entered);
3. save — an invalid expression is rejected on save.

The campaign then carries a **⏰** badge (in the list and detail page)
with the expression and the **next launch date**. Automatically triggered
runs show up in the history with the trigger **"Scheduler (cron)"**.

Good to know:

- if a run of the campaign is **still in progress** at the scheduled time,
  the tick is **skipped** (no run stacking);
- uncheck the box (or clear the expression) to suspend scheduling — the
  campaign stays launchable manually;
- the applied timezone is the one configured server-side
  (`SCHEDULER_TIMEZONE`, otherwise the server's own).

---

## 6. Launching a run and tracking it in real time

On a campaign's page: **"▶ Launch"**. The selection is re-evaluated right
then, frozen into a **snapshot** (audit trail, identical replay), and
you're redirected to the **run view**:

- **Overall progress**: done / remaining, an estimate of the time left.
- **A table, one row per test**, with a status badge: `pending`,
  `running`, then `succeeded`, `failed`, `error` (infrastructure error),
  `skipped`, `cancelled` — updated **live** (SSE), no refresh needed.
- **Logs**: a _logs_ button on each row → **live streaming** while the
  test runs, then the full log is downloadable.
- At the end of the run, the table switches to the **persisted results**
  from the aggregated JUnit report: final status, **duration** and
  **failure message** per test. These results stay visible when reopening
  the run later.

The run's header recalls the trigger, the date, the execution provider,
the parallelism, and the campaign version that ran.

---

## 7. Retrying, cancelling, replaying

From the run view (`editor` role):

- **Targeted retry**: the **↻** button on a failing test's row — only
  that test is re-executed (same node identity, history stays coherent).
- **"Retry N failure(s)"**: re-executes every currently failing test in
  the run at once, and only those.
- **Cancel**: stops the running run; tests that hadn't started move to
  `cancelled`.
- **"↻ Replay campaign"**: creates a **new run from the current run's
  exact snapshot** — same test list, same revision — ideal to verify a fix
  or confirm a flaky test. (Replaying via the API additionally lets you
  override the parallelism or the git revision.)

> Retry and replay never modify a past run: retry updates the current run,
> replay creates a separate one.

---

## 8. Analyzing results

### A run's results

Every run keeps its per-test results (status, duration, failure message)
and offers:

- **"⬇ Aggregated JUnit"**: downloads the run's single JUnit XML report
  (usable by your CI/quality tools);
- the list of produced **artifacts** (reports, screenshots…).

### Comparing two runs (diff)

**"⇄ Compare to previous run"** shows the delta between the current run
and the previous one from the same campaign:

- **regressions** — used to pass, now fail;
- **fixed** — used to fail, now pass;
- **new** / **gone** — tests that entered or left the selection;
- **Δ duration** per test.

This is the go-to tool after a deployment: "what broke?".

### Campaign dashboards

A campaign's page shows:

- summary **tiles** for the latest run (tests, passed, failed, total
  duration);
- **per-run trends**: success rate (%) and total duration — click a bar
  to open the matching run;
- the **run history**: status, trigger (a user or "Scheduler (cron)"),
  date, result count, campaign version.

---

## 9. Frequently asked questions

| Situation                                                        | Explanation / action                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I don't see the "Launch" / "+ New campaign" buttons              | Your role is `viewer` — ask an administrator for `editor` (or via the SSO directory).                                                                                      |
| "only the campaign creator or an admin can modify it"            | You're not the campaign's creator (nor its project's creator, if it belongs to one, §3): ask the owner or an admin.                                                        |
| I'm sent back to the login screen                                | Session expired (12h by default) — log in again.                                                                                                                           |
| The preview shows 0 selected tests                               | Check the rule (a typo in a property/value, an overly restrictive `pathUnder`) and that the `metadata.json` files actually carry the expected properties.                  |
| ⚠ in "Discovery issues"                                          | A metadata file is invalid (JSON, schema, unknown engine, duplicate id) or a test has no metadata — fix the indicated file; other tests aren't blocked.                    |
| Can't use a local folder as a source                             | Expected in production (Argo): tests must be in a **git repo** visible to the cluster.                                                                                     |
| The run stays `pending` for a long time                          | Execution isn't starting on the infrastructure side (image not found, saturated cluster…) — report it to the ops team with the run id.                                     |
| No detailed results after a run finishes                         | The aggregated report never made it back to the server — a case covered in [getting-started.md § Troubleshooting](getting-started.md#7-troubleshooting) (for operators).   |
| The scheduled launch didn't happen                               | A run of the campaign was still in progress at the scheduled time (tick skipped), scheduling is unchecked, or the scheduler is disabled server-side (`SCHEDULER_ENABLED`). |
| I don't see a campaign I expect in the list                      | It probably belongs to a **project** (§3) you're not a member of — ask its creator to add you.                                                                             |
| I can't attach a campaign to a project I can see mentioned       | You need to belong to that project (creator, member, or admin) to attach a campaign to it — ask its creator to add you as a member first.                                  |
| I don't see the "Manifests" page or the "Adapter manifest" field | Restricted to the `admin` role (§10), even if you're an `editor` on your campaigns.                                                                                        |
| Launching a campaign fails with an "adapter manifest: …" error   | The manifest attached to the campaign (§10) is unreachable or invalid — fix the URL or its content; the run is deliberately not launched with default values instead.      |

---

## 10. Custom test engines via manifest (admin)

Beyond the built-in engines (§2), you can **add or override engines
without a server update**, via a **manifest** — a declarative JSON/YAML
file hosted at a URL (a git repo, an internal server…). Two scopes, two
places:

### Instance level — every run, for everyone

The **"Manifests"** page in the navigation (visible to the `admin` role
only):

1. Paste the **manifest URL** and **"+ Add"** — the server fetches it
   right away (a failure shows in red if the URL is unreachable or
   invalid, but the manifest stays registered for a later retry).
2. **"↻ Reload all"** — re-fetches every active manifest and rebuilds the
   list of available engines, **without restarting the server**.
3. **Delete** a manifest to remove its engines (unless they're also
   provided by another active manifest).

Each row shows the last fetch time, a hash (a fingerprint of the
downloaded content), and the last error if any.

### Campaign level — a single campaign

In the campaign form, the **"Adapter manifest"** section (visible to the
`admin` role only): an optional URL that overrides or adds engines **for
that campaign's runs only**, without affecting other campaigns. It's
resolved **once, at run launch** — an already-launched run is never
affected by a later change to the manifest, and "↻ Replay" reuses exactly
what was resolved.

> **Why admin-only?** An engine defined by a manifest can run any command
> — including, under the `local` (process) provider, **directly on the
> server host**. That's why only an admin can attach a manifest (instance
> or campaign), even though the rest of a campaign stays editable by its
> `editor` creator.

### From the command line (CLI, no server)

The `--adapter-manifest <url>` flag works with `discover`, `preview`,
`run` and `engines`:

```bash
tcs engines --adapter-manifest https://example.com/adapters/manifest.yaml

tcs run --source ./my-tests --adapter-manifest https://example.com/adapters/manifest.yaml \
  --rule '{"prop":"tags","op":"contains","value":"smoke"}'
```

The manifest only applies **to that one invocation** (every `tcs` command
is an independent process) — nothing is persisted.

Manifest format (full reference: [adapter-plugins.md](adapter-plugins.md)):

```yaml
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: playwright
    displayName: Playwright (Node)
    defaultImage: mcr.microsoft.com/playwright:v1.48.0-noble
    defaultJunitPath: results/junit.xml
    defaultCommand: [npx, playwright, test, '{{testFile}}', --reporter=junit]
```

---

## 11. Going further: API and CLI

Everything the portal does is available as a **REST API** (CI/CD
integration: launching a campaign after a deployment, fetching the
diff…) — see [technical.md](technical.md) and the full curl walkthrough in
[getting-started.md §3.3](getting-started.md#33-the-same-walkthrough-via-pure-api-curl).
A **CLI** (`tcs discover|preview|run|engines`) also lets you validate your
metadata and rules locally, with no server
([getting-started.md §2](getting-started.md#2-test-locally-without-deploying-anything-the-cli)).
