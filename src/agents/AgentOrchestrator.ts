/**
 * Data Guardian 2.0 — Agent Orchestrator
 *
 * Event bus that connects the editor to all AI agents.
 * Works purely in the browser (no server round-trip for agent decisions).
 *
 * Usage:
 *   const orchestrator = new AgentOrchestrator();
 *   orchestrator.on('agent:event', handler);
 *   orchestrator.dispatch('op:insert', { text: '...', pageNumber: 1 });
 */

import type { AgentEvent, DocumentOperation } from '@/lib/documentModel';

// ─── Event catalogue ──────────────────────────────────────────────────────────
export type OrchestratorEventType =
  | 'op:insert'
  | 'op:delete'
  | 'op:update'
  | 'op:annotate'
  | 'op:comment'
  | 'doc:load'
  | 'session:tabswitch'
  | 'session:join'
  | 'session:leave'
  | 'agent:event';          // emitted BY agents → consumed by UI

export type OrchestratorPayload = Record<string, unknown>;
export type AgentHandler = (payload: OrchestratorPayload) => void | Promise<void>;

// ─── Agent interface ──────────────────────────────────────────────────────────
export interface IAgent {
  name: string;
  /** Called once when agent is registered */
  init(bus: AgentOrchestrator): void;
  /** Called when agent is being torn down */
  destroy(): void;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────
export class AgentOrchestrator {
  private handlers: Map<OrchestratorEventType, Set<AgentHandler>> = new Map();
  private agents: IAgent[] = [];

  /** Register an agent. The agent subscribes to events via bus.subscribe(). */
  registerAgent(agent: IAgent): void {
    this.agents.push(agent);
    agent.init(this);
  }

  /** Subscribe to an event (called by agents in their init()). */
  subscribe(event: OrchestratorEventType, handler: AgentHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  /** Dispatch an event from the editor. */
  dispatch(event: OrchestratorEventType, payload: OrchestratorPayload = {}): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    handlers.forEach((fn) => {
      try { fn(payload); } catch (e) { console.warn(`[Agent] handler error for ${event}:`, e); }
    });
  }

  /** Agents call this to surface an event to the UI. */
  emit(agentEvent: AgentEvent): void {
    this.dispatch('agent:event', agentEvent as unknown as OrchestratorPayload);
  }

  /** Subscribe to agent events (called by the UI component). */
  onAgentEvent(handler: (event: AgentEvent) => void): () => void {
    const wrapped: AgentHandler = (payload) => handler(payload as unknown as AgentEvent);
    this.subscribe('agent:event', wrapped);
    return () => this.handlers.get('agent:event')?.delete(wrapped);
  }

  destroy(): void {
    this.agents.forEach((a) => { try { a.destroy(); } catch { /* ignore */ } });
    this.agents = [];
    this.handlers.clear();
  }
}
