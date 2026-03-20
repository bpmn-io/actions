import DEFAULT_MODERATORS from './DEFAULT_MODERATORS.js';

import * as core from '@actions/core';
import * as github from '@actions/github';

const token = core.getInput('token');
const moderatorsPath = core.getInput('moderators-path');

const octokitRest = github.getOctokit(token).rest;
const repository = github.context.payload.repository;

const moderators = moderatorsPath ? getModerators() : Promise.resolve(DEFAULT_MODERATORS);

export default moderators;


// helpers //////////////////////
async function getModerators() {
  const response = await octokitRest.repos.getContent({
    repo: repository.name,
    owner: repository.owner.login,
    path: moderatorsPath
  });

  const encoded = Buffer.from(response.data.content, 'base64');
  return JSON.parse(encoded.toString('utf-8'));
}
