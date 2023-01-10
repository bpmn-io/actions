const core = require('@actions/core');
const github = require('@actions/github');

const find = require('min-dash').find;

const mailer = require('./mailer');

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

  const includeCommunityWorker = core.getInput('community-worker') == 'false' ? false : true;

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

  // assign next moderator
  const {
    login: nextModerator,
    fullName: nextModName
  } = getNextRoundRobin(issue, 1) || {};

  // assign next summary writer
  const {
    login: nextSummaryWriter,
    fullName: nextWriterName
  } = getNextSummaryWriter(issue) || {};

  // assign next community worker if community worker shall be assigned
  let nextCommunityWorker, nextCommunityWorkerName = null;

  if (includeCommunityWorker) {
    ({
      login: nextCommunityWorker,
      fullName: nextCommunityWorkerName
    } = getNextRoundRobin(issue, 2) || {});
  }

  // create weekly note body
  const body = await createWeeklyNote(nextModerator, nextSummaryWriter, nextCommunityWorker);

  // create new issue
  // filter out not-set roles
  const assignees = [ nextModerator, nextCommunityWorker ].filter(a => a);

  const {
    data: createdIssue
  } = await _createIssue({
    body,
    title,
    labels: [ 'weekly', 'ready' ],
    assignees
  });

  // add comment to closed issue for next moderator
  await _createIssueComment({
    issue_number: issue.number,
    body: `Created [follow up weekly notes](${createdIssue.html_url}).

Assigned${nextCommunityWorker ? ' @' + nextCommunityWorker + ' as the community worker and' : ''} @${nextModerator} as the next moderator.`
  });

  // send notification
  process.env.EMAIL_TO && mailer({
    subject: `${title} - Agenda Is Up`,
    text: `Hi team,

The agenda for ${title} is up: ${createdIssue.html_url}. Feel free to add additional topics.

The moderator for this time will be ${nextModName}.
The summary writer for this time will be ${nextWriterName}.
${nextCommunityWorker ? 'The community worker until then will be ' + nextCommunityWorkerName + '.' : ''}

Best,
your bot.`
  });

  async function createWeeklyNote(nextMod, nextWriter, nextCommunityWorker) {

    const response = await octokitRest.repos.getContent({
      repo: repository.name,
      owner: repository.owner.login,
      path: WEEKLY_TEMPLATE_LOCATION.path
    });

    const encoded = Buffer.from(response.data.content, 'base64');

    let weeklyNote = encoded.toString('utf-8');

    // substitute roles
    weeklyNote = weeklyNote.replace(/{{moderator}}/g, `@${nextMod}`);
    weeklyNote = weeklyNote.replace(/{{summary-writer}}/g, `@${nextWriter}`);
    weeklyNote = nextCommunityWorker ? weeklyNote.replace(/{{community-worker}}/g, `@${nextCommunityWorker}`) : weeklyNote;

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
  const currentWeek = getCurrentWeek(),
        currentWeekNr = currentWeek.weekNumber,
        currentYearNr = currentWeek.year,
        upcomingWeekNr = currentWeekNr == 52 ? 1 : currentWeekNr + 1,
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


function getNextSummaryWriter(closedIssue) {
  const {
    assignee
  } = closedIssue;

  if (!assignee) {
    return;
  }

  const lastModerator = find(MODERATORS, m => m.login === assignee.login);

  return lastModerator;
}

/**
 * @param {string} weeklyTemplate
 */
function withoutPrelude(weeklyTemplate) {
  const withoutPreludeOpening = weeklyTemplate.replace('---', '');
  const preludeEnding = withoutPreludeOpening.indexOf('---');

  return withoutPreludeOpening.substring(preludeEnding + 3).trimStart();
}
