const core = require('@actions/core');
const github = require('@actions/github');

const { find } = require('min-dash');

const { getNextAssignee } = require('../shared/util.js');

const semver = require('semver');


async function run() {

  const MODERATORS = await require('../shared/moderators');

  const RELEASE_TEMPLATE_CONFIG = {
    templatePath: core.getInput('template-path'),
    packagePath: core.getInput('package-path')
  };

  const issue = github.context.payload.issue;

  const repository = github.context.payload.repository;

  const token = core.getInput('token');

  const labels = core.getInput('labels');

  const octokitRest = github.getOctokit(token).rest;

  const _getNextMinor = async function() {
    const { data } = await octokitRest.repos.getContent({
      repo: repository.name,
      owner: repository.owner.login,
      path: RELEASE_TEMPLATE_CONFIG.packagePath
    });

    if (!data || !data.content) {
      return;
    }

    const encoded = Buffer.from(data.content, 'base64');
    const currentVersion = JSON.parse(encoded.toString('utf-8')).version;
    return semver.inc(currentVersion, 'minor');
  };

  const _getIssueTitle = async function() {
    const version = await _getNextMinor();
    const newTitle = `Release ${repository.name} v${version}`;
    return newTitle;
  };

  const _getTemplate = async (options) => {
    const { data } = await octokitRest.repos.getContent({
      repo: repository.name,
      owner: repository.owner.login,
      path: RELEASE_TEMPLATE_CONFIG.templatePath
    });

    if (!data || !data.content) {
      return;
    }

    const encoded = Buffer.from(data.content, 'base64');

    return withoutPrelude(encoded.toString('utf-8'));
  };

  const _getIssues = async (options) => {
    options = {
      owner: repository.owner.login,
      repo: repository.name,
      ...options
    };

    return await octokitRest.issues.listForRepo(options);
  };

  const _createIssue = async (options) => {

    options = {
      owner: repository.owner.login,
      repo: repository.name,
      ...options
    };

    return await octokitRest.issues.create(options);
  };

  const _createIssueComment = async (options) => {

    options = {
      owner: repository.owner.login,
      repo: repository.name,
      ...options
    };

    return await octokitRest.issues.createComment(options);
  };



  if (!hasReleaseLabel(issue)) {
    core.info('not a release issue, quitting');

    return;
  }

  // set title to upcoming release
  const title = await _getIssueTitle();

  // don't create release issue twice
  const {
    data: issues
  } = await _getIssues({ state: 'all' });

  if (alreadyCreated(title, issues)) {
    core.info('issue already created, quitting');

    return;
  }

  // assign next release commander
  const {
    login: nextReleaseCommander,
  } = getNextAssignee(MODERATORS, issue.assignee) || {};

  // create weekly note body
  const body = await _getTemplate();

  // create new issue
  const {
    data: createdIssue
  } = await _createIssue({
    body,
    title,
    labels: labels.split(',').map(l => l.trim()),
    assignees: [ nextReleaseCommander ]
  });

  core.setOutput('assignee', nextReleaseCommander);

  // add comment to closed issue for next moderator
  await _createIssueComment({
    issue_number: issue.number,
    body: `Created [follow up release issue](${createdIssue.html_url}).

Assigned @${nextReleaseCommander} as the next release commander.`
  });

}

run();

// helper ////////////////

function hasReleaseLabel(issue) {
  const {
    labels
  } = issue;

  return !!find(labels, (l) => l.name === 'release');
}

function alreadyCreated(title, issues) {
  return !!find(issues, (i) => i.title === title);
}


function withoutPrelude(template) {
  const withoutPreludeOpening = template.replace('---', '');
  const preludeEnding = withoutPreludeOpening.indexOf('---');

  return withoutPreludeOpening.substring(preludeEnding + 3).trimStart();
}
