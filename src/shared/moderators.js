const DEFAULT_MODERATORS = require('./DEFAULT_MODERATORS');

const core = require('@actions/core');
const github = require('@actions/github');

const token = core.getInput('token');
const moderatorsPath = core.getInput('moderators-path');

const octokitRest = github.getOctokit(token).rest;
const repository = github.context.payload.repository;

const moderators = moderatorsPath && getModerators();

module.exports = moderators || DEFAULT_MODERATORS;


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
