import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';
import { env } from '../src/config/env.js';

/**
 * An unexpected failure never answers with its stack trace.
 *
 * The exploratory testing report recorded raw stack traces and file paths in
 * failure responses. The cause was not in the assistant: errorHandler returned
 * `err.stack` whenever the process was in development mode, and development is
 * what NODE_ENV defaults to -- docker-compose ships it -- so an ordinary
 * deployment answered a database failure with its internals.
 */

let server;
let base;
const saved = { isDev: env.isDev, isProd: env.isProd, flag: process.env.DEBUG_ERROR_STACKS };

beforeAll(async () => {
  const app = express();
  app.get('/boom', () => {
    throw Object.assign(
      new Error('connect ECONNREFUSED mongodb://admin:hunter2@10.1.2.3:27017 at C:\\app\\src\\modules\\fees\\fee.service.js:120:7'),
      { name: 'MongoNetworkError' },
    );
  });
  app.get('/refused', () => { throw new AppError('You are not authorized to access this information.', 403, [], 'AGENT_FORBIDDEN'); });
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

afterEach(() => {
  env.isDev = saved.isDev;
  env.isProd = saved.isProd;
  if (saved.flag === undefined) delete process.env.DEBUG_ERROR_STACKS;
  else process.env.DEBUG_ERROR_STACKS = saved.flag;
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, text: await res.text() };
};

const INTERNALS = /ECONNREFUSED|hunter2|10\.1\.2\.3|fee\.service|C:\\\\app|\bat\s+\S+.*:\d+:\d+|node_modules|MongoNetworkError/;

describe('an unexpected error', () => {
  it.each([
    ['development', true, false],
    ['test / staging', false, false],
    ['production', false, true],
  ])('in %s answers "Internal server error" and nothing about its cause', async (_mode, isDev, isProd) => {
    env.isDev = isDev;
    env.isProd = isProd;
    delete process.env.DEBUG_ERROR_STACKS;
    const res = await get('/boom');
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(INTERNALS);
    expect(JSON.parse(res.text)).toMatchObject({ success: false, message: 'Internal server error' });
  });

  it('returns the stack only when it is asked for by name, in development', async () => {
    env.isDev = true;
    env.isProd = false;
    process.env.DEBUG_ERROR_STACKS = 'true';
    expect((await get('/boom')).text).toMatch(/fee\.service/);
  });

  it('never returns it in production, whatever the flag says', async () => {
    env.isDev = false;
    env.isProd = true;
    process.env.DEBUG_ERROR_STACKS = 'true';
    expect((await get('/boom')).text).not.toMatch(INTERNALS);
  });
});

describe('a refusal', () => {
  it('keeps its own message and status, with no stack either way', async () => {
    env.isDev = true;
    process.env.DEBUG_ERROR_STACKS = 'true';
    const res = await get('/refused');
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toMatchObject({
      message: 'You are not authorized to access this information.', errors: [], error: { code: 'AGENT_FORBIDDEN' },
    });
    expect(res.text).not.toMatch(/\bat\s+\S+.*:\d+:\d+/);
  });
});
