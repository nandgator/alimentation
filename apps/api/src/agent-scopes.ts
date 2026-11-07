/**
 * What a key given to an AI agent may be allowed. `read` is always there; `log` adds and withdraws entries;
 * `claims` says that a payment was made, or takes that back. What is not in a scope stays with a person.
 */
export const AGENT_SCOPES = ["read", "log", "claims"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
