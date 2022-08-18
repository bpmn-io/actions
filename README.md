# bpmn-io-actions

This repository contains the GitHub Actions used by the bpmn-io team.

The latest version is built and published to the `latest` branch continuously.

## release-issue

Automatically create the issue for the next release.

Parameters:
  - `template-path`: Path to the template file. Default: `.github/ISSUE_TEMPLATE/RELEASE.md`
  - `package-path`: Path to the package.json (used for next version number). Default: `package.json`

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
     - if: contains(github.event.issue.labels.*.name, 'weekly')
       name: Create new Issue
       uses: bpmn-io/bpmn-io-actions/weekly-notes@latest
       with:
         template-path: '.docs/RELEASE.md'
         package-path: 'app/package.json'
```


## weekly-notes

Automatically create the issue for the next modeling weekly.
Parameters:
  - `template-path`: Path to the template file. Default: `.github/ISSUE_TEMPLATE/WEEKLY_NOTE.md`

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
    steps:
     - if: contains(github.event.issue.labels.*.name, 'weekly')
       name: Create new Issue
       uses: bpmn-io/bpmn-io-actions/weekly-notes@latest
       with:
         template-path: '.docs/WEEKLY_TEMPLATE.md'
```