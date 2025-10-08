const {
  getNextAssignee
} = require('./util.js');

const { expect } = require('chai');

const assignees = [
  { login: 'walt', fullName: 'WALT' },
  { login: 'lisa', fullName: 'LISA' },
  { login: 'bert', fullName: 'BERT' },
  { login: 'maggie', fullName: 'MAGGIE' }
];

describe('shared/util#getNextAssignee', function() {

  it('should return next assignee', function() {
    const next = getNextAssignee(assignees, { login: 'walt' });
    expect(next?.login).to.eql('lisa');
  });


  it('should return second next assignee for offset 2', function() {
    const next = getNextAssignee(assignees, { login: 'walt' }, 2);
    expect(next?.login).to.eql('bert');
  });


  it('should return first assignee when current is unknown', function() {
    const next = getNextAssignee(assignees, { login: 'unknown' });
    expect(next?.login).to.eql('walt');
  });


  it('should return first assignee when current is null', function() {
    const next = getNextAssignee(assignees, { login: null });
    expect(next?.login).to.eql('walt');
  });


  it('should return second assignee when current is null and offset is 2', function() {
    const next = getNextAssignee(assignees, { login: null }, 2);
    expect(next?.login).to.eql('lisa');
  });


  it('should return first assignee when current is the last on the list', function() {
    const next = getNextAssignee(assignees, { login: 'maggie' });
    expect(next?.login).to.eql('walt');
  });


  it('should roll over the assignee list', function() {
    const next = getNextAssignee(assignees, { login: 'walt' }, 4);
    expect(next?.login).to.eql('walt');
  });
});

