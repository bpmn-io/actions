const {
  getNextIssueTitle
} = require('./util.js');

const assert = require('node:assert');


assert.deepEqual(
  getNextIssueTitle(1, { weekNumber: 5, year: 2000 }), 'W6 - 2000'
);

assert.deepEqual(
  getNextIssueTitle(2, { weekNumber: 5, year: 2000 }), 'W7 - 2000'
);

assert.deepEqual(
  getNextIssueTitle(1, { weekNumber: 52, year: 2000 }), 'W1 - 2001'
);

assert.deepEqual(
  getNextIssueTitle(2, { weekNumber: 52, year: 2000 }), 'W2 - 2001'
);

assert.deepEqual(
  getNextIssueTitle(1, { weekNumber: 53, year: 2000 }), 'W1 - 2001'
);

assert.deepEqual(
  getNextIssueTitle(2, { weekNumber: 53, year: 2000 }), 'W2 - 2001'
);