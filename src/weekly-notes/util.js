
/**
 * @typedef {Object} CalendarWeek
 * @property {number} weekNumber ISO week number 1-53
 * @property {number} year
 */

/**
 * Resources: https://weeknumber.net/how-to/javascript
 *
 * @param {Date} date
 *
 * @returns {CalendarWeek}
 */
module.exports.getWeek = function(date) {

  date.setHours(0, 0, 0, 0);

  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);

  // January 4 is always in week 1.
  const week1 = new Date(date.getFullYear(), 0, 4);

  // Adjust to Thursday in week 1 and count number of weeks from date to week1.
  const weekNumber = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000
                        - 3 + (week1.getDay() + 6) % 7) / 7);

  const year = date.getUTCFullYear();

  return {
    weekNumber,
    year
  };
};

/**
 * @param {number} weekInterval
 * @param { {
 *   weekNumber: number,
 *   year: number
 * } } currentWeek
 *
 * @return {string}
 */
module.exports.getNextIssueTitle = function getNextIssueTitle(weekInterval, currentWeek) {

  console.debug('[weekly-notes] computing next issue title', {
    currentWeek,
    weekInterval
  });

  const {
    weekNumber: currentWeekNr,
    year: currentYearNr
  } = currentWeek;

  const upcomingWeekNr = (Math.min(currentWeekNr, 52) + weekInterval - 1) % 52 + 1;
  const upcomingYearNr = upcomingWeekNr < currentWeekNr ? currentYearNr + 1 : currentYearNr;

  return `W${upcomingWeekNr} - ${upcomingYearNr}`;
};

module.exports.getFirstAssignee = function getFirstAssignee(issueContents) {
  const assigneeRegex = /<!-- assignee: @(\w+) -->/g;
  const match = assigneeRegex.exec(issueContents);
  return match ? match[1] : null;
};

module.exports.withAssignee = function withAssignee(issueContents, assignee) {
  if (!assignee) {
    throw new Error('assignee must be provided');
  }

  const assigneeTag = `<!-- assignee: @${assignee} -->`;
  return `${issueContents}\n\n${assigneeTag}`;
};
