const test = require('node:test');
const assert = require('node:assert');

const { linearRequest } = require('../shared.js');

test('linearRequest throws LINEAR_NO_API_KEY if apiKey missing', async () => {
  await assert.rejects(
    linearRequest({ query: '{ viewer { id } }', apiKey: '', fetchFn: () => {} }),
    /LINEAR_NO_API_KEY/
  );
});

test('linearRequest returns data on successful response', async () => {
  const fakeFetch = async (url, opts) => {
    assert.strictEqual(url, 'https://api.linear.app/graphql');
    assert.strictEqual(opts.method, 'POST');
    const body = JSON.parse(opts.body);
    assert.ok(body.query.includes('viewer'));
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { viewer: { id: 'u1' } } }),
    };
  };
  const out = await linearRequest({
    query: 'query { viewer { id } }',
    apiKey: 'lin_api_test',
    fetchFn: fakeFetch,
  });
  assert.deepStrictEqual(out, { viewer: { id: 'u1' } });
});

test('linearRequest throws LINEAR_AUTH on 401', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 401, text: async () => 'unauthorized',
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /LINEAR_AUTH/
  );
});

test('linearRequest throws LINEAR_RATE_LIMIT on 429', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 429, text: async () => 'rate limited',
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /LINEAR_RATE_LIMIT/
  );
});

test('linearRequest throws on GraphQL-level errors', async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ errors: [{ message: 'Team not found' }] }),
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /Team not found/
  );
});
