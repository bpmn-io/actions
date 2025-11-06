const { expect } = require('chai');
const {
  getNextIssueTitle,
  getFirstAssignee,
  withAssignee,
  evaluateTemplate
} = require('./util.js');

describe('weekly-notes/util', function() {

  describe('#getNextIssueTitle', function() {

    it('should calculate next week title correctly for week 1', function() {
      expect(getNextIssueTitle(1, { weekNumber: 1, year: 2000 })).to.equal('W2 - 2000');
    });

    it('should calculate next week title correctly for week 1 with an empty custom template', function() {
      expect(getNextIssueTitle(1, { weekNumber: 1, year: 2000 }, '')).to.equal('W2 - 2000');
    });

    it('should calculate next week title correctly for week 1 with a custom template', function() {
      expect(getNextIssueTitle(1, { weekNumber: 1, year: 2000 }, 'Custom Template in week {{week}} of year {{year}}')).to.equal('Custom Template in week 2 of year 2000');
    });

    it('should calculate next week title correctly for 2 weeks ahead from week 1', function() {
      expect(getNextIssueTitle(2, { weekNumber: 1, year: 2000 })).to.equal('W3 - 2000');
    });


    it('should calculate next week title correctly for week 5', function() {
      expect(getNextIssueTitle(1, { weekNumber: 5, year: 2000 })).to.equal('W6 - 2000');
    });


    it('should calculate next week title correctly for 2 weeks ahead from week 5', function() {
      expect(getNextIssueTitle(2, { weekNumber: 5, year: 2000 })).to.equal('W7 - 2000');
    });


    it('should handle year rollover from week 52', function() {
      expect(getNextIssueTitle(1, { weekNumber: 52, year: 2000 })).to.equal('W1 - 2001');
    });


    it('should handle year rollover for 2 weeks ahead from week 52', function() {
      expect(getNextIssueTitle(2, { weekNumber: 52, year: 2000 })).to.equal('W2 - 2001');
    });


    it('should handle year rollover from week 53', function() {
      expect(getNextIssueTitle(1, { weekNumber: 53, year: 2000 })).to.equal('W1 - 2001');
    });


    it('should handle year rollover for 2 weeks ahead from week 53', function() {
      expect(getNextIssueTitle(2, { weekNumber: 53, year: 2000 })).to.equal('W2 - 2001');
    });
  });

  describe('#evaluateTemplate', function() {

    it('should evaluate template with provided data', function() {
      const template = 'Hello {{name}}';
      const data = { name: 'World' };
      const result = evaluateTemplate(template, data);
      expect(result).to.equal('Hello World');
    });

    it('should evaluate a template without placeholders', function() {
      const template = 'Hello World';
      const data = { hello: 'Ignored' };
      const result = evaluateTemplate(template, data);
      expect(result).to.equal('Hello World');
    });

  });

  describe('#getFirstAssignee', function() {

    it('should extract assignee from issue contents', function() {

      // given
      const issueContents = 'Some issue content\n\n<!-- assignee: @johndoe -->';

      // when
      const assignee = getFirstAssignee(issueContents);

      // then
      expect(assignee.login).to.equal('johndoe');
    });


    it('should return null when no assignee tag is present', function() {

      // given
      const issueContents = 'Some issue content without assignee';

      // when
      const assignee = getFirstAssignee(issueContents);

      // then
      expect(assignee).to.be.null;
    });


    it('should return first assignee when multiple assignee tags are present', function() {

      // given
      const issueContents = 'Some content\n<!-- assignee: @first -->\nMore content\n<!-- assignee: @second -->';

      // when
      const assignee = getFirstAssignee(issueContents);

      // then
      expect(assignee.login).to.equal('first');
    });

    it('should handle assignee tag in the middle of content', function() {

      // given
      const issueContents = 'Start content\n<!-- assignee: @username -->\nEnd content';

      // when
      const assignee = getFirstAssignee(issueContents);

      // then
      expect(assignee.login).to.equal('username');
    });


    it('should return null for malformed assignee tag', function() {

      // given
      const issueContents = 'Some content\n<!-- assignee: username -->\nMore content';

      // when
      const assignee = getFirstAssignee(issueContents);

      // then
      expect(assignee).to.be.null;
    });
  });


  describe('#withAssignee', function() {

    it('should add assignee tag to issue contents', function() {

      // given
      const issueContents = 'Original issue content';

      // when
      const result = withAssignee(issueContents, { login: 'johndoe' });

      // then
      expect(result).to.equal('Original issue content\n\n<!-- assignee: @johndoe -->');
    });


    it('should add assignee tag to empty content', function() {

      // given
      const issueContents = '';

      // when
      const result = withAssignee(issueContents, { login: 'username' });

      // then
      expect(result).to.equal('\n\n<!-- assignee: @username -->');
    });


    it('should throw error when assignee is not provided', function() {

      // given
      const issueContents = 'Some content';

      // then
      [
        null,
        undefined,
        ''
      ].forEach(value => {
        expect(() => withAssignee(issueContents, value)).to.throw('assignee must be provided');
      });
    });
  });
});