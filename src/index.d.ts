import type { RequestHandler } from 'express';
import type { FastifyPluginCallback } from 'fastify';
import type { Logger } from 'pino';
import type { AsyncLocalStorage } from 'async_hooks';

export interface CorrelationStore {
  correlationId: string;
  logger?: Logger;
  [key: string]: unknown;
}

export interface ExpressMiddlewareOptions {
  /** Base pino logger to create child loggers from */
  logger?: Logger;
  /** Header name to read/write (default: 'x-request-id') */
  header?: string;
  /** Echo the ID in the response header (default: true) */
  setResponseHeader?: boolean;
  /** Pino binding key for the request ID (default: 'reqId') */
  logKey?: string;
  /** Custom ID generator (default: crypto.randomUUID) */
  generateId?: () => string;
}

export interface FastifyPluginOptions {
  header?: string;
  setResponseHeader?: boolean;
  logKey?: string;
  generateId?: () => string;
}

/** Get the correlation ID from the current async context */
export function getCorrelationId(): string | undefined;

/** Get the full async context store */
export function getStore(): CorrelationStore | undefined;

/** Set a value in the current async context store */
export function setContext(key: string, value: unknown): void;

/**
 * Get the pino child logger bound to the current correlation ID.
 * Falls back to the provided base logger if outside a request context.
 */
export function getLogger(fallbackLogger: Logger): Logger;

/**
 * Run a function inside an async context with the given correlation ID.
 * Useful for workers, queues, and tests.
 */
export function runWithCorrelationId<T>(
  correlationId: string,
  logger: Logger | null,
  fn: () => T
): T;

/** Express middleware factory */
export function expressMiddleware(options?: ExpressMiddlewareOptions): RequestHandler;

/** Fastify plugin */
export const fastifyPlugin: FastifyPluginCallback<FastifyPluginOptions>;

/** Underlying AsyncLocalStorage instance (advanced usage) */
export const storage: AsyncLocalStorage<CorrelationStore>;
