import type { ListenerPort } from './types.ts'

export interface ListenerRuleIdentity {
  bindIp: string
  command: string
  port: string
  scope: ListenerPort['scope']
}

export function listenerRuleKey(input: ListenerRuleIdentity): string {
  return `${input.scope}:${input.bindIp}:${input.port}:${input.command || 'unknown'}`
}

export function listenerRuleIdentity(listener: ListenerPort): ListenerRuleIdentity {
  return {
    bindIp: listener.bindIp,
    command: listener.command || 'unknown',
    port: listener.port,
    scope: listener.scope,
  }
}
