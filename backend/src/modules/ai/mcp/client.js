import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, SESSION_META_KEY, CONFIRM_META_KEY, WINDOW_META_KEY, SERVER_NAME } from './server.js';
import { withSession } from './session.js';
import { fail, errorToAppError, MCP_ERROR } from './protocol.js';
import { logger } from '../../../utils/logger.js';

/**
 * The one MCP client in EduOS.
 *
 * Both channels use this. The website assistant and the WhatsApp bot do not
 * each get a client of their own — that is the point of the refactor. A second
 * client is a second place for tool definitions, retries, error shapes and
 * timeouts to drift, and the moment they drift the two surfaces stop answering
 * the same question the same way.
 *
 * The transport is in-process (MCP's InMemoryTransport), so a tool call is a
 * function call with a protocol boundary rather than a network hop: no port,
 * no second process to deploy, no new listening surface, and the Mongoose
 * connection and AsyncLocalStorage tenancy are the ones already in this
 * process. It is a real MCP server for all that — the same catalog could be
 * served over stdio or HTTP to an external client by changing these ~20 lines
 * and nothing else.
 */

let connection = null;

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: 'eduos-ai-agent', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  logger.info(`MCP client connected to ${SERVER_NAME} over in-process transport`);
  return { client, server };
}

/** Lazily connects, and reconnects if a previous connection was torn down. */
export async function getMcpClient() {
  if (!connection) {
    connection = connect().catch((err) => {
      connection = null;
      throw err;
    });
  }
  return (await connection).client;
}

/** Drops the connection. Used by tests; harmless in production. */
export async function resetMcpClient() {
  const existing = connection;
  connection = null;
  if (!existing) return;
  try {
    const { client, server } = await existing;
    await client.close();
    await server.close();
  } catch {
    // Already gone. The next call reconnects.
  }
}

const meta = (sessionId, confirmationToken, window = null) => ({
  _meta: {
    [SESSION_META_KEY]: sessionId,
    ...(confirmationToken && { [CONFIRM_META_KEY]: confirmationToken }),
    ...(window && { [WINDOW_META_KEY]: window }),
  },
});

/**
 * The tool definitions this caller may use, as the agent should see them.
 *
 * Comes from the server's `tools/list` rather than a local import of the
 * registry, deliberately: the agent should reason about exactly what the
 * protocol says is available, so a tool that fails to register is missing
 * everywhere at once instead of being advertised by a prompt and refused by
 * the server.
 */
export async function listTools(sessionId) {
  const client = await getMcpClient();
  const result = await client.listTools(meta(sessionId));
  return result.tools ?? [];
}

/**
 * Invokes one tool and returns the structured envelope.
 *
 * Never throws for a refusal — a 403, or a request for confirmation, is an
 * answer the agent has to speak. It throws only if the transport itself fails,
 * which is an infrastructure fault and belongs on the orchestrator's degraded
 * path.
 */
export async function callTool(sessionId, name, args = {}, { confirmationToken = null, window = null } = {}) {
  const client = await getMcpClient();
  try {
    const result = await client.callTool({ name, arguments: args, ...meta(sessionId, confirmationToken, window) });
    if (result?.structuredContent) return result.structuredContent;
    // A server that only returns text: the envelope is the text.
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return fail(MCP_ERROR.INTERNAL, 'The tool returned a result that could not be read.');
      }
    }
    return fail(MCP_ERROR.INTERNAL, 'The tool returned no result.');
  } catch (err) {
    logger.error(`MCP transport error calling ${name}: ${err?.message}`);
    // A dropped in-process transport is not recoverable by retrying on it.
    await resetMcpClient();
    throw err;
  }
}

/**
 * Opens a session, runs `fn(sessionId)`, closes it.
 *
 * Both channels wrap their turn in this, so the handle exists only while the
 * turn does. `actor` must be the authenticated one — see session.js.
 */
export function withMcpSession({ actor, channel }, fn) {
  return withSession({ actor, channel }, fn);
}

export { errorToAppError };
