const { expect } = require('chai');
const {
  getNextIssueTitle
} = require('./util.js');

describe('weekly-notes/util#getNextIssueTitle', function() {

  it('should calculate next week title correctly for week 1', function() {
    expect(getNextIssueTitle(1, { weekNumber: 1, year: 2000 })).to.equal('W2 - 2000');
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