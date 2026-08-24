import bpmnIoPlugin from 'eslint-plugin-bpmn-io';

const files = {
  ignored: [
    'release-issue/**',
    'pull-request-quality/**',
    'weekly-notes/**',
    'setup/**'
  ]
};

export default [
  {
    ignores: files.ignored
  },
  ...bpmnIoPlugin.configs.node,
  ...bpmnIoPlugin.configs.mocha.map(config => ({
    files: [ '**/*test.js', '**/test/**/*.js' ],
    ...config
  }))
];
