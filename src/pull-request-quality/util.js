const DEFAULT_PULL_REQUEST_TEMPLATE_PATHS = [
  '.github/PULL_REQUEST_TEMPLATE.md'
];

const MAX_COMMITS = 50;

const CONVENTIONAL_COMMIT_SUBJECT = /^[a-z]+(\([^)\r\n]+\))?!?: .+/;
const FIXUP_COMMIT_SUBJECT = /^(fixup|squash|amend)!|^(wip\b|\[wip\])/i;
const CLOSES_ISSUE_REFERENCE = /(?:#\d+|GH-\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/
  .source;
const CLOSES_STATEMENT = new RegExp(
  `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+${CLOSES_ISSUE_REFERENCE}`,
  'i'
);


function getTemplatePaths(templatePath) {
  const paths = templatePath ? [ templatePath.trim() ] : [];

  return [ ...new Set([ ...paths, ...DEFAULT_PULL_REQUEST_TEMPLATE_PATHS ].filter(Boolean)) ];
}


function stripFrontMatter(markdown) {
  const lines = normalizeNewlines(markdown).split('\n');

  if (lines[0]?.trim() !== '---') {
    return lines;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');

  return closingIndex === -1 ? lines : lines.slice(closingIndex + 1);
}


function getHeaders(markdown) {
  const lines = stripFrontMatter(markdown);
  const headers = [];
  let fenced = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }

    if (fenced) {
      continue;
    }

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);

    if (atx) {
      headers.push(normalizeHeader(atx[1].length, atx[2]));
      continue;
    }

    const nextLine = lines[index + 1];
    const setext = nextLine?.match(/^\s{0,3}(=+|-+)\s*$/);

    if (line.trim() && setext) {
      headers.push(normalizeHeader(setext[1][0] === '=' ? 1 : 2, line));
      index++;
    }
  }

  return headers;
}


function getChecklistItems(markdown) {
  return normalizeNewlines(markdown)
    .split('\n')
    .map(line => {
      const match = line.match(/^(\s*[-+*]\s+\[)([ xX])(\]\s+.+?)\s*$/);

      if (!match) {
        return null;
      }

      return {
        checked: match[2].toLowerCase() === 'x',
        comparison: `${match[1]} ${match[3]}`,
        label: match[3].slice(2).trim()
      };
    })
    .filter(Boolean);
}


/**
 * The ordered registry of quality checks. Each check owns its identifier,
 * severity, human-readable title, and a pure `run` implementation that turns the
 * validation context into a per-check result.
 *
 * `run` returns one of:
 * - `{ applicable: false }` when the check does not apply (for example a template
 *   check without a template) — reported as skipped, never failing the gate.
 * - `{ valid: true }` when the check passes.
 * - `{ valid: false, message }` when the check fails.
 */
