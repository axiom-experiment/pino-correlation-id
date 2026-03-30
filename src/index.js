'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

// -------------------------------------------------------------------
// Storage — one ALS instance for the whole process
// -------------------------------------------------------------------
const storage = new AsyncLocalStorage();

/**
 * Get the current correlation ID from async context.
 * Returns undefined if called outside a request context.
 * @returns {string | undefined}
 */
function getCorrelationId() {
  const store = storage.getStore();
  return store ? store.correlationId : undefined;
}

/**
 * Get the full current store (correlationId + any custom fields).
 * @returns {object | undefined}
 */
function getStore() {
  return storage.getStore();
}

/**
 * Set a value in the current async context store.
 * No-op if called outside a request context.
 * @param {string} key
 * @param {*} value
 */
function setContext(key, value) {
  const store = storage.getStore();
  if (store) store[key] = value;
}

// -------------------------------------------------------------------
// Express middleware
// -------------------------------------------------------------------

/**
 * Create an Express middleware that:
 *  1. Reads X-Request-ID / X-Correlation-ID header (or generates UUID)
 *  2. Stores it in AsyncLocalStorage for the request lifetime
 *  3. Optionally wraps a pino logger into a child with `reqId` binding
 *  4. Attaches `req.correlationId` and `req.log` (child logger)
 *
 * @param {object} [options]
 * @param {import('pino').Logger} [options.logger]     Base pino logger
 * @param {string}  [options.header='x-request-id']    Header name to read/write
 * @param {boolean} [options.setResponseHeader=true]   Echo ID in response
 * @param {string}  [options.logKey='reqId']           Key used in pino bindings
 * @param {() => string} [options.generateId]          ID generator (default: UUID)
 * @returns {import('express').RequestHandler}
 */
function expressMiddleware(options = {}) {
  const {
    logger,
    header = 'x-request-id',
    setResponseHeader = true,
    logKey = 'reqId',
    generateId = randomUUID,
  } = options;

  return function pinoCorrelationMiddleware(req, res, next) {
    const id =
      req.headers[header] ||
      req.headers['x-correlation-id'] ||
      generateId();

    req.correlationId = id;

    if (setResponseHeader) {
      res.setHeader(header, id);
    }

    const store = { correlationId: id };

    if (logger) {
      req.log = logger.child({ [logKey]: id });
      store.logger = req.log;
    }

    storage.run(store, () => next());
  };
}

// -------------------------------------------------------------------
// Fastify plugin
// -------------------------------------------------------------------

/**
 * Fastify plugin that injects correlation IDs via AsyncLocalStorage.
 *
 * Register with: fastify.register(pinoCorrelationId.fastifyPlugin, { logger: fastify.log })
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} opts
 * @param {string}  [opts.header='x-request-id']
 * @param {boolean} [opts.setResponseHeader=true]
 * @param {string}  [opts.logKey='reqId']
 * @param {() => string} [opts.generateId]
 * @param {Function} done
 */
function fastifyPlugin(fastify, opts, done) {
  const {
    header = 'x-request-id',
    setResponseHeader = true,
    logKey = 'reqId',
    generateId = randomUUID,
  } = opts;

  fastify.addHook('onRequest', (request, reply, hookDone) => {
    const id =
      request.headers[header] ||
      request.headers['x-correlation-id'] ||
      generateId();

    request.correlationId = id;

    if (setResponseHeader) {
      reply.header(header, id);
    }

    const store = {
      correlationId: id,
      logger: request.log.child({ [logKey]: id }),
    };

    storage.run(store, () => hookDone());
  });

  done();
}

fastifyPlugin[Symbol.for('fastify.display-name')] = 'pino-correlation-id';
fastifyPlugin[Symbol.for('skip-override')] = true;

// -------------------------------------------------------------------
// Pino-only helper (no framework)
// -------------------------------------------------------------------

/**
 * Run a callback inside an async context with the given correlation ID.
 * Useful for background jobs, queue workers, or test scenarios.
 *
 * @param {string} correlationId
 * @param {import('pino').Logger | null} logger
 * @param {Function} fn
 * @returns {*}
 */
function runWithCorrelationId(correlationId, logger, fn) {
  const store = { correlationId };
  if (logger) {
    store.logger = logger.child({ reqId: correlationId });
  }
  return storage.run(store, fn);
}

/**
 * Get the pino child logger bound to the current correlation ID.
 * Falls back to the provided base logger if no context is available.
 * @param {import('pino').Logger} fallbackLogger
 * @returns {import('pino').Logger}
 */
function getLogger(fallbackLogger) {
  const store = storage.getStore();
  return (store && store.logger) || fallbackLogger;
}

// -------------------------------------------------------------------
// Exports
// -------------------------------------------------------------------
module.exports = {
  // Core API
  getCorrelationId,
  getStore,
  setContext,
  getLogger,
  runWithCorrelationId,

  // Framework integrations
  expressMiddleware,
  fastifyPlugin,

  // Expose ALS instance for advanced usage
  storage,
};
