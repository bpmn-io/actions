import * as core from '@actions/core';
import * as github from '@actions/github';

import {
  CHECK_IDS,
  getCheckAnnotations,
  getTemplatePaths,
  normalizeChecksInput,
  runChecks
} from './util.js';

const DEFINITION_OF_DONE_URL =
  'https://github.com/bpmn-io/.github/blob/main/resources/DEFINITION_OF_DONE.md';
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

  const octokit = github.getOctokit(token);
  const repo = {
    owner: repository.owner.login,
    repo: repository.name
  };

  // template lookup (no-op when no template exists); also drives template-url
  const template = await findTemplate(octokit.rest, {
    ...repo,
    ref: pullRequest.base.sha,
    templatePath
  });

  if (template) {
    core.setOutput('template-url', template.htmlUrl);
  } else if (isAnyEnabled(config, TEMPLATE_CHECK_IDS)) {
    core.info('No pull request template found; skipping template checks.');
  }

  // commit history is only fetched when a commit check is enabled
  const commits = isAnyEnabled(config, COMMIT_CHECK_IDS)
    ? await getPullRequestCommits(octokit, { ...repo, pullNumber: pullRequest.number })
    : [];

  const context = {
    template: template ? template.content : null,
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

  core.setFailed('Pull request does not satisfy the required quality checks.');
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


async function writeJobSummary(annotations) {
  try {
    const summary = core.summary
      .addHeading('Pull request quality checks failed', 2)
      .addRaw(`Resolve the following so the pull request satisfies the [definition of done](${DEFINITION_OF_DONE_URL}).`)
      .addEOL();

    for (const { title, message } of annotations) {
      summary
        .addHeading(title, 3)
        .addRaw(message)
        .addEOL();
    }

    await summary.write();
  } catch (error) {
    core.debug(`Could not write job summary: ${error.message}`);
  }
}


async function findTemplate(rest, { owner, repo, ref, templatePath }) {
  const paths = getTemplatePaths(templatePath);
  const consumerTemplate = await findTemplateInRepository(rest, {
    owner,
    repo,
    ref,
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


async function findTemplateInRepository(rest, { owner, repo, ref, paths }) {
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
        htmlUrl: getExactTemplateUrl(data, ref)
      };
    } catch (error) {
      if (error.status === 404) {
        continue;
      }

      throw error;
    }
  }
}


function getExactTemplateUrl(template, ref) {

  // template.sha is the blob SHA, not a commit-ish, so pin to the requested
  // commit ref when available and otherwise leave the API-provided URL untouched
  return ref
    ? template.html_url.replace(/\/blob\/[^/]+\//, `/blob/${ref}/`)
    : template.html_url;
}


run().catch(error => {
  core.setFailed(error);
});


export {
  findTemplate
};
