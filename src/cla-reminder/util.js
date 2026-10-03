export const CLA_BOT = 'CLAassistant';

export const CLA_STATUS_CONTEXT = 'license/cla';

const DAY = 24 * 60 * 60 * 1000;

// scheduled runs start with a varying delay; without this slack, a step due
// "7 days after the last one" could slip to the next day's run
const SCHEDULE_TOLERANCE = DAY / 2;

const REMINDER_MARKER = /<!-- cla-reminder:(\d+) -->/;

const CLOSE_MARKER = '<!-- cla-closed -->';

/**
 * @typedef { {
 *   user?: { login: string },
 *   body?: string,
 *   created_at: string
 * } } Comment
 *
 * @typedef { { type: 'remind', number: number } | { type: 'close' } } Step
 */

/**
 * Parse the reminder schedule, both given in days after the CLA invitation.
 *
 * @param {string} reminderDays comma-separated, ascending
 * @param {string} closeAfterDays
 *
 * @return { { reminderDays: number[], closeAfterDays: number } }
 */
export function parseSchedule(reminderDays, closeAfterDays) {
  const days = reminderDays.split(',').map(d => d.trim()).filter(Boolean).map(Number);
  const closeDay = closeAfterDays.trim() ? Number(closeAfterDays) : NaN;

  const schedule = [ ...days, closeDay ];

  const valid = schedule.every((day, index) => {
    return Number.isInteger(day) && day > 0 && (index === 0 || day > schedule[index - 1]);
  });

  if (!valid) {
    throw new Error(
      `invalid schedule <${reminderDays}> / <${closeAfterDays}>: ` +
      'expected ascending positive day counts, closing after the last reminder'
    );
  }

  return {
    reminderDays: days,
    closeAfterDays: closeDay
  };
}

/**
 * @typedef { { owner: string, repo: string } } Repository
 */

/**
 * @param { {
 *   owner: string,
 *   repositories?: Repository[],
 *   exemptLabel?: string
 * } } options
 *
 * @return {string} search query for open pull requests that got a CLA invitation,
 *   in all repositories of the owner and in the additional repositories
 */
export function getSearchQuery({ owner, repositories = [], exemptLabel }) {
  const targets = [
    `org:${owner}`,
    ...repositories.map(repository => `repo:${repository.owner}/${repository.repo}`)
  ].join(' ');

  const query = `${targets} is:pr is:open archived:false commenter:${CLA_BOT}`;

  return exemptLabel ? `${query} -label:"${exemptLabel}"` : query;
}

/**
 * Parse the `repositories` input, each given as `owner/name` and separated by
 * commas or white space (so one per line works, too),
 * into a de-duplicated list. Names are compared case-insensitively, as GitHub does.
 *
 * @param {string} [input]
 *
 * @return {Repository[]}
 *
 * @throws {Error} if an entry is not of the form `owner/name`
 */
export function parseRepositories(input) {
  const repositories = new Map();

  for (const entry of (input || '').split(/[\s,]+/).filter(Boolean)) {
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(entry);

    if (!match) {
      throw new Error(`invalid repository <${ entry }>, expected <owner>/<name>`);
    }

    const key = entry.toLowerCase();

    if (!repositories.has(key)) {
      repositories.set(key, { owner: match[1], repo: match[2] });
    }
  }

  return [ ...repositories.values() ];
}

/**
 * Determine the step that is due for a pull request with an unsigned CLA.
 *
 * Each step is due once the gap between its scheduled day and the previous
 * one has passed since the previous step was taken. This keeps contributors'
 * time to react intact, even if the schedule starts late.
 *
 * Only comments of `botLogin` count as steps taken; markers posted by anybody
 * else are ignored. The outcome does not depend on the order of comments.
 *
 * @param { {
 *   comments: Comment[],
 *   botLogin: string,
 *   reminderDays: number[],
 *   closeAfterDays: number,
 *   now: Date
 * } } options
 *
 * @return {Step|null}
 */
