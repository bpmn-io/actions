import * as core from '@actions/core';
import * as github from '@actions/github';

import { fillTemplate, openMergePullRequest } from './util.js';


async function run() {
  const token = core.getInput('token', { required: true });
  const source = core.getInput('source') || 'main';
  const target = core.getInput('target') || 'develop';

  const branches = { source, target };

  const { owner, repo } = github.context.repo;

  const result = await openMergePullRequest(github.getOctokit(token).rest, {
    owner,
    repo,
    source,
    target,
    title: fillTemplate(core.getInput('title'), branches),
    body: fillTemplate(core.getInput('body'), branches)
  });

  const { created, pullRequest, reason } = result;

  core.setOutput('created', String(created));

  if (pullRequest) {
    core.setOutput('pull-request-url', pullRequest.html_url);
    core.setOutput('pull-request-number', pullRequest.number);
  }

  if (created) {
    core.info(`Created pull request ${ pullRequest.html_url }`);
  } else {
    core.info(`Nothing to do: ${ reason }`);
  }
}

run().catch((error) => {
  core.setFailed(error);
});
