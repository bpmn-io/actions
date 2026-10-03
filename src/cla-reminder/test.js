import { expect } from 'chai';

import {
  getCloseBody,
  getLabelChange,
  getNextStep,
  getReminderBody,
  getSearchQuery,
  parseRepositories,
  parseSchedule,
  wasClosedBy
} from './util.js';

const DAY = 24 * 60 * 60 * 1000;

const INVITED_AT = '2026-09-01T10:00:00Z';

const SCHEDULE = {
  reminderDays: [ 7, 14 ],
  closeAfterDays: 21
};

const BOT = 'bpmn-io-bot';

const OPTIONS = {
  ...SCHEDULE,
  botLogin: BOT
};


describe('cla-reminder/util', function() {

  describe('#parseSchedule', function() {

    it('should parse reminder days and close day', function() {

      // when
      const schedule = parseSchedule('7, 14', '21');

      // then
      expect(schedule).to.eql({ reminderDays: [ 7, 14 ], closeAfterDays: 21 });
    });


    it('should allow no reminders', function() {

      // when
      const schedule = parseSchedule('', '21');

      // then
      expect(schedule).to.eql({ reminderDays: [], closeAfterDays: 21 });
    });


    it('should reject invalid schedules', function() {

      // then
      [
        [ '7,x', '21' ],
        [ '0', '21' ],
        [ '14,7', '21' ],
        [ '7,14', '14' ],
        [ '7,14', '' ]
      ].forEach(([ reminderDays, closeAfterDays ]) => {
        expect(() => parseSchedule(reminderDays, closeAfterDays)).to.throw(/invalid schedule/);
      });
    });

  });


  describe('#getSearchQuery', function() {

    it('should search open pull requests with a CLA invitation', function() {

      // when
      const query = getSearchQuery({ owner: 'bpmn-io' });

      // then
      expect(query).to.equal('org:bpmn-io is:pr is:open archived:false commenter:CLAassistant');
    });


    it('should exclude exempt label', function() {

      // when
      const query = getSearchQuery({ owner: 'bpmn-io', exemptLabel: 'cla exempt' });

      // then
      expect(query).to.equal('org:bpmn-io is:pr is:open archived:false commenter:CLAassistant -label:"cla exempt"');
    });


    it('should include additional repositories', function() {

      // when
      const query = getSearchQuery({
        owner: 'bpmn-io',
        repositories: [
          { owner: 'camunda', repo: 'camunda-modeler' },
          { owner: 'camunda', repo: 'linting' }
        ],
        exemptLabel: 'cla exempt'
      });

      // then
      expect(query).to.equal(
        'org:bpmn-io repo:camunda/camunda-modeler repo:camunda/linting ' +
        'is:pr is:open archived:false commenter:CLAassistant -label:"cla exempt"'
      );
    });

  });


  describe('#parseRepositories', function() {

    it('should parse comma-separated repositories', function() {

      // when
      const repositories = parseRepositories(' camunda/camunda-modeler, camunda/linting ,');

      // then
      expect(repositories).to.eql([
        { owner: 'camunda', repo: 'camunda-modeler' },
        { owner: 'camunda', repo: 'linting' }
      ]);
    });


    it('should parse repositories separated by new lines', function() {

      // when
      const repositories = parseRepositories('camunda/camunda-modeler\n  camunda/linting\n');

      // then
      expect(repositories).to.eql([
        { owner: 'camunda', repo: 'camunda-modeler' },
        { owner: 'camunda', repo: 'linting' }
      ]);
    });


    it('should ignore empty input', function() {

      // then
      expect(parseRepositories('')).to.eql([]);
      expect(parseRepositories(undefined)).to.eql([]);
    });


    it('should de-duplicate case-insensitively', function() {

      // when
      const repositories = parseRepositories('camunda/camunda-modeler,Camunda/Camunda-Modeler');

      // then
      expect(repositories).to.eql([ { owner: 'camunda', repo: 'camunda-modeler' } ]);
    });


    [
      'camunda',
      'camunda/',
      '/camunda-modeler',
      'camunda/camunda-modeler/extra',
      'camunda/camunda modeler'
    ].forEach(function(input) {

      it(`should reject <${ input }>`, function() {

        // then
        expect(() => parseRepositories(input)).to.throw('invalid repository');
      });

    });

  });


  describe('#getNextStep', function() {

    it('should do nothing without invitation', function() {

      // given
      const comments = [ comment('someone', 'LGTM', 0) ];

      // when
      const step = getNextStep({ comments, now: at(30), ...OPTIONS });

      // then
      expect(step).to.be.null;
    });


    it('should do nothing before first reminder is due', function() {

      // when
      const step = getNextStep({ comments: [ invitation() ], now: at(6), ...OPTIONS });

      // then
      expect(step).to.be.null;
    });


    it('should send first reminder', function() {

      // when
      const step = getNextStep({ comments: [ invitation() ], now: at(7), ...OPTIONS });

      // then
      expect(step).to.eql({ type: 'remind', number: 1 });
    });


    it('should tolerate a slightly early scheduled run', function() {

      // when
      const step = getNextStep({ comments: [ invitation() ], now: at(6.75), ...OPTIONS });

      // then
      expect(step).to.eql({ type: 'remind', number: 1 });
    });


    it('should send second reminder', function() {

      // given
      const comments = [ invitation(), reminder(1, 7) ];

      // when
      const step = getNextStep({ comments, now: at(14), ...OPTIONS });

      // then
      expect(step).to.eql({ type: 'remind', number: 2 });
    });


    it('should not send second reminder too early', function() {

      // given
      const comments = [ invitation(), reminder(1, 7) ];

      // when
      const step = getNextStep({ comments, now: at(13), ...OPTIONS });

      // then
      expect(step).to.be.null;
    });


    it('should close after all reminders', function() {

      // given
      const comments = [ invitation(), reminder(1, 7), reminder(2, 14) ];

      // when
      const step = getNextStep({ comments, now: at(21), ...OPTIONS });

      // then
      expect(step).to.eql({ type: 'close' });
    });


    it('should not close too early', function() {

      // given
      const comments = [ invitation(), reminder(1, 7), reminder(2, 14) ];

      // when
      const step = getNextStep({ comments, now: at(20), ...OPTIONS });

      // then
      expect(step).to.be.null;
    });


    it('should space out steps for long pending invitation', function() {

      // given
      const comments = [ invitation(), reminder(1, 60) ];

      // when
      const tooEarly = getNextStep({ comments, now: at(61), ...OPTIONS });
      const due = getNextStep({ comments, now: at(67), ...OPTIONS });

      // then
      expect(tooEarly).to.be.null;
      expect(due).to.eql({ type: 'remind', number: 2 });
    });


    it('should close without reminders', function() {

      // when
      const step = getNextStep({
        comments: [ invitation() ],
        now: at(21),
        reminderDays: [],
        closeAfterDays: 21,
        botLogin: BOT
      });

      // then
      expect(step).to.eql({ type: 'close' });
    });


    it('should not close twice', function() {

      // given
      const comments = [
        invitation(),
        reminder(1, 7),
        reminder(2, 14),
        comment(BOT, '<!-- cla-closed -->\nClosed', 21)
      ];

      // when
      const step = getNextStep({ comments, now: at(60), ...OPTIONS });

      // then
      expect(step).to.be.null;
    });


    it('should anchor on the first invitation', function() {

      // given
      const comments = [ invitation(), comment('CLAassistant', 'update', 6) ];

      // when
      const step = getNextStep({ comments, now: at(7), ...OPTIONS });

      // then
      expect(step).to.eql({ type: 'remind', number: 1 });
    });


    describe('robustness', function() {

      it('should ignore reminder markers of other authors', function() {

        // given
        const comments = [
          invitation(),
          comment('stranger', '<!-- cla-reminder:1 -->', 6),
          comment('stranger', '<!-- cla-reminder:2 -->', 6)
        ];

        // when
        const step = getNextStep({ comments, now: at(7), ...OPTIONS });

        // then
        expect(step).to.eql({ type: 'remind', number: 1 });
      });


      it('should ignore close marker of other authors', function() {

        // given
        const comments = [
          invitation(),
          reminder(1, 7),
          reminder(2, 14),
          comment('contributor', '<!-- cla-closed -->', 15)
        ];

        // when
        const step = getNextStep({ comments, now: at(21), ...OPTIONS });

        // then
        expect(step).to.eql({ type: 'close' });
      });


      it('should count a duplicated reminder once', function() {

        // given
        const comments = [ invitation(), reminder(1, 7), reminder(1, 7.01) ];

        // when
        const step = getNextStep({ comments, now: at(14), ...OPTIONS });

        // then
        expect(step).to.eql({ type: 'remind', number: 2 });
      });


      it('should not depend on comment order', function() {

        // given
        const comments = [
          reminder(2, 14),
          comment('CLAassistant', 'update', 6),
          reminder(1, 7),
          invitation()
        ];

        // when
        const step = getNextStep({ comments, now: at(21), ...OPTIONS });

        // then
        expect(step).to.eql({ type: 'close' });
      });

    });

  });


  describe('#getLabelChange', function() {

    const LABEL = 'cla not signed';


    it('should add label to unsigned pull request', function() {

      // then
      expect(getLabelChange({ signed: false, labels: [ { name: 'bug' } ], label: LABEL })).to.equal('add');
    });


    it('should keep label of unsigned pull request', function() {

      // then
      expect(getLabelChange({ signed: false, labels: [ { name: 'Cla Not Signed' } ], label: LABEL })).to.be.null;
    });


    it('should remove label once signed', function() {

      // then
      expect(getLabelChange({ signed: true, labels: [ { name: 'bug' }, { name: LABEL } ], label: LABEL })).to.equal('remove');
    });


    it('should leave signed pull request without label alone', function() {

      // then
      expect(getLabelChange({ signed: true, labels: [ { name: 'bug' } ], label: LABEL })).to.be.null;
    });


    it('should do nothing without label', function() {

      // then
      expect(getLabelChange({ signed: false, labels: [], label: '' })).to.be.null;
      expect(getLabelChange({ signed: true, labels: [ { name: LABEL } ], label: undefined })).to.be.null;
    });

  });



  describe('#wasClosedBy', function() {

    it('should detect a close by the user regardless of case', function() {

      // given
      const events = [ { event: 'closed', actor: { login: 'Bpmn-IO-Bot' } } ];

      // then
      expect(wasClosedBy(events, 'bpmn-io-bot')).to.be.true;
    });


    it('should ignore a close by somebody else', function() {

      // given
      const events = [ { event: 'closed', actor: { login: 'maintainer' } } ];

      // then
      expect(wasClosedBy(events, 'bpmn-io-bot')).to.be.false;
    });


    it('should ignore other events of the user', function() {

      // given
      const events = [
        { event: 'labeled', actor: { login: 'bpmn-io-bot' } },
        { event: 'reopened', actor: { login: 'bpmn-io-bot' } }
      ];

      // then
      expect(wasClosedBy(events, 'bpmn-io-bot')).to.be.false;
    });


    it('should handle events without actor', function() {

      // given
      const events = [ { event: 'closed', actor: null } ];

      // then
      expect(wasClosedBy(events, 'bpmn-io-bot')).to.be.false;
    });

  });


  describe('#getReminderBody', function() {

    it('should create reminder', function() {

      // when
      const body = getReminderBody({
        owner: 'bpmn-io',
        repo: 'form-js',
        number: 1567,
        author: 'contributor',
        reminder: 1,
        ...SCHEDULE
      });

      // then
      expect(body).to.match(/^<!-- cla-reminder:1 -->\n/);
      expect(body).to.contain('@contributor');
      expect(body).to.contain('https://cla-assistant.io/bpmn-io/form-js?pullRequest=1567');
      expect(body).to.contain('in 14 days');
    });


    it('should announce closing for last reminder', function() {

      // when
      const body = getReminderBody({
        owner: 'bpmn-io',
        repo: 'form-js',
        number: 1567,
        author: 'contributor',
        reminder: 2,
        ...SCHEDULE
      });

      // then
      expect(body).to.contain('@contributor');
      expect(body).to.contain('in 7 days');
    });

  });


  describe('#getCloseBody', function() {

    it('should create close comment', function() {

      // when
      const body = getCloseBody({
        owner: 'bpmn-io',
        repo: 'form-js',
        number: 1567,
        author: 'contributor',
        closeAfterDays: 21
      });

      // then
      expect(body).to.match(/^<!-- cla-closed -->\n/);
      expect(body).to.contain('@contributor');
      expect(body).to.contain('within 21 days');
      expect(body).to.contain('not eligible for consideration');
      expect(body).to.contain('https://cla-assistant.io/bpmn-io/form-js?pullRequest=1567');
    });

  });

});


// helpers //////////

function at(days) {
  return new Date(Date.parse(INVITED_AT) + days * DAY);
}

function comment(login, body, days) {
  return {
    user: { login },
    body,
    created_at: at(days).toISOString()
  };
}

function invitation() {
  return comment('CLAassistant', 'Please sign our CLA', 0);
}

function reminder(number, days) {
  return comment('bpmn-io-bot', `<!-- cla-reminder:${number} -->\nReminder`, days);
}
