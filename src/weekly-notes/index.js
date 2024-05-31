const core = require('@actions/core');
const github = require('@actions/github');

const {
  find
} = require('min-dash');

const {
  getWeek,
  getNextIssueTitle
} = require('./util');

const { getNextAssignee } = require('../shared/util');

async function run() {

  const MODERATORS = await require('../shared/moderators');

  const WEEKLY_TEMPLATE_PATH = core.getInput('template-path');

  const issue = github.context.payload.issue;

  const repository = github.context.payload.repository;

  const token = core.getInput('token');

  const includeCommunityWorker = core.getBooleanInput('community-worker');

  const octokitRest = github.getOctokit(token).rest;
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

  const _createWeeklyNote = async (previousIssueURL, assignedRoles) => {

    const response = await octokitRest.repos.getContent({
      repo: repository.name,
      owner: repository.owner.login,
      path: WEEKLY_TEMPLATE_PATH
    });

    const encoded = Buffer.from(response.data.content, 'base64');

    let weeklyNote = encoded.toString('utf-8');

    // substitute roles
    assignedRoles.forEach(({ role, login }) => {
      weeklyNote = weeklyNote.replaceAll(`{{${role}}}`, `@${login}`);
    });

    weeklyNote = weeklyNote.replaceAll('{{previousIssueURL}}', `${previousIssueURL}`);
    weeklyNote = withoutPrelude(weeklyNote);

    return weeklyNote;
  };

  if (!hasWeeklyLabel(issue)) {
    return;
  }

  const currentWeek = getCurrentWeek();
  const weekInterval = parseInt(core.getInput('week-interval'), 10);

  // set title to upcoming calendar week + year
  const title = getNextIssueTitle(
    weekInterval,
    currentWeek
  );

  // don't create weekly twice
  const {
    data: issues
  } = await _getIssues({ state: 'all' });

  if (alreadyCreated(title, issues)) {
    return core.setFailed(`Issue ${ title } already exists`);
  }

  const roles = core.getInput('roles')
    .split(',')
    .map(r => r.trim())
    .filter(r => includeCommunityWorker || r !== 'community-worker'); // for backwards compatibility

  const assignedRoles = roles.map((role, index) => {
    return {
      role,
      ...getNextAssignee(MODERATORS, issue.assignee, index + 1)
    };
  });

  // create weekly note body
  const body = await _createWeeklyNote(issue.url, assignedRoles);

  // create new issue
  const assignees = assignedRoles.map(({ login }) => login);

  const {
    data: createdIssue
  } = await _createIssue({
    body,
    title,
    labels: [ 'weekly', 'ready' ],
    assignees
  });

  const nextRoleMessage = assignedRoles.map(({ role, login }) => {
    return `@${login} as next ${role.replaceAll('-', ' ')}`;
  }).join(', ');

  // add comment to closed issue for next moderator
  await _createIssueComment({
    issue_number: issue.number,
    body: `Created [follow up weekly notes](${createdIssue.html_url}).

Assigned ${nextRoleMessage}.`
  });

  // output role assignments
  assignedRoles.forEach(({ role, login }) => {
    core.setOutput(`${role}-assignee`, login);
  });

  core.setOutput('html-url', createdIssue.html_url);
}

run();

// helper ////////////////

function hasWeeklyLabel(issue) {
  const {
    labels
  } = issue;

  return !!find(labels, (l) => l.name === 'weekly');
}

function alreadyCreated(weeklyTitle, issues) {
  return !!find(issues, (i) => i.title === weeklyTitle);
}

function getCurrentWeek() {
  return getWeek(new Date());
}

/**
 * @param {string} weeklyTemplate
 */
function withoutPrelude(weeklyTemplate) {
  const withoutPreludeOpening = weeklyTemplate.replace('---', '');
  const preludeEnding = withoutPreludeOpening.indexOf('---');

  return withoutPreludeOpening.substring(preludeEnding + 3).trimStart();
}
