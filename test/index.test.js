'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  getCorrelationId,
  getStore,
  setContext,
  runWithCorrelationId,
  expressMiddleware,
  storage,
} = require('../src/index.js');

// ---------------------------------------------------------------------------
// Test 1: getCorrelationId returns undefined outside context
// ---------------------------------------------------------------------------
describe('getCorrelationId', () => {
  it('returns undefined when no context is active', () => {
    assert.strictEqual(getCorrelationId(), undefined);
  });

  it('returns the ID inside runWithCorrelationId', () => {
    runWithCorrelationId('test-id-001', null, () => {
      assert.strictEqual(getCorrelationId(), 'test-id-001');
    });
  });

  it('ID is gone after the callback exits', () => {
    runWithCorrelationId('test-id-002', null, () => {});
    assert.strictEqual(getCorrelationId(), undefined);
  });
});

// ---------------------------------------------------------------------------
// Test 2: getStore
// ---------------------------------------------------------------------------
describe('getStore', () => {
  it('returns undefined outside context', () => {
    assert.strictEqual(getStore(), undefined);
  });

  it('returns store object inside context', () => {
    runWithCorrelationId('store-test', null, () => {
      const s = getStore();
      assert.ok(s);
      assert.strictEqual(s.correlationId, 'store-test');
    });
  });
});

// ---------------------------------------------------------------------------
// Test 3: setContext
// ---------------------------------------------------------------------------
describe('setContext', () => {
  it('sets arbitrary values in current context', () => {
    runWithCorrelationId('ctx-test', null, () => {
      setContext('userId', 42);
      const s = getStore();
      assert.strictEqual(s.userId, 42);
    });
  });

  it('no-op outside context — does not throw', () => {
    assert.doesNotThrow(() => setContext('key', 'value'));
  });
});

// ---------------------------------------------------------------------------
// Test 4: runWithCorrelationId nesting
// ---------------------------------------------------------------------------
describe('runWithCorrelationId nesting', () => {
  it('inner context overrides outer', () => {
    runWithCorrelationId('outer', null, () => {
      assert.strictEqual(getCorrelationId(), 'outer');
      runWithCorrelationId('inner', null, () => {
        assert.strictEqual(getCorrelationId(), 'inner');
      });
      // Back to outer after inner exits
      assert.strictEqual(getCorrelationId(), 'outer');
    });
  });
});

// ---------------------------------------------------------------------------
// Test 5: runWithCorrelationId return value
// ---------------------------------------------------------------------------
describe('runWithCorrelationId return value', () => {
  it('returns the callback return value', () => {
    const result = runWithCorrelationId('ret-test', null, () => 'hello');
    assert.strictEqual(result, 'hello');
  });
});

// ---------------------------------------------------------------------------
// Test 6: expressMiddleware — ID from header
// ---------------------------------------------------------------------------
describe('expressMiddleware', () => {
  it('reads x-request-id from request headers', (t, done) => {
    const middleware = expressMiddleware();
    const req = { headers: { 'x-request-id': 'incoming-id-abc' }, correlationId: null };
    const res = { setHeader: () => {} };

    middleware(req, res, () => {
      assert.strictEqual(req.correlationId, 'incoming-id-abc');
      done();
    });
  });

  it('reads x-correlation-id header if x-request-id missing', (t, done) => {
    const middleware = expressMiddleware();
    const req = { headers: { 'x-correlation-id': 'corr-789' }, correlationId: null };
    const res = { setHeader: () => {} };

    middleware(req, res, () => {
      assert.strictEqual(req.correlationId, 'corr-789');
      done();
    });
  });

  it('generates a UUID when no header present', (t, done) => {
    const middleware = expressMiddleware();
    const req = { headers: {}, correlationId: null };
    const res = { setHeader: () => {} };

    middleware(req, res, () => {
      assert.ok(req.correlationId);
      assert.match(req.correlationId, /^[0-9a-f-]{36}$/);
      done();
    });
  });

  it('uses custom generateId function', (t, done) => {
    const middleware = expressMiddleware({ generateId: () => 'custom-fixed-id' });
    const req = { headers: {}, correlationId: null };
    const res = { setHeader: () => {} };

    middleware(req, res, () => {
      assert.strictEqual(req.correlationId, 'custom-fixed-id');
      done();
    });
  });

  it('sets response header by default', (t, done) => {
    const headers = {};
    const middleware = expressMiddleware();
    const req = { headers: { 'x-request-id': 'echo-me' } };
    const res = { setHeader: (k, v) => { headers[k] = v; } };

    middleware(req, res, () => {
      assert.strictEqual(headers['x-request-id'], 'echo-me');
      done();
    });
  });

  it('skips response header when setResponseHeader=false', (t, done) => {
    const headers = {};
    const middleware = expressMiddleware({ setResponseHeader: false });
    const req = { headers: { 'x-request-id': 'no-echo' } };
    const res = { setHeader: (k, v) => { headers[k] = v; } };

    middleware(req, res, () => {
      assert.strictEqual(headers['x-request-id'], undefined);
      done();
    });
  });

  it('makes correlationId available via getCorrelationId() inside next()', (t, done) => {
    const middleware = expressMiddleware();
    const req = { headers: { 'x-request-id': 'als-check' } };
    const res = { setHeader: () => {} };

    middleware(req, res, () => {
      // Inside next() we are in the ALS context
      assert.strictEqual(getCorrelationId(), 'als-check');
      done();
    });
  });

  it('uses custom header name', (t, done) => {
    const headers = {};
    const middleware = expressMiddleware({ header: 'x-trace-id' });
    const req = { headers: { 'x-trace-id': 'custom-header-test' } };
    const res = { setHeader: (k, v) => { headers[k] = v; } };

    middleware(req, res, () => {
      assert.strictEqual(req.correlationId, 'custom-header-test');
      assert.strictEqual(headers['x-trace-id'], 'custom-header-test');
      done();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 7: async propagation
// ---------------------------------------------------------------------------
describe('async propagation', () => {
  it('propagates correlation ID through async callbacks', async () => {
    await new Promise((resolve) => {
      runWithCorrelationId('async-test-123', null, async () => {
        await new Promise(r => setTimeout(r, 5));
        assert.strictEqual(getCorrelationId(), 'async-test-123');
        resolve();
      });
    });
  });

  it('propagates through Promise.all', async () => {
    const results = await new Promise((resolve) => {
      runWithCorrelationId('parallel-test', null, async () => {
        const ids = await Promise.all([
          Promise.resolve(getCorrelationId()),
          new Promise(r => setTimeout(() => r(getCorrelationId()), 1)),
        ]);
        resolve(ids);
      });
    });
    assert.deepStrictEqual(results, ['parallel-test', 'parallel-test']);
  });
});

// ---------------------------------------------------------------------------
// Test 8: storage export is the ALS instance
// ---------------------------------------------------------------------------
describe('storage export', () => {
  it('exports the underlying AsyncLocalStorage instance', () => {
    const { AsyncLocalStorage } = require('async_hooks');
    assert.ok(storage instanceof AsyncLocalStorage);
  });
});