const CHECKS = [
  {
    id: 'uses-template',
    severity: 'error',
    title: 'Use pull request template',
    run({ template, templateUrl, body }) {
      if (template == null) {
        return { applicable: false };
      }

      const missingHeaders = findMissing(getHeaders(template), getHeaders(body));

      if (!missingHeaders.length) {
        return { valid: true };
      }

      return {
        valid: false,
        message: `Pull request is missing these headers from the ${templateReference(templateUrl)}:` +
          `\n${bullets(missingHeaders.map(inlineCode))}`
      };
    }
  },
  {
    id: 'checklist-preserved',
    severity: 'error',
    title: 'Preserve template checklist',
    run({ template, templateUrl, body }) {
      if (template == null) {
        return { applicable: false };
      }

      const missingItems = findMissingChecklistItems(
        getChecklistItems(template),
        getChecklistItems(body)
      );

      if (!missingItems.length) {
        return { valid: true };
      }

      return {
        valid: false,
        message: `Pull request is missing these checklist items from the ${templateReference(templateUrl)} ` +
          `(they may be checked or unchecked, but not removed):\n${bullets(missingItems.map(inlineCode))}`
      };
    }
  },
  {
    id: 'screenshot-media',
    severity: 'error',
    title: 'Embed screenshot or video',
    run({ template, body }) {
      if (template == null) {
        return { applicable: false };
      }

      const templateItems = getChecklistItems(template);
      const bodyItems = getChecklistItems(body);

      // require the template to define a "Screenshots added" item, but detect the
      // checked item in the body by label so reformatting (or a disabled
      // checklist-preserved check) cannot let it slip through unverified
      const screenshotsChecked =
        templateItems.some(item => isScreenshotsAddedItem(item.label)) &&
        bodyItems.some(item => item.checked && isScreenshotsAddedItem(item.label));

      if (!screenshotsChecked || hasInlineAttachment(body)) {
        return { valid: true };
      }

      return {
        valid: false,
        message: 'Pull request checks "Screenshots added" but embeds no inline ' +
          'GitHub user-attachment image or video.'
      };
    }
  },
  {
    id: 'clean-history',
    severity: 'error',
    title: 'Clean up branch history',
    run({ commits }) {
      const mergeCommits = commits.filter(commit => commit.parentCount > 1);
      const fixupCommits = commits.filter(commit => {
        return commit.parentCount <= 1 && FIXUP_COMMIT_SUBJECT.test(getSubject(commit.message));
      });

      const parts = [];

      if (commits.length > MAX_COMMITS) {
        parts.push(
          `The branch has ${commits.length} commits, more than the ${MAX_COMMITS} allowed.`
        );
      }

      if (mergeCommits.length) {
        parts.push(
          'The branch contains merge commits:\n' +
          bullets(mergeCommits.map(formatCommit))
        );
      }

      if (fixupCommits.length) {
        parts.push(
          'The branch contains work-in-progress commits:\n' +
          bullets(fixupCommits.map(formatCommit))
        );
      }

      if (!parts.length) {
        return { valid: true };
      }

      return { valid: false, message: parts.join('\n\n') };
    }
  },
  {
    id: 'conventional-commits',
    severity: 'error',
    title: 'Use conventional commits',
    run({ commits }) {
      const nonConventional = commits.filter(commit => {
        const subject = getSubject(commit.message);

        return commit.parentCount <= 1 && !CONVENTIONAL_COMMIT_SUBJECT.test(subject);
      });

      if (!nonConventional.length) {
        return { valid: true };
      }

      return {
        valid: false,
        message: 'These commit messages do not follow ' +
          `[conventional commits](https://www.conventionalcommits.org):\n${bullets(nonConventional.map(formatCommit))}`
      };
    }
  },
  {
    id: 'closes-statement',
    severity: 'warning',
    title: 'Close an issue from a commit',
    run({ commits }) {
      if (!commits.length || commits.some(commit => CLOSES_STATEMENT.test(getBody(commit.message)))) {
        return { valid: true };
      }

      return {
        valid: false,
        message: 'No commit body closes an issue (for example `Closes #123`).'
      };
    }
  }
];

const CHECK_IDS = CHECKS.map(check => check.id);


/**
 * Parse the comma-separated `skip-authors` input into a de-duplicated list of
 * author logins.
 *
 * @param { string } [input]
 *
 * @return { string[] }
 */
function parseSkipAuthors(input) {
  return [ ...new Set(
    (input || '')
      .split(',')
      .map(login => login.trim())
      .filter(Boolean)
  ) ];
}


/**
 * Whether the pull request author is allow-listed. Matches the login exactly, so
 * bots such as Copilot (`copilot-swe-agent[bot]`) are never skipped implicitly.
 *
 * @param { string } [login]
 * @param { string[] } skipAuthors
 *
 * @return { boolean }
 */
function isSkippedAuthor(login, skipAuthors) {
  return skipAuthors.includes(login);
}


/**
 * Normalize the structured, symmetric check configuration into an object form
 * keyed by check id. Accepts boolean shorthand (`true`/`false`) and the object
 * form (`{ enabled, ... }`) so a check can grow configuration without a breaking
 * change. Every known check is enabled by default, so the configuration is fully
 * optional.
 *
 * @param { Record<string, boolean | { enabled?: boolean }> } [rawChecks]
 *
 * @return { { config: Record<string, { enabled: boolean }>, unknown: string[] } }
 */
function normalizeChecksInput(rawChecks) {
  const entries = rawChecks && typeof rawChecks === 'object' && !Array.isArray(rawChecks)
    ? rawChecks
    : {};

  const config = {};

  for (const id of CHECK_IDS) {
    config[id] = normalizeCheckConfig(entries[id]);
  }

  const unknown = Object.keys(entries).filter(id => !CHECK_IDS.includes(id));

  return { config, unknown };
}


function normalizeCheckConfig(value) {
  if (value === undefined || value === null) {
    return { enabled: true };
  }

  if (typeof value === 'boolean') {
    return { enabled: value };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, enabled: value.enabled !== false };
  }

  throw new Error(`Invalid check configuration: expected a boolean or object, got ${typeof value}.`);
}


