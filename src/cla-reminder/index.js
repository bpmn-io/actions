import * as core from '@actions/core';
import * as github from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

import {
  CLA_STATUS_CONTEXT,
  getCloseBody,
  getLabelChange,
  getNextStep,
  getReminderBody,
  getSearchQuery,
  parseRepositories,
  parseSchedule,
  wasClosedBy
} from './util.js';


const MAX_RATE_LIMIT_RETRIES = 3;


async function run() {
  const token = core.getInput('token', { required: true });
  const owner = core.getInput('owner', { required: true });
  const exemptLabel = core.getInput('exempt-label');
  const unsignedLabel = core.getInput('unsigned-label');
  const dryRun = core.getBooleanInput('dry-run');
  const repositories = parseRepositories(core.getInput('repositories'));

  const {
    reminderDays,
    closeAfterDays
  } = parseSchedule(core.getInput('reminder-days'), core.getInput('close-after-days'));

  const octokit = createOctokit(token);
  const now = new Date();

  // markers in comments are only trusted if they come from this user
  const { data: { login: botLogin } } = await octokit.rest.users.getAuthenticated();

  core.info(`Acting as ${botLogin}.`);

  const query = getSearchQuery({ owner, repositories, exemptLabel });
  core.info(`Searching pull requests: ${query}`);

  const items = await octokit.paginate(octokit.rest.search.issuesAndPullRequests, {
    q: query,
    per_page: 100
  });

  core.info(`Found ${items.length} pull request(s) with a CLA invitation.`);

  const results = [];

  for (const item of items) {
    const [ repoOwner, repo ] = item.repository_url.split('/').slice(-2);

    const pullRequest = {
      owner: repoOwner,
      repo,
      number: item.number,
      author: item.user.login,
      url: item.html_url
    };

    try {
      const { labelChange, step } = await getDueWork(octokit, pullRequest, {
        unsignedLabel,
        reminderDays,
        closeAfterDays,
        now,
        botLogin
      });

      if (!labelChange && !step) {
        continue;
      }

      if (labelChange) {
        core.info(`${dryRun ? '[dry-run] ' : ''}${describeLabelChange(labelChange, unsignedLabel)}: ${pullRequest.url}`);

        if (!dryRun) {
          await applyLabelChange(octokit, pullRequest, labelChange, unsignedLabel);
        }
      }

      if (step) {
        core.info(`${dryRun ? '[dry-run] ' : ''}${describeStep(step)}: ${pullRequest.url}`);

        if (!dryRun) {
          await applyStep(octokit, pullRequest, step, { reminderDays, closeAfterDays });
        }
      }

      results.push({ pullRequest, labelChange, step });
    } catch (error) {
      core.warning(`Failed to process ${pullRequest.url}: ${error.message}`);

      results.push({ pullRequest, error });
    }
  }

  await writeJobSummary(results, dryRun, unsignedLabel);

  const failed = results.filter(result => result.error);

  if (failed.length) {
    core.setFailed(`Failed to process ${failed.length} pull request(s).`);
  }
}


/**
 * Create a client that spaces out writes and waits and retries when GitHub
 * asks to slow down, as it does when many pull requests are due at once.
 *
 * @param {string} token
 *
 * @return {import('@actions/github/lib/utils.js').GitHub}
 */
function createOctokit(token) {
  const throttle = {
    onRateLimit: createRateLimitHandler('primary rate'),
    onSecondaryRateLimit: createRateLimitHandler('secondary rate')
  };

  return github.getOctokit(token, { throttle }, throttling, retry);
}

function createRateLimitHandler(name) {
  return (retryAfter, { method, url }, octokit, retryCount) => {
    const retrying = retryCount < MAX_RATE_LIMIT_RETRIES;

    core.warning(`Hit the ${name} limit on ${method} ${url}: ${retrying ? `retrying in ${retryAfter}s` : 'giving up'}.`);

    return retrying;
  };
}


async function getDueWork(octokit, { owner, repo, number }, { unsignedLabel, ...schedule }) {
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: number
  });

  const { data: status } = await octokit.rest.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: pullRequest.head.sha
  });

  const claStatus = status.statuses.find(({ context }) => context === CLA_STATUS_CONTEXT);

  // without a status on the latest commit, CLA Assistant has not checked it yet
  if (!claStatus) {
    return {};
  }

  const signed = claStatus.state === 'success';
  const labelChange = getLabelChange({ signed, labels: pullRequest.labels, label: unsignedLabel });

  if (signed) {
    return { labelChange };
  }

  return {
    labelChange,
    step: await getDueStep(octokit, { owner, repo, number }, schedule)
  };
}


async function getDueStep(octokit, { owner, repo, number }, schedule) {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: number,
    per_page: 100
  });

  const step = getNextStep({ comments, ...schedule });

  if (step?.type !== 'close') {
    return step;
  }

  // a pull request we closed once must never be closed again, even if the
  // closing comment got lost and a maintainer reopened the pull request
  const events = await octokit.paginate(octokit.rest.issues.listEvents, {
    owner,
    repo,
    issue_number: number,
    per_page: 100
  });

  return wasClosedBy(events, schedule.botLogin) ? null : step;
}


async function applyStep(octokit, pullRequest, step, { reminderDays, closeAfterDays }) {
  const { owner, repo, number } = pullRequest;

  if (step.type === 'remind') {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: getReminderBody({ ...pullRequest, reminder: step.number, reminderDays, closeAfterDays })
    });

    return;
  }

  // The comment carries the marker that prevents any further step, so it goes
  // last: if closing fails, the next run retries the whole step.
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: number,
    state: 'closed'
  });

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: number,
    body: getCloseBody({ ...pullRequest, closeAfterDays })
  });
}


function describeStep(step) {
  return step.type === 'remind' ? `Remind (${step.number})` : 'Close';
}

function describeLabelChange(labelChange, label) {
  return labelChange === 'add' ? `Add label "${label}"` : `Remove label "${label}"`;
}

async function applyLabelChange(octokit, { owner, repo, number }, labelChange, label) {
  if (labelChange === 'add') {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: number,
      labels: [ label ]
    });

    return;
  }

  await octokit.rest.issues.removeLabel({
    owner,
    repo,
    issue_number: number,
    name: label
  });
}


async function writeJobSummary(results, dryRun, unsignedLabel) {
  try {
    const lines = [
      `## CLA reminder${dryRun ? ' (dry run)' : ''}`,
      ''
    ];

    if (!results.length) {
      lines.push('No pull request was due for a label change, a reminder or closing.');
    } else {
      lines.push('| Pull request | Action |', '| --- | --- |');

      for (const { pullRequest, labelChange, step, error } of results) {
        const action = error
          ? `Failed: ${error.message}`
          : [ labelChange && describeLabelChange(labelChange, unsignedLabel), step && describeStep(step) ].filter(Boolean).join(', ');

        lines.push(`| [${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}](${pullRequest.url}) | ${action} |`);
      }
    }

    await core.summary.addRaw(lines.join('\n')).addEOL().write();
  } catch (error) {
    core.debug(`Could not write job summary: ${error.message}`);
  }
}


run().catch(error => {
  core.setFailed(error);
});
