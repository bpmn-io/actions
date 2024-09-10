const { findIndex } = require('min-dash');

/**
 * @typedef { { login: string, fullName: string } } Assignee
 */

/**
 * @param { Assignee[] } candidates
 * @param { { login: string } } [lastAssignee]
 * @param {number} [offset=1]
 *
 * @return {Assignee | null}
 */
function getNextAssignee(candidates, lastAssignee, offset = 1) {
  const lastIndex = findIndex(candidates, c => c.login === lastAssignee?.login);

  // if last assignee was not found, then we default to
  // first candidate
  return candidates[(lastIndex + offset) % candidates.length];
}

module.exports = {
  getNextAssignee
};
