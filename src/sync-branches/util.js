/**
 * Replace the `{{source}}` and `{{target}}` placeholders.
 *
 * @param {string} template
 * @param {{ source: string, target: string }} branches
 *
 * @return {string}
 */
export function fillTemplate(template, { source, target }) {
  const values = { source, target };

  return template.replace(/\{\{(source|target)\}\}/g, (_, key) => values[key]);
}

/**
 * Open a pull request from `source` into `target`, unless the source has no
 * commits the target lacks or such a pull request is already open.
 *
 * @param {Object} rest octokit REST client
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.source
 * @param {string} options.target
 * @param {string} options.title
 * @param {string} options.body
 *
 * @return {Promise<{ created: boolean, pullRequest?: Object, reason?: string }>}
 */
export async function openMergePullRequest(rest, options) {
  const {
    owner,
    repo,
    source,
    target,
    title,
    body
  } = options;

  if (source === target) {
    throw new Error(`source and target must differ, got "${ source }" for both`);
  }

  const { data: comparison } = await rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${ target }...${ source }`,
    per_page: 1
  });

  if (!comparison.ahead_by) {
    return { created: false, reason: `"${ target }" contains all commits of "${ source }"` };
  }

  const findOpen = async () => {
    const { data } = await rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${ owner }:${ source }`,
      base: target,
      per_page: 1
    });

    return data[0];
  };

  const open = await findOpen();

  if (open) {
    return { created: false, pullRequest: open, reason: 'pull request already open' };
  }

  try {
    const { data: pullRequest } = await rest.pulls.create({
      owner,
      repo,
      head: source,
      base: target,
      title,
      body
    });

    return { created: true, pullRequest };
  } catch (error) {

    // a concurrent run may have opened the pull request in the meantime
    if (isDuplicatePullRequestError(error)) {
      const raced = await findOpen();

      if (raced) {
        return { created: false, pullRequest: raced, reason: 'pull request already open' };
      }
    }

    throw error;
  }
}

function isDuplicatePullRequestError(error) {
  return error.status === 422 && /pull request already exists/i.test(error.message);
}