/**
 * Run every enabled check against the validation context and return the
 * aggregate result plus a per-check map keyed by check id.
 *
 * @param { { template: string | null, body: string, commits: { sha: string, message: string, parentCount: number }[] } } context
 * @param { Record<string, { enabled: boolean }> } config
 *
 * @return { { valid: boolean, checks: Record<string, { valid?: boolean, message?: string, status?: string }> } }
 */
function runChecks(context, config) {
  const checks = {};
  let valid = true;

  for (const check of CHECKS) {
    const checkConfig = config[check.id] || { enabled: true };

    if (!checkConfig.enabled) {
      checks[check.id] = { status: 'skipped' };
      continue;
    }

    const result = check.run(context, checkConfig);

    if (result.applicable === false) {
      checks[check.id] = { status: 'skipped' };
      continue;
    }

    if (result.valid) {
      checks[check.id] = { valid: true };
      continue;
    }

    checks[check.id] = { valid: false, message: result.message };

    if (check.severity !== 'warning') {
      valid = false;
    }
  }

  return { valid, checks };
}


/**
 * Build the failure annotations for a per-check result map. Severity and title
 * live with the check definition, so the structured output stays free of both.
 *
 * @param { Record<string, { valid?: boolean, message?: string }> } checks
 *
 * @return { { id: string, severity: string, title: string, message: string }[] }
 */
function getCheckAnnotations(checks) {
  return CHECKS
    .filter(check => checks[check.id]?.valid === false)
    .map(check => ({
      id: check.id,
      severity: check.severity,
      title: check.title,
      message: checks[check.id].message
    }));
}


function bullets(items) {
  return items.map(item => `- ${item}`).join('\n');
}


function inlineCode(value) {

  // fence with more backticks than the longest run inside the value, and pad
  // when it touches a backtick, so a backtick in template text cannot terminate
  // the span early and let the list render as Markdown again
  const longestRun = Math.max(0, ...[ ...value.matchAll(/`+/g) ].map(match => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = /^`|`$/.test(value) ? ' ' : '';

  return `${fence}${pad}${value}${pad}${fence}`;
}


function templateReference(templateUrl) {
  return templateUrl ? `[pull request template](${templateUrl})` : 'pull request template';
}


function formatCommit({ sha, message }) {
  return `${sha.slice(0, 7)} ${getSubject(message)}`;
}


function getSubject(message) {
  return normalizeNewlines(message).split('\n', 1)[0].trim();
}


function getBody(message) {
  return normalizeNewlines(message).split('\n').slice(1).join('\n');
}


function findMissing(required, actual) {
  const remaining = [ ...actual ];

  return required.filter(item => {
    const index = remaining.indexOf(item);

    if (index === -1) {
      return true;
    }

    remaining.splice(index, 1);
    return false;
  });
}


function findMissingChecklistItems(required, actual) {
  const remaining = [ ...actual ];

  return required.reduce((missing, item) => {
    const index = remaining.findIndex(candidate => candidate.comparison === item.comparison);

    if (index === -1) {
      missing.push(item.comparison);
    } else {
      remaining.splice(index, 1);
    }

    return missing;
  }, []);
}


function hasInlineAttachment(markdown) {
  const attachmentUrl = 'https://github\\.com/user-attachments/assets/[A-Za-z0-9-]+';
  const markdownImage = new RegExp(`!\\[[^\\]]*\\]\\(<?${attachmentUrl}[^)]*\\)?\\)`, 'i');
  const htmlMedia = new RegExp(
    `<(?:img|video|source)\\b[^>]*\\bsrc\\s*=\\s*(?:["']${attachmentUrl}[^"']*["']|${attachmentUrl}[^\\s>]*)[^>]*>`,
    'i'
  );
  const standaloneAttachment = new RegExp(`^\\s*<?${attachmentUrl}[^\\s>]*>?\\s*$`, 'im');

  return markdownImage.test(markdown) || htmlMedia.test(markdown) || standaloneAttachment.test(markdown);
}


function normalizeHeader(level, value) {
  return `${'#'.repeat(level)} ${value.trim().replace(/\s+/g, ' ')}`;
}


function isScreenshotsAddedItem(label) {
  return label
    .toLowerCase()
    .replace(/[.?!:]+$/, '')
    .replace(/[\s-]+/g, ' ')
    .trim() === 'screenshots added';
}


function normalizeNewlines(value) {
  return (value || '').replace(/\r\n?/g, '\n');
}


export {
  CHECK_IDS,
  getCheckAnnotations,
  getChecklistItems,
  getHeaders,
  getTemplatePaths,
  hasInlineAttachment,
  isSkippedAuthor,
  normalizeChecksInput,
  parseSkipAuthors,
  runChecks
};
