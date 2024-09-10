const {
  getNextAssignee
} = require('./util.js');

const assert = require('node:assert');

const assignees = [
  { login: 'walt', fullName: 'WALT' },
  { login: 'lisa', fullName: 'LISA' },
  { login: 'bert', fullName: 'Bert' }
];

function verify(currentLogin, nextLogin, offset) {

  const next = getNextAssignee(assignees, { login: currentLogin }, offset);

  assert.equal(next?.login, nextLogin);
}

verify('walt', 'lisa');
verify('unknown', 'walt');
verify(null, 'walt');
verify(null, 'lisa', 2);
verify('bert', 'walt');
verify('walt', 'bert', 2);
verify('walt', 'walt', 3);
