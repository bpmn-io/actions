import * as core from '@actions/core';
import * as github from '@actions/github';

import {
  CHECK_IDS,
  getCheckAnnotations,
  getTemplatePaths,
  isSkippedAuthor,
  normalizeChecksInput,
  parseSkipAuthors,
  runChecks
} from './util.js';

const COMMUNITY_HEALTH_REPOSITORY = {
  owner: 'bpmn-io',
  repo: '.github'
};

const TEMPLATE_CHECK_IDS = [ 'uses-template', 'checklist-preserved', 'screenshot-media' ];
const COMMIT_CHECK_IDS = [ 'clean-history', 'conventional-commits', 'closes-statement' ];


async function run() {
  const token = core.getInput('token', { required: true });
  const templatePath = core.getInput('template-path');
  const { config } = normalizeChecksInput(readChecksInput());

  const pullRequest = github.context.payload.pull_request;
  const repository = github.context.payload.repository;

  if (!pullRequest || !repository) {
    throw new Error('This action must run for a pull request event.');
  }

  // allow-listed authors (for example dependency bots) cannot fill out the pull
  // request template; skip every check and report a pass. Matching is an exact
  // login match, so bots such as Copilot are still checked.
  const skipAuthors = parseSkipAuthors(core.getInput('skip-authors'));
  const authorLogin = pullRequest.user?.login;

  if (isSkippedAuthor(authorLogin, skipAuthors)) {
    core.info(`Skipping checks for allow-listed author "${authorLogin}".`);

    core.setOutput('valid', 'true');
    core.setOutput('checks', JSON.stringify(
      Object.fromEntries(CHECK_IDS.map(id => [ id, { status: 'skipped' } ]))
    ));

    await writeSkippedSummary(authorLogin);
    return;
  }

  const octokit = github.getOctokit(token);
  const repo = {
    owner: repository.owner.login,
    repo: repository.name
  };

  // template lookup (no-op when no template exists); also drives template-url
  const template = await findTemplate(octokit.rest, {
    ...repo,
    ref: pullRequest.base.sha,
    branch: pullRequest.base.ref,
    templatePath
  });

  if (template) {
    core.setOutput('template-url', template.exactUrl);
  } else if (isAnyEnabled(config, TEMPLATE_CHECK_IDS)) {
    core.info('No pull request template found; skipping template checks.');
  }

  // commit history is only fetched when a commit check is enabled
  const commits = isAnyEnabled(config, COMMIT_CHECK_IDS)
    ? await getPullRequestCommits(octokit, { ...repo, pullNumber: pullRequest.number })
    : [];

  const context = {
    template: template ? template.content : null,
    templateUrl: template ? template.htmlUrl : null,
    body: pullRequest.body || '',
    commits
  };

  const { valid, checks } = runChecks(context, config);

  core.setOutput('valid', valid ? 'true' : 'false');
  core.setOutput('checks', JSON.stringify(checks));

  const annotations = getCheckAnnotations(checks);
  const errors = annotations.filter(annotation => annotation.severity !== 'warning');
  const warnings = annotations.filter(annotation => annotation.severity === 'warning');

  // warnings surface as annotations but never fail the gate
  for (const { title, message } of warnings) {
    core.warning(message, { title });
  }

  if (valid) {
    core.info('Pull request satisfies the configured quality checks.');
    return;
  }

  // feedback is delivered as check annotations plus a job summary; both need no
  // token permissions and appear on every pull request, including from forks
  for (const { title, message } of errors) {
    core.error(message, { title });
  }

  await writeJobSummary(errors);

  core.setFailed('Pull request does not satisfy required quality checks.');
}


function readChecksInput() {

  // GitHub Action inputs are flat strings, so each check is exposed as a
  // `check-<id>` boolean input that maps onto the structured internal keyspace
  return Object.fromEntries(CHECK_IDS.map(id => [ id, core.getBooleanInput(`check-${id}`) ]));
}


function isAnyEnabled(config, ids) {
  return ids.some(id => config[id]?.enabled);
}


async function getPullRequestCommits(octokit, { owner, repo, pullNumber }) {
  const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100
  });

  return commits.map(commit => ({
    sha: commit.sha,
    message: commit.commit.message,
    parentCount: commit.parents.length
  }));
}


async function writeSkippedSummary(authorLogin) {
  try {
    const lines = [
      '## Pull request quality',
      '',
      `Skipped all quality checks because \`${authorLogin}\` is an allow-listed ` +
        'author. The check reports a pass.'
    ];

    await core.summary.addRaw(lines.join('\n')).addEOL().write();
  } catch (error) {
    core.debug(`Could not write job summary: ${error.message}`);
  }
}


async function writeJobSummary(annotations) {
  try {

    // build the summary as a single Markdown document: mixing `addHeading`
    // (which emits raw HTML) with Markdown on adjacent lines opens an HTML block
    // that swallows the following links and lists, rendering them as literal text
    const lines = [
      '## Pull request quality',
      '',
      'Pull request does not satisfy required quality checks. ' +
        'Update your contribution, resolving the issues below.'
    ];

    for (const { title, message } of annotations) {
      lines.push('', `### ${title}`, '', message);
    }

    await core.summary.addRaw(lines.join('\n')).addEOL().write();
  } catch (error) {
    core.debug(`Could not write job summary: ${error.message}`);
  }
}


async function findTemplate(rest, { owner, repo, ref, branch, templatePath }) {
  const paths = getTemplatePaths(templatePath);
  const consumerTemplate = await findTemplateInRepository(rest, {
    owner,
    repo,
    ref,
    branch,
    paths
  });

  if (consumerTemplate) {
    return consumerTemplate;
  }

  return await findTemplateInRepository(rest, {
    ...COMMUNITY_HEALTH_REPOSITORY,
    paths
  });
}


async function findTemplateInRepository(rest, { owner, repo, ref, branch, paths }) {
  for (const path of paths) {
    try {
      const { data } = await rest.repos.getContent({
        owner,
        repo,
        path,
        ...(ref && { ref })
      });

      if (Array.isArray(data) || data.type !== 'file' || !data.content) {
        continue;
      }

      return {
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        htmlUrl: getTemplateUrl(data, branch),
        exactUrl: data.html_url
      };
    } catch (error) {
      if (error.status === 404) {
        continue;
      }

      throw error;
    }
  }
}


function getTemplateUrl(template, branch) {

  // the `data.html_url` is pinned to the exact commit the content was read from;
  // link the base branch (for example `main`) instead so the summary URL stays
  // human-readable and keeps resolving as the branch advances. encode each path
  // segment (a valid ref may contain characters like `#`) and use a replacer
  // callback so the branch is inserted literally
  if (!branch) {
    return template.html_url;
  }

  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');

  return template.html_url.replace(/\/blob\/[^/]+\//, () => `/blob/${encodedBranch}/`);
}


run().catch(error => {
  core.setFailed(error);
});


export {
  findTemplate
};
