const core = require('@actions/core');
const github = require('@actions/github');

const find = require('min-dash').find;

const {
  getWeek
} = require('./util');

let MODERATORS;

async function run() {

  MODERATORS = await require('../shared/moderators');

  const WEEKLY_TEMPLATE_LOCATION = {
    path: core.getInput('template-path')
  };

  const issue = github.context.payload.issue;

  const repository = github.context.payload.repository;

  const token = core.getInput('token');

  const includeCommunityWorker = core.getInput('community-worker') === 'true';

  const roles = core.getInput('roles')
    .split(',')
    .map(r => r.trim())
    .filter(r => includeCommunityWorker || r !== 'community-worker'); // for backwards compatibility

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

  if (!hasWeeklyLabel(issue)) {
    return;
  }

  // set title to upcoming calendar week + year
  const title = getIssueTitle();

  // don't create weekly twice
  const {
    data: issues
  } = await _getIssues({ state: 'all' });

  if (alreadyCreated(title, issues)) {
    return;
  }

  const assignedRoles = roles.map((role, index) => {
    return {
      role,
      ...getNextRoundRobin(issue, index + 1)
    };
  });


  // create weekly note body
  const body = await createWeeklyNote(issue.url, assignedRoles);

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

  async function createWeeklyNote(previousIssueURL, roles) {

    const response = await octokitRest.repos.getContent({
      repo: repository.name,
      owner: repository.owner.login,
      path: WEEKLY_TEMPLATE_LOCATION.path
    });

    const encoded = Buffer.from(response.data.content, 'base64');

    let weeklyNote = encoded.toString('utf-8');

    // substitute roles
    roles.forEach(({ login, role }) => {
      weeklyNote = weeklyNote.replaceAll(`{{${role}}}`, `@${login}`);
    });

    weeklyNote = weeklyNote.replaceAll('{{previousIssueURL}}', `${previousIssueURL}`);
    weeklyNote = withoutPrelude(weeklyNote);

    return weeklyNote;
  }
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

function getIssueTitle() {
  const weekInterval = core.getInput('week-interval'),
        currentWeek = getCurrentWeek(),
        currentWeekNr = currentWeek.weekNumber,
        currentYearNr = currentWeek.year,
        upcomingWeekNr = (currentWeekNr + weekInterval - 1) % 52 + 1,
        upcomingYearNr = upcomingWeekNr == 1 ? currentYearNr + 1 : currentYearNr;

  return `W${upcomingWeekNr} - ${upcomingYearNr}`;
}

function getNextRoundRobin(closedIssue, offset = 1) {
  function transformIntoBounds(idx, length) {
    return idx >= length ? transformIntoBounds(idx - length, length) : idx;
  }

  const {
    assignee
  } = closedIssue;

  if (!assignee) {
    return;
  }

  const lastAssignee = find(MODERATORS, m => m.login === assignee.login);

  // ensure assignee was a valid moderator
  if (!lastAssignee) {
    return;
  }

  return MODERATORS[transformIntoBounds(lastAssignee.idx + offset, MODERATORS.length)];
}


/**
 * @param {string} weeklyTemplate
 */
function withoutPrelude(weeklyTemplate) {
  const withoutPreludeOpening = weeklyTemplate.replace('---', '');
  const preludeEnding = withoutPreludeOpening.indexOf('---');

  return withoutPreludeOpening.substring(preludeEnding + 3).trimStart();
}
