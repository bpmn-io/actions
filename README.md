# bpmn-io-actions

SOME CHANGE
[![CI](https://github.com/bpmn-io/actions/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/actions/actions/workflows/CI.yml)

This repository contains the GitHub Actions used by the bpmn-io team.

Consume an action via `latest`, a version tag, or a commit SHA.

## `pull-request-quality`

Ensures an opened pull request follows basic hygiene:

* Pull request template used (if provided)
* Clean and conventional commit history on branch

The action creates check annotations for failing checks and a job summary.
Contributors shall use the information to refine their contribution.
Once corrected, a later run passes. The action never checks out or closes pull requests.

### Checks

- `uses-template`: pull request uses the project template (explicit
  `template-path`, project-local, or `bpmn-io/.github`). Skipped if no template
  exists.
- `checklist-preserved`: every template checklist item remains in the body
  (checked or unchecked, but not removed).
- `screenshot-media`: when a checked `Screenshots added` item is present, the body
  embeds inline media (GitHub user-attachment image or video); ordinary Markdown
  links do not count.
- `clean-history`: no merge, fixup, squash, or work-in-progress commits, and at
  most 50 commits on the branch.
- `conventional-commits`: every non-merge commit subject follows
  [Conventional Commits](https://www.conventionalcommits.org)
  (`type(optional scope): description`).
- `closes-statement` (warning only): at least one commit **body** closes an issue,
  for example `Closes #123`. Never fails the gate.

All checks are enabled by default. Disable one by setting its `check-<id>` input
to `false` (e.g. `check-clean-history: false`); internally these map to a per-check
config keyed by the same ids as the `checks` output.

### Parameters

- `template-path`: optional alternative or fallback template path.
- `check-<id>`: set to `false` to disable the check with that id (see Checks).
  Default `true`.
- `token`: token for GitHub API reads (template and commits). Defaults to
  `github.token`.

### Outputs

- `valid`: `true` when every enabled, gating check passes; otherwise `false`.
  Warn-only checks (`closes-statement`) never make this `false`.
- `template-url`: The exact template URL used for validation, if a template was
  found.
- `checks`: A JSON map of check id to `{ "valid": boolean, "message"?: string }`
  for checks that ran, or `{ "status": "skipped" }` for disabled or inapplicable
  checks. The `message` is only present on failure.

### Usage

```yml
# .github/workflows/PULL_REQUEST_QUALITY.yml
name: Check pull request quality
on:
  pull_request:
    types: [opened, edited, reopened, synchronize]

permissions:
  contents: read
  pull-requests: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Validate PR
        uses: bpmn-io/actions/pull-request-quality@v1
```

### Permissions

The action runs on the standard `pull_request` trigger and never checks out or
executes pull request code — it reads the template (from the base commit) and the
pull request commits through the GitHub API only. It needs:

- `contents: read` — to read the pull request template.
- `pull-requests: read` — to list the pull request commits.

Failures are reported as check annotations and a job summary, which need no
additional token permissions and appear on every pull request, including
contributions from forks.

## `release-issue`

Automatically create the issue for the next release.

### Parameters

- `template-path`: Path to the template file. Default: `.github/ISSUE_TEMPLATE/RELEASE.md`
- `package-path`: Path to the package.json (used for next version number). Default: `package.json`
- `moderators-path`: Optional path to the moderators file. Defaults to the bpmn-io moderators.
- `labels`: A comma-separated list of the labels you want to assign in the release issue.

### Outputs

- `assignee`: Person assigned, if assignment took place

### Usage

```yml
# .github/workflows/RELEASE_ISSUE.yml
name: Release Issue
on:
  issues:
    types: [closed]
jobs:
  createReleaseIssue:
    runs-on: ubuntu-latest
    steps:
     - if: contains(github.event.issue.labels.*.name, 'release')
       name: Create new Issue
       uses: bpmn-io/actions/release-issue@v1
       with:
         template-path: '.docs/RELEASE.md'
         package-path: 'app/package.json'
         labels: 'release,ready'
```

## `weekly-notes`

Automatically create the issue for the next modeling weekly.

### Parameters

- `template-path`: Path to the template file. Default: `.github/ISSUE_TEMPLATE/WEEKLY_NOTE.md`
- `moderators-path`: Optional path to the moderators file. Defaults to the bpmn-io moderators.
- `roles`: A comma-separated list of the roles you want to assign in the weekly.
- `week-interval`: The time (in weeks) between two weeklies. Usefuly for biweekly and other cadences.
- `title-template`: Optional issue title template literal that can reference the `{{week}}` and the `{{year}}`.
- `label`: Label used to identify the issue. Defaults to: `weekly`.

### Outputs

- `moderator-assignee`: Moderator assigned, if assignment took place
- `summary-writer-assignee`: Summary writer assigned, if assignment took place
- `community-worker-assignee`: Community worker assigned, if assignment took place
- `html-url`: URL of the newly created weekly note, if one got created

### Usage

```yml
# .github/workflows/WEEKLY.yml
name: Weekly
on:
  issues:
    types: [closed]
jobs:
  createReleaseIssue:
    runs-on: ubuntu-latest
    if: contains(github.event.issue.labels.*.name, 'weekly')
    outputs:
      community-worker-assignee: ${{ steps.create-issue.outputs.community-worker-assignee }}
      html-url: ${{ steps.create-issue.outputs.html-url }}
    steps:
    -  name: Create new Issue
       id: create-issue
       uses: bpmn-io/actions/weekly-notes@v1
       with:
         template-path: '.docs/WEEKLY_TEMPLATE.md'
         roles: 'moderator,summary-writer,community-worker'

```

### Template file syntax

The template file support the following placeholders:

* `{{previousIssueURL}}`: this will be replace by the URL of the previous weekly issue
* `{{$role}}`: a placeholder containing one of the specified role (from the `roles` input of the action) will be replaced by the GitHub handler of the person who has been assigned this role.

Also, the Markdown preamble will be parsed out and removed from the final issue body.

For instance:

```markdown
---
name: Weekly meeting
about: Create a new weekly team meeting note.
labels:
  - weekly
---

### Roles this week

| Role | DRI |
|---|---|
| Moderator | {{moderator}} |
| Summary Writer | {{summary-writer}} |

⇨ Previous weekly meeting: {{previousIssueURL}}

### Agenda

* [ ] Discuss weekly things!
```


## `setup`

Setup your runner so things just work.

### Parameters

*None*

### Outputs

*None*

### Usage

```yml
# .github/workflows/CI.yml
name: CI
on: [ push, pull_request ]
jobs:
  build:
    strategy:
      matrix:
        os: [ ubuntu-latest ]
    runs-on: ${{ matrix.os }}
    steps:
    ...
    - name: Project setup
      uses: bpmn-io/actions/setup@v1
    - name: Build project
      run: npm run build
```

## Build and Run

Prepare the project by installing all dependencies:

```sh
npm install
```

Then, depending on your use-case, you may run any of the following commands:

```sh
# lint, test and build the actions
npm run all

# run all tests
npm test

# build the action bundles
npm run build
```

## Releasing

Run the **Publish a versioned release** workflow (`RELEASE_VERSION.yml`) with the
target version (`X.Y.Z`, no leading `v`). It tags `main`, moves the `vX` alias, and
publishes a GitHub release.
