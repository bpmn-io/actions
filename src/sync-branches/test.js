import { expect } from 'chai';

import {
  fillTemplate,
  openMergePullRequest
} from './util.js';

const OPTIONS = {
  owner: 'bpmn-io',
  repo: 'demo',
  source: 'main',
  target: 'develop',
  title: 'title',
  body: 'body'
};

function createRest({ aheadBy = 0, open = [], create } = {}) {
  const calls = { compare: [], list: [], create: [] };

  return {
    calls,
    repos: {
      compareCommitsWithBasehead: async (args) => {
        calls.compare.push(args);

        return { data: { ahead_by: aheadBy } };
      }
    },
    pulls: {
      list: async (args) => {
        calls.list.push(args);

        return { data: typeof open === 'function' ? open(calls.list.length) : open };
      },
      create: async (args) => {
        calls.create.push(args);

        if (create) {
          return create(args);
        }

        return { data: { number: 7, html_url: 'https://example.com/pull/7' } };
      }
    }
  };
}


describe('sync-branches/util', function() {

  it('should fill placeholders', function() {
    expect(fillTemplate('merge {{source}} into {{target}} ({{source}})', {
      source: 'main',
      target: 'live'
    })).to.equal('merge main into live (main)');
  });


  it('should preserve dollar sequences in branch names', function() {
    expect(fillTemplate('{{source}} -> {{target}}', {
      source: 'fix/$&',
      target: 'a$`b$\'c$1'
    })).to.equal('fix/$& -> a$`b$\'c$1');
  });


  it('should not replace placeholders inside branch names', function() {
    expect(fillTemplate('merge {{source}} into {{target}}', {
      source: 'release/{{target}}',
      target: 'develop'
    })).to.equal('merge release/{{target}} into develop');
  });


  it('should create a pull request if source is ahead', async function() {

    // given
    const rest = createRest({ aheadBy: 2 });

    // when
    const result = await openMergePullRequest(rest, OPTIONS);

    // then
    expect(result.created).to.be.true;
    expect(result.pullRequest.number).to.equal(7);

    expect(rest.calls.compare[0].basehead).to.equal('develop...main');
    expect(rest.calls.create).to.have.length(1);
    expect(rest.calls.create[0]).to.include({
      head: 'main',
      base: 'develop',
      title: 'title',
      body: 'body'
    });
  });


  it('should respect configured branches', async function() {

    // given
    const rest = createRest({ aheadBy: 1 });

    // when
    await openMergePullRequest(rest, { ...OPTIONS, source: 'release', target: 'live' });

    // then
    expect(rest.calls.compare[0].basehead).to.equal('live...release');
    expect(rest.calls.list[0]).to.include({ head: 'bpmn-io:release', base: 'live' });
    expect(rest.calls.create[0]).to.include({ head: 'release', base: 'live' });
  });


  it('should do nothing if target contains all source commits', async function() {

    // given
    const rest = createRest({ aheadBy: 0 });

    // when
    const result = await openMergePullRequest(rest, OPTIONS);

    // then
    expect(result.created).to.be.false;
    expect(rest.calls.create).to.be.empty;
  });


  it('should do nothing if a pull request is already open', async function() {

    // given
    const existing = { number: 3, html_url: 'https://example.com/pull/3' };
    const rest = createRest({ aheadBy: 1, open: [ existing ] });

    // when
    const result = await openMergePullRequest(rest, OPTIONS);

    // then
    expect(result.created).to.be.false;
    expect(result.pullRequest).to.equal(existing);
    expect(rest.calls.create).to.be.empty;
  });


  it('should treat a concurrently created pull request as existing', async function() {

    // given
    const existing = { number: 3, html_url: 'https://example.com/pull/3' };

    const rest = createRest({
      aheadBy: 1,
      open: (call) => call === 1 ? [] : [ existing ],
      create: () => {
        throw Object.assign(
          new Error('Validation Failed: A pull request already exists for bpmn-io:main.'),
          { status: 422 }
        );
      }
    });

    // when
    const result = await openMergePullRequest(rest, OPTIONS);

    // then
    expect(result.created).to.be.false;
    expect(result.pullRequest).to.equal(existing);
  });


  it('should propagate unrelated creation errors', async function() {

    // given
    const rest = createRest({
      aheadBy: 1,
      create: () => {
        throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
      }
    });

    // when
    let error;

    try {
      await openMergePullRequest(rest, OPTIONS);
    } catch (e) {
      error = e;
    }

    // then
    expect(error).to.exist;
    expect(error.status).to.equal(403);
  });


  it('should reject identical branches', async function() {

    // when
    let error;

    try {
      await openMergePullRequest(createRest(), { ...OPTIONS, target: 'main' });
    } catch (e) {
      error = e;
    }

    // then
    expect(error).to.exist;
  });

});