export function getNextStep({ comments, botLogin, reminderDays, closeAfterDays, now }) {
  const invitations = comments.filter(comment => comment.user?.login === CLA_BOT);
  const own = comments.filter(comment => comment.user?.login === botLogin);

  if (!invitations.length || own.some(comment => comment.body?.includes(CLOSE_MARKER))) {
    return null;
  }

  const reminders = own.flatMap(comment => {
    const number = Number(REMINDER_MARKER.exec(comment.body || '')?.[1]);

    return number ? [ { number, createdAt: Date.parse(comment.created_at) } ] : [];
  });

  // a reminder posted twice still counts once
  const sent = Math.min(Math.max(0, ...reminders.map(reminder => reminder.number)), reminderDays.length);
  const schedule = [ 0, ...reminderDays, closeAfterDays ];
  const gap = (schedule[sent + 1] - schedule[sent]) * DAY;

  const previousStepAt = reminders.length
    ? Math.max(...reminders.map(reminder => reminder.createdAt))
    : Math.min(...invitations.map(invitation => Date.parse(invitation.created_at)));

  if (now.getTime() - previousStepAt < gap - SCHEDULE_TOLERANCE) {
    return null;
  }

  if (sent < reminderDays.length) {
    return { type: 'remind', number: sent + 1 };
  }

  return { type: 'close' };
}

/**
 * Determine how the label for pull requests without a signed CLA has to change:
 * it is added to unsigned pull requests and removed as soon as the CLA is signed.
 * Label names are compared case-insensitively, as GitHub does.
 *
 * @param { {
 *   signed: boolean,
 *   labels: { name: string }[],
 *   label?: string
 * } } options
 *
 * @return {'add' | 'remove' | null} `null` if nothing has to change or if there is no label
 */
export function getLabelChange({ signed, labels, label }) {
  if (!label) {
    return null;
  }

  const name = label.toLowerCase();
  const labeled = labels.some(other => other.name.toLowerCase() === name);

  if (signed) {
    return labeled ? 'remove' : null;
  }

  return labeled ? null : 'add';
}

/**
 * Whether the user `botLogin` closed the pull request before, according to its
 * issue events. Unlike comments, events cannot be written by anybody else.
 *
 * @param { { event: string, actor?: { login: string } | null }[] } events
 * @param {string} botLogin
 *
 * @return {boolean}
 */
export function wasClosedBy(events, botLogin) {
  const login = botLogin.toLowerCase();

  return events.some(event => event.event === 'closed' && event.actor?.login?.toLowerCase() === login);
}

/**
 * @param { {
 *   owner: string,
 *   repo: string,
 *   number: number,
 *   author: string,
 *   reminder: number,
 *   reminderDays: number[],
 *   closeAfterDays: number
 * } } options
 *
 * @return {string}
 */
export function getReminderBody({ owner, repo, number, author, reminder, reminderDays, closeAfterDays }) {
  const daysLeft = closeAfterDays - reminderDays[reminder - 1];

  return `<!-- cla-reminder:${reminder} -->
Hi @${author}, this pull request can only be considered once all its committers have signed our [Contributor License Agreement](${getSignUrl({ owner, repo, number })}). Otherwise, it will be closed in ${daysLeft} days.`;
}

/**
 * @param { {
 *   owner: string,
 *   repo: string,
 *   number: number,
 *   author: string,
 *   closeAfterDays: number
 * } } options
 *
 * @return {string}
 */
export function getCloseBody({ owner, repo, number, author, closeAfterDays }) {
  return `<!-- cla-closed -->
Hi @${author}, we are closing this pull request: not all committers signed our [Contributor License Agreement](${getSignUrl({ owner, repo, number })}) within ${closeAfterDays} days of our invitation, so the contribution is not eligible for consideration, and the pull request went stale. Thanks for your interest! Once everyone has signed, let us know here and we will gladly reopen it.`;
}

function getSignUrl({ owner, repo, number }) {
  return `https://cla-assistant.io/${owner}/${repo}?pullRequest=${number}`;
}
