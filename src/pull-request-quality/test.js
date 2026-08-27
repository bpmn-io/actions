import { expect } from 'chai';

import {
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
} from './util.js';

const ALL_ENABLED = normalizeChecksInput().config;

function commit(sha, message, parentCount = 1) {
  return { sha, message, parentCount };
}

function run(context, rawChecks) {
  const base = { template: null, body: '', commits: [] };

  return runChecks({ ...base, ...context }, normalizeChecksInput(rawChecks).config);
}


describe('pull-request-quality/util', function() {

  it('should prefer a configured template path before the standard template', function() {
    expect(getTemplatePaths('templates/pull-request.md')).to.deep.equal([
      'templates/pull-request.md',
      '.github/PULL_REQUEST_TEMPLATE.md'
    ]);
  });


  it('should use the standard template path by default', function() {
    expect(getTemplatePaths()).to.deep.equal([ '.github/PULL_REQUEST_TEMPLATE.md' ]);
  });


  it('should extract ATX and Setext headers outside front matter and code fences', function() {
    const template = `---
name: Pull request
---
# Summary #

Details
-------

\`\`\`markdown
## Not a header
\`\`\``;

    expect(getHeaders(template)).to.deep.equal([ '# Summary', '## Details' ]);
  });


  it('should extract checklist items without their mutable state', function() {
    expect(getChecklistItems('* [ ] Tests added\n- [X] Screenshots added')).to.deep.equal([
      {
        checked: false,
        comparison: '* [ ] Tests added',
        label: 'Tests added'
      },
      {
        checked: true,
        comparison: '- [ ] Screenshots added',
        label: 'Screenshots added'
      }
    ]);
  });


  it('should recognize supported inline GitHub attachment embeddings', function() {
    expect(hasInlineAttachment(
      '![Screenshot](https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc)'
    )).to.be.true;
    expect(hasInlineAttachment(
      '<video src="https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc"></video>'
    )).to.be.true;
    expect(hasInlineAttachment(
      '<img src=https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc>'
    )).to.be.true;
    expect(hasInlineAttachment(
      'https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc'
    )).to.be.true;
  });


  describe('#parseSkipAuthors', function() {

    it('should default to an empty list for empty input', function() {
      expect(parseSkipAuthors()).to.deep.equal([]);
      expect(parseSkipAuthors('')).to.deep.equal([]);
      expect(parseSkipAuthors('  ,  ,')).to.deep.equal([]);
    });


    it('should split, trim, drop empty entries, and de-duplicate', function() {
      expect(parseSkipAuthors(' renovate[bot] , dependabot[bot] , renovate[bot] ,')).to.deep.equal([
        'renovate[bot]',
        'dependabot[bot]'
      ]);
    });
  });


  describe('#isSkippedAuthor', function() {

    const DEFAULT_SKIP_AUTHORS = parseSkipAuthors('renovate[bot],dependabot[bot]');

    it('should match an allow-listed author', function() {
      expect(isSkippedAuthor('renovate[bot]', DEFAULT_SKIP_AUTHORS)).to.be.true;
      expect(isSkippedAuthor('dependabot[bot]', DEFAULT_SKIP_AUTHORS)).to.be.true;
    });


    it('should not match Copilot or human authors (exact login only)', function() {
      expect(isSkippedAuthor('copilot-swe-agent[bot]', DEFAULT_SKIP_AUTHORS)).to.be.false;
      expect(isSkippedAuthor('Copilot', DEFAULT_SKIP_AUTHORS)).to.be.false;
      expect(isSkippedAuthor('some-human', DEFAULT_SKIP_AUTHORS)).to.be.false;
    });


    it('should not match a partial or suffix login', function() {
      expect(isSkippedAuthor('renovate', DEFAULT_SKIP_AUTHORS)).to.be.false;
      expect(isSkippedAuthor('renovate[bot]-fork', DEFAULT_SKIP_AUTHORS)).to.be.false;
    });


    it('should not match for an empty allow-list or missing login', function() {
      expect(isSkippedAuthor('renovate[bot]', [])).to.be.false;
      expect(isSkippedAuthor(undefined, DEFAULT_SKIP_AUTHORS)).to.be.false;
    });
  });


  describe('#normalizeChecksInput', function() {

    it('should enable every known check by default', function() {
      const { config, unknown } = normalizeChecksInput();

      expect(Object.keys(config)).to.deep.equal(CHECK_IDS);
      expect(CHECK_IDS.every(id => config[id].enabled)).to.be.true;
      expect(unknown).to.be.empty;
    });


    it('should accept boolean shorthand and object form', function() {
      const { config } = normalizeChecksInput({
        'clean-history': false,
        'conventional-commits': { enabled: true, future: 'value' }
      });

      expect(config['clean-history']).to.deep.equal({ enabled: false });
      expect(config['conventional-commits']).to.deep.equal({ enabled: true, future: 'value' });
      expect(config['uses-template']).to.deep.equal({ enabled: true });
    });


    it('should report unknown check ids', function() {
      expect(normalizeChecksInput({ 'made-up': true }).unknown).to.deep.equal([ 'made-up' ]);
    });


    it('should reject a non boolean, non object check value', function() {
      expect(() => normalizeChecksInput({ 'clean-history': 'yes' })).to.throw();
    });
  });


  describe('#runChecks template checks', function() {

    it('should pass template checks when the body preserves the template', function() {
      const template = '## Summary\n\n- [ ] Tests added';
      const body = '## Summary\n\nImplemented it.\n\n- [x] Tests added';

      const { valid, checks } = run({ template, body }, { 'closes-statement': false });

      expect(valid).to.be.true;
      expect(checks['uses-template']).to.deep.equal({ valid: true });
      expect(checks['checklist-preserved']).to.deep.equal({ valid: true });
    });


    it('should fail uses-template when a header is missing', function() {
      const { valid, checks } = run({ template: '## Summary\n## Details', body: '## Summary' });

      expect(valid).to.be.false;
      expect(checks['uses-template'].valid).to.be.false;
      expect(checks['uses-template'].message).to.contain('## Details');
    });


    it('should link the template and inline-code the missing headers', function() {
      const { checks } = run({
        template: '## Summary\n## Details',
        templateUrl: 'https://example.com/T.md',
        body: '## Summary'
      });

      expect(checks['uses-template'].message).to.equal(
        'Pull request is missing these headers from the ' +
        '[pull request template](https://example.com/T.md):\n- `## Details`'
      );
    });


    it('should fence a header that itself contains backticks', function() {
      const { checks } = run({ template: '## Run `npm test`', body: '' });

      expect(checks['uses-template'].message).to.equal(
        'Pull request is missing these headers from the pull request template:' +
        '\n- `` ## Run `npm test` ``'
      );
    });


    it('should fail checklist-preserved when a checklist item is removed', function() {
      const { checks } = run({ template: '- [ ] Tests added', body: 'Nothing here' });

      expect(checks['checklist-preserved'].valid).to.be.false;
      expect(checks['checklist-preserved'].message).to.contain('- [ ] Tests added');
    });


    it('should link the template and inline-code the missing checklist items', function() {
      const { checks } = run({
        template: '- [ ] Run `npm test`',
        templateUrl: 'https://example.com/T.md',
        body: 'Nothing here'
      });

      expect(checks['checklist-preserved'].message).to.equal(
        'Pull request is missing these checklist items from the ' +
        '[pull request template](https://example.com/T.md) ' +
        '(they may be checked or unchecked, but not removed):\n- `` - [ ] Run `npm test` ``'
      );
    });


    it('should allow a preserved checklist item to be unchecked', function() {
      const { checks } = run({ template: '- [x] Tests added', body: '- [ ] Tests added' });

      expect(checks['checklist-preserved']).to.deep.equal({ valid: true });
    });


    it('should require inline media when Screenshots added is checked', function() {
      const template = '- [ ] Screenshots added';
      const body = '- [x] Screenshots added\n\nNo media here.';

      expect(run({ template, body }).checks['screenshot-media'].valid).to.be.false;
    });


    it('should accept inline media when Screenshots added is checked', function() {
      const template = '- [ ] Screenshots added';
      const body = '- [x] Screenshots added\n\n' +
        '![shot](https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc)';

      expect(run({ template, body }).checks['screenshot-media']).to.deep.equal({ valid: true });
    });


    it('should require inline media even when the checklist formatting differs', function() {
      const template = '- [ ] Screenshots added';
      const body = '* [X] Screenshots added\n\nNo media here.';

      expect(run({ template, body }).checks['screenshot-media'].valid).to.be.false;
    });


    it('should skip template checks when no template exists', function() {
      const { valid, checks } = run({ template: null, body: 'anything' }, {
        'clean-history': false,
        'conventional-commits': false,
        'closes-statement': false
      });

      expect(valid).to.be.true;
      expect(checks['uses-template']).to.deep.equal({ status: 'skipped' });
      expect(checks['checklist-preserved']).to.deep.equal({ status: 'skipped' });
      expect(checks['screenshot-media']).to.deep.equal({ status: 'skipped' });
    });
  });


  describe('#runChecks commit checks', function() {

    it('should pass a clean, conventional history that closes an issue', function() {
      const commits = [
        commit('a1b2c3d', 'feat(core): add feature\n\nCloses #12'),
        commit('e4f5a6b', 'test(core): cover feature')
      ];

      const { valid, checks } = run({ commits });

      expect(valid).to.be.true;
      expect(checks['clean-history']).to.deep.equal({ valid: true });
      expect(checks['conventional-commits']).to.deep.equal({ valid: true });
      expect(checks['closes-statement']).to.deep.equal({ valid: true });
    });


    it('should fail clean-history on merge and work-in-progress commits', function() {
      const commits = [
        commit('merge01', 'Merge branch main', 2),
        commit('fixup01', 'fixup! feat: add feature'),
        commit('feat011', 'feat: add feature\n\nCloses #7')
      ];

      const { checks } = run({ commits });

      expect(checks['clean-history'].valid).to.be.false;
      expect(checks['clean-history'].message).to.contain('merge01');
      expect(checks['clean-history'].message).to.contain('fixup01');
    });


    it('should fail clean-history on more than 50 commits', function() {
      const commits = Array.from({ length: 51 }, (_, index) =>
        commit(`commit${index}`, `feat: change ${index}\n\nCloses #1`));

      const { checks } = run({ commits });

      expect(checks['clean-history'].valid).to.be.false;
      expect(checks['clean-history'].message).to.contain('51 commits');
    });


    it('should allow exactly 50 commits', function() {
      const commits = Array.from({ length: 50 }, (_, index) =>
        commit(`commit${index}`, `feat: change ${index}\n\nCloses #1`));

      expect(run({ commits }).checks['clean-history']).to.deep.equal({ valid: true });
    });


    it('should fail conventional-commits on a non-conventional subject', function() {
      const commits = [ commit('plain01', 'Add feature\n\nCloses #7') ];

      const { checks } = run({ commits });

      expect(checks['conventional-commits'].valid).to.be.false;
      expect(checks['conventional-commits'].message).to.contain('plain01');
    });


    it('should fail conventional-commits on a fixup subject', function() {
      const commits = [ commit('fixup02', 'fixup! feat: add feature') ];

      expect(run({ commits }).checks['conventional-commits'].valid).to.be.false;
    });


    it('should warn but not fail when no commit closes an issue', function() {
      const commits = [ commit('c0ffee0', 'fix: correct bug') ];

      const { valid, checks } = run({ commits });

      expect(valid).to.be.true;
      expect(checks['closes-statement'].valid).to.be.false;
    });


    it('should not treat a subject-only issue reference as a closing statement', function() {
      const commits = [ commit('c0ffee1', 'fix: correct bug closes #9') ];

      expect(run({ commits }).checks['closes-statement'].valid).to.be.false;
    });


    it('should accept a full issue URL as a closing statement', function() {
      const commits = [
        commit('c0ffee2', 'feat: add feature\n\nCloses https://github.com/bpmn-io/actions/issues/21')
      ];

      expect(run({ commits }).checks['closes-statement']).to.deep.equal({ valid: true });
    });


    it('should accept a cross-repository issue reference as a closing statement', function() {
      const commits = [
        commit('c0ffee3', 'feat: add feature\n\nCloses bpmn-io/actions#21')
      ];

      expect(run({ commits }).checks['closes-statement']).to.deep.equal({ valid: true });
    });


    it('should skip disabled checks', function() {
      const commits = [ commit('merge02', 'Merge branch main', 2) ];

      const { valid, checks } = run({ commits }, {
        'clean-history': false,
        'conventional-commits': false,
        'closes-statement': false
      });

      expect(valid).to.be.true;
      expect(checks['clean-history']).to.deep.equal({ status: 'skipped' });
      expect(checks['conventional-commits']).to.deep.equal({ status: 'skipped' });
      expect(checks['closes-statement']).to.deep.equal({ status: 'skipped' });
    });
  });


  describe('#getCheckAnnotations', function() {

    it('should build a titled, severity-tagged annotation for each failing check', function() {
      const { checks } = runChecks({
        template: '## Summary',
        body: '',
        commits: [ commit('plain01', 'Add feature') ]
      }, ALL_ENABLED);

      const annotations = getCheckAnnotations(checks);

      expect(annotations.map(annotation => annotation.id)).to.include.members([
        'uses-template',
        'conventional-commits',
        'closes-statement'
      ]);

      const closes = annotations.find(annotation => annotation.id === 'closes-statement');

      expect(closes.severity).to.equal('warning');
      expect(closes.title).to.equal('Close an issue from a commit');

      const template = annotations.find(annotation => annotation.id === 'uses-template');

      expect(template.severity).to.equal('error');
    });


    it('should build no annotations when every check passes', function() {
      const { checks } = runChecks({
        template: null,
        body: '',
        commits: [ commit('a1b2c3d', 'feat: add feature\n\nCloses #1') ]
      }, ALL_ENABLED);

      expect(getCheckAnnotations(checks)).to.be.empty;
    });
  });
});
