# bpmn-io-actions

[![CI](https://github.com/bpmn-io/actions/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/actions/actions/workflows/CI.yml)

This repository contains the GitHub Actions used by the bpmn-io team.

The latest version is built and published to the `latest` branch continuously.

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
       uses: bpmn-io/actions/release-issue@latest
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
       uses: bpmn-io/actions/weekly-notes@latest
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
