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

// ─── linearFindOrCreateIssue ────────────────────────────────────────────

const { linearFindOrCreateIssue, OrphanIssueError } = require('../shared.js');

function mkCtx(over = {}) {
  return {
    canonicalHsUrl: 'https://secure.helpscout.net/conversation/333/44',
    subject: 'Subj', customer: 'Cust', ticketNumber: '44',
    hsConvIdLong: '333', hsConvIdShort: '44',
    emails: ['a@b.com'], hsCustomerId: '999',
    ...over,
  };
}
function mkConfig(over = {}) {
  return {
    linearApiKey: 'x', linearDefaultTeamId: 't-id',
    linearViewerId: 'u-id', linearInProgressStateId: 's-id',
    ...over,
  };
}

test('linearFindOrCreateIssue returns existing issue when lookup succeeds', async () => {
  let callCount = 0;
  const fakeFetch = async (_url, opts) => {
    callCount++;
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          data: { attachmentsForURL: { nodes: [{ issue: { identifier: 'LIN-1234', title: 'Existing', id: 'iss-id' } }] } },
        }),
      };
    }
    throw new Error(`Unexpected query: ${body.query}`);
  };
  const out = await linearFindOrCreateIssue({
    ctx: mkCtx(), config: mkConfig(), fetchFn: fakeFetch,
  });
  assert.strictEqual(out.issueKey, 'LIN-1234');
  assert.strictEqual(out.issueTitle, 'Existing');
  assert.strictEqual(out.wasCreated, false);
  assert.strictEqual(callCount, 1);
});

test('linearFindOrCreateIssue creates issue + attachment when lookup empty', async () => {
  const calls = [];
  const fakeFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.query.includes('attachmentsForURL') ? 'lookup'
            : body.query.includes('issueCreate') ? 'issueCreate'
            : body.query.includes('attachmentCreate') ? 'attachmentCreate'
            : 'unknown');
    if (body.query.includes('attachmentsForURL')) {
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-5678', title: 'New subject [HS: #44]' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { attachmentCreate: { success: true, attachment: { id: 'att-1' } } } }),
      };
    }
    throw new Error('Unexpected');
  };
  const out = await linearFindOrCreateIssue({
    ctx: mkCtx({ subject: 'New subject', customer: 'New cust' }),
    config: mkConfig(), fetchFn: fakeFetch,
  });
  assert.deepStrictEqual(calls, ['lookup', 'issueCreate', 'attachmentCreate']);
  assert.strictEqual(out.issueKey, 'LIN-5678');
  assert.strictEqual(out.wasCreated, true);
});

test('linearFindOrCreateIssue retries attachmentCreate once on failure', async () => {
  const calls = [];
  let attachmentAttempts = 0;
  const fakeFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      calls.push('lookup');
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      calls.push('issueCreate');
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-5678', title: 't' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      attachmentAttempts++;
      calls.push(`attachmentCreate#${attachmentAttempts}`);
      if (attachmentAttempts === 1) {
        return { ok: false, status: 500, text: async () => 'server error' };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ data: { attachmentCreate: { success: true, attachment: { id: 'att-1' } } } }),
      };
    }
    throw new Error('Unexpected');
  };
  const out = await linearFindOrCreateIssue({
    ctx: mkCtx({ emails: [], hsCustomerId: null }),
    config: mkConfig(),
    fetchFn: fakeFetch,
    retryDelayMs: 0,
  });
  assert.deepStrictEqual(calls, ['lookup', 'issueCreate', 'attachmentCreate#1', 'attachmentCreate#2']);
  assert.strictEqual(out.wasCreated, true);
});

test('linearFindOrCreateIssue throws OrphanIssueError on repeated attachmentCreate failure', async () => {
  const fakeFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-777', title: 't' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      return { ok: false, status: 500, text: async () => 'down' };
    }
    throw new Error('Unexpected');
  };
  await assert.rejects(
    linearFindOrCreateIssue({
      ctx: mkCtx({ emails: [], hsCustomerId: null }),
      config: mkConfig(),
      fetchFn: fakeFetch,
      retryDelayMs: 0,
    }),
    (err) => err instanceof OrphanIssueError && err.issueKey === 'LIN-777'
  );
});

test('linearFindOrCreateIssue throws LINEAR_CONFIG_MISSING when config incomplete', async () => {
  await assert.rejects(
    linearFindOrCreateIssue({
      ctx: mkCtx(),
      config: mkConfig({ linearDefaultTeamId: '' }),
      fetchFn: () => { throw new Error('should not fetch'); },
    }),
    /LINEAR_CONFIG_MISSING/
  );
});

// ─── createConvLock ─────────────────────────────────────────────────────

const { createConvLock } = require('../shared.js');

test('createConvLock dedupes concurrent calls with same key', async () => {
  const lock = createConvLock();
  let callCount = 0;
  const worker = async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 10));
    return callCount;
  };
  const [a, b] = await Promise.all([
    lock.run('key1', worker),
    lock.run('key1', worker),
  ]);
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1);
  assert.strictEqual(callCount, 1);
});

test('createConvLock allows different keys in parallel', async () => {
  const lock = createConvLock();
  let callCount = 0;
  const worker = async () => { callCount++; return callCount; };
  const [a, b] = await Promise.all([
    lock.run('k1', worker),
    lock.run('k2', worker),
  ]);
  assert.strictEqual(callCount, 2);
  assert.notStrictEqual(a, b);
});

test('createConvLock releases after failure', async () => {
  const lock = createConvLock();
  await assert.rejects(lock.run('k', async () => { throw new Error('boom'); }), /boom/);
  const out = await lock.run('k', async () => 42);
  assert.strictEqual(out, 42);
});
