import { randomBytes, toBase64Url, type Bytes } from './crypto/aead.ts';
import { AGENT_SCOPES, type AgentScope } from './agent-scopes.ts';
import { OPERATIONS, agentScopeOf, type Operation } from './openapi.ts';

/**
 * The parts of agent access that are not the request itself: what a key looks like, which routes a scope
 * opens, and the tools the MCP server offers, which are those routes and no others.
 */

export const TOKEN_PREFIX = 'alk_';
export const DEFAULT_KEY_DAYS = 90;
export const MAX_ACTIVE_KEYS = 5;

/** 32 random bytes, so there is nothing to guess and nothing to find by trying. */
export const newAgentToken = (): string => TOKEN_PREFIX + toBase64Url(randomBytes(32));
export const looksLikeAgentToken = (t: string): boolean => /^alk_[A-Za-z0-9_-]{43}$/.test(t);

/** Only this is kept of a key. */
export const hashAgentToken = async (token: string): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

const KITCHEN = OPERATIONS.filter((o) => o.kitchen);
const matchers = KITCHEN.map((op) => ({
  op,
  method: op.method.toUpperCase(),
  re: new RegExp(`^${op.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
  scope: agentScopeOf(op),
}));

/** The route a request is for, and the scope it takes, which is null when it is a person's alone. */
export function routeFor(
  method: string,
  path: string,
): { op: Operation; scope: AgentScope | null } | undefined {
  return matchers.find((m) => m.method === method.toUpperCase() && m.re.test(path));
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  op: Operation;
  scope: AgentScope;
  /** The names of the arguments that go in the path, in the query, and in the body. */
  parts: { path: string[]; query: string[]; body: string[] | 'whole' | null };
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

/** `get_bootstrap`, `post_log`, `delete_log_id`: the method and the part of the path after the kitchen's address. */
export const toolName = (op: Operation): string =>
  `${op.method}_${op.path.replace('/api/w/:slug/', '').replace(/[^A-Za-z0-9]+/g, '_')}`;

/** The tools for a key that has these scopes: one for each route they open, and none for what is a person's. */
export function toolsFor(
  scopes: readonly AgentScope[],
  schemaOf: (s: NonNullable<Operation['body']>) => JsonSchema,
): McpTool[] {
  const out: McpTool[] = [];
  for (const m of matchers) {
    if (!m.scope || !scopes.includes(m.scope)) continue;
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    const pathNames = [...m.op.path.matchAll(/:([A-Za-z]+)/g)]
      .map((x) => x[1]!)
      .filter((n) => n !== 'slug');
    for (const n of pathNames) {
      properties[n] = { type: 'string', description: m.op.params?.[n] ?? 'The id (a UUID).' };
      required.push(n);
    }
    const queryNames: string[] = [];
    if (m.op.query) {
      const q = schemaOf(m.op.query);
      for (const [n, sch] of Object.entries(q.properties ?? {})) {
        properties[n] = sch;
        queryNames.push(n);
      }
      required.push(...(q.required ?? []));
    }
    let body: McpTool['parts']['body'] = null;
    if (m.op.body) {
      const b = schemaOf(m.op.body);
      if (b.type === 'object' && b.properties) {
        body = Object.keys(b.properties);
        for (const [n, sch] of Object.entries(b.properties)) properties[n] ??= sch;
        required.push(...(b.required ?? []));
      } else {
        body = 'whole';
        properties.body = b as Record<string, unknown>;
        required.push('body');
      }
    }
    out.push({
      name: toolName(m.op),
      description: `${m.op.summary}. ${m.op.description ?? ''}`.trim().slice(0, 1200),
      inputSchema: {
        type: 'object',
        properties,
        required: [...new Set(required)],
        additionalProperties: false,
      },
      op: m.op,
      scope: m.scope,
      parts: { path: pathNames, query: queryNames, body },
    });
  }
  return out;
}

export { AGENT_SCOPES };
