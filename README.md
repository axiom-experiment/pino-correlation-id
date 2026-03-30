# pino-correlation-id

> Express/Fastify middleware that injects correlation IDs into pino loggers via AsyncLocalStorage — zero boilerplate distributed request tracing.

[![npm version](https://badge.fury.io/js/pino-correlation-id.svg)](https://www.npmjs.com/package/pino-correlation-id)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Every request deserves a traceable ID that flows through your entire call stack — from HTTP handler through service layers, database queries, and background jobs — without manually passing `logger` as a parameter everywhere.

`pino-correlation-id` solves this using Node.js's built-in `AsyncLocalStorage`. One middleware call, and your correlation ID is available anywhere in the async call chain.

---

## Features

- **Zero dependencies** — uses Node.js built-ins only (`async_hooks`, `crypto`)
- **Express + Fastify** — first-class support for both frameworks
- **AsyncLocalStorage** — ID flows automatically through all async operations
- **Header forwarding** — reads `X-Request-ID` / `X-Correlation-ID` from upstream services
- **Pino child loggers** — every log line in a request automatically includes `reqId`
- **TypeScript support** — full type definitions included
- **Framework-agnostic core** — works with queues, workers, and any async code

---

## Installation

```bash
npm install pino-correlation-id
```

Node.js >= 18 required.

---

## Quick Start — Express

```js
const express = require('express');
const pino = require('pino');
const { expressMiddleware, getCorrelationId, getLogger } = require('pino-correlation-id');

const logger = pino();
const app = express();

// Register middleware early — before any routes
app.use(expressMiddleware({ logger }));

app.get('/users/:id', async (req, res) => {
  // req.log is a pino child logger with reqId bound
  req.log.info({ userId: req.params.id }, 'Fetching user');

  // OR call getLogger() from any function in the call stack
  await fetchUser(req.params.id);

  res.json({ id: req.params.id });
});

async function fetchUser(id) {
  // No need to pass logger — it's available via AsyncLocalStorage
  const log = getLogger(logger);
  log.info({ id }, 'Running DB query');

  // The log line will contain reqId automatically
}

app.listen(3000);
```

Every log line will now include `"reqId":"550e8400-..."` without any manual plumbing.

---

## Quick Start — Fastify

```js
const fastify = require('fastify')({ logger: true });
const { fastifyPlugin, getCorrelationId } = require('pino-correlation-id');

fastify.register(fastifyPlugin);

fastify.get('/users/:id', async (request, reply) => {
  // Correlation ID is available globally in this request context
  const id = getCorrelationId();
  request.log.info({ correlationId: id }, 'Request received');
  return { id: request.params.id };
});
```

---

## API

### `expressMiddleware(options?)`

Returns an Express `RequestHandler`. Place it early in your middleware chain.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | `pino.Logger` | — | Base pino logger. If provided, creates `req.log` as a child. |
| `header` | `string` | `'x-request-id'` | Header to read from request and write to response. |
| `setResponseHeader` | `boolean` | `true` | Echo the ID back in the response header. |
| `logKey` | `string` | `'reqId'` | Pino binding key for the ID. |
| `generateId` | `() => string` | `crypto.randomUUID` | Custom ID generator. |

After the middleware runs:
- `req.correlationId` — the correlation ID string
- `req.log` — pino child logger (if `logger` option provided)

---

### `fastifyPlugin`

Fastify plugin registered via `fastify.register()`. Accepts the same options as Express middleware (except `logger` — Fastify uses `request.log` directly).

---

### `getCorrelationId()`

Returns the current correlation ID, or `undefined` if called outside a request context.

```js
const { getCorrelationId } = require('pino-correlation-id');

async function sendEmail(to, subject) {
  console.log(`[${getCorrelationId()}] Sending email to ${to}`);
}
```

---

### `getLogger(fallbackLogger)`

Returns the pino child logger bound to the current correlation ID. Falls back to `fallbackLogger` if outside a request context. Use this in shared service modules.

```js
const { getLogger } = require('pino-correlation-id');
const rootLogger = require('./logger'); // your base pino instance

async function processPayment(amount) {
  const log = getLogger(rootLogger);
  log.info({ amount }, 'Processing payment'); // reqId automatically included
}
```

---

### `runWithCorrelationId(correlationId, logger, fn)`

Run any function inside an async context with a given correlation ID. Useful for queue workers, background jobs, and tests.

```js
const { runWithCorrelationId, getCorrelationId } = require('pino-correlation-id');

// In a BullMQ worker
worker.process(async (job) => {
  await runWithCorrelationId(job.data.correlationId, logger, async () => {
    // getCorrelationId() works here
    await processJob(job);
  });
});
```

---

### `setContext(key, value)`

Set additional values in the current async store. Useful for propagating user IDs, tenant IDs, etc.

```js
app.use(expressMiddleware({ logger }));

app.use(async (req, res, next) => {
  const user = await authenticate(req);
  setContext('userId', user.id);  // Available anywhere downstream
  next();
});
```

---

### `getStore()`

Returns the full async store object (`{ correlationId, logger, ...custom }`).

---

### `storage`

The underlying `AsyncLocalStorage` instance — for advanced usage or custom integrations.

---

## Passing IDs Between Services

When calling downstream services, forward the correlation ID:

```js
const { getCorrelationId } = require('pino-correlation-id');

async function callUserService(userId) {
  const response = await fetch(`http://users-svc/users/${userId}`, {
    headers: {
      'X-Request-ID': getCorrelationId() || crypto.randomUUID(),
    },
  });
  return response.json();
}
```

The downstream service (also using `pino-correlation-id`) will pick up the same ID from the header, giving you end-to-end traces.

---

## OpenTelemetry Integration

Combine with OpenTelemetry for trace-log correlation:

```js
const { trace } = require('@opentelemetry/api');
const { expressMiddleware, getCorrelationId } = require('pino-correlation-id');

app.use(expressMiddleware({
  logger,
  generateId: () => {
    // Use OTel trace ID as correlation ID for unified tracing
    const span = trace.getActiveSpan();
    if (span) {
      return span.spanContext().traceId;
    }
    return crypto.randomUUID();
  }
}));
```

---

## Testing

```js
const { runWithCorrelationId, getCorrelationId } = require('pino-correlation-id');

it('should log with correlation ID', async () => {
  await runWithCorrelationId('test-request-123', logger, async () => {
    await myService.doWork();
    assert.strictEqual(getCorrelationId(), 'test-request-123');
  });
});
```

---

## Requirements

- Node.js >= 18.0.0 (AsyncLocalStorage stabilized in v16, but 18+ recommended for production)
- pino >= 8.0.0 (peer dep, optional — works without if you don't use the logger integration)

---

## License

MIT

---

*Built by [AXIOM](https://axiom-experiment.github.io) — an autonomous AI business agent experiment.*

*Sponsor this work: [GitHub Sponsors](https://github.com/sponsors/axiom-experiment) | [Buy Me a Coffee](https://buymeacoffee.com/axiomexperiment)*
