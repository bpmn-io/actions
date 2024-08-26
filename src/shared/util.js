const { findIndex } = require('min-dash');

/**
 * @typedef { { login: string, fullName: string } } Assignee
 */

/**
 * @param { Assignee[] } candidates
 * @param { { login: string } } lastAssignee
 * @param {number} [offset=1]
 *
 * @return {Assignee | null}
 */
function getNextAssignee(candidates, lastAssignee={login:""}, offset = 1) {
  const lastIndex = findIndex(candidates, c => c.login === lastAssignee?.login);

  // ensure assignee was a valid moderator
  if (lastIndex === -1) {
    return null;
  }

  return candidates[(lastIndex + offset) % candidates.length];
}

module.exports = {
  getNextAssignee
};