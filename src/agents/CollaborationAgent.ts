/**
 * Data Guardian 2.0 — Collaboration Agent
 *
 * Tracks comment threads and collaborator presence.
 * Suggests resolving idle threads. Welcomes new users.
 */

import { AgentOrchestrator, IAgent, OrchestratorPayload } from './AgentOrchestrator';
import { v4 as uuid } from 'uuid';

interface ThreadRecord {
  commentId: string;
  content: string;
  lastActivityAt: number; // timestamp ms
  resolved: boolean;
}

const IDLE_THREAD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CollaborationAgent implements IAgent {
  readonly name = 'CollaborationAgent';
  private bus!: AgentOrchestrator;
  private threads: Map<string, ThreadRecord> = new Map();
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private activeUsers: Set<string> = new Set();

  init(bus: AgentOrchestrator): void {
    this.bus = bus;
    bus.subscribe('op:comment', this.handleComment.bind(this));
    bus.subscribe('session:join', this.handleJoin.bind(this));
    bus.subscribe('session:leave', this.handleLeave.bind(this));

    // Check for idle threads every 10 minutes
    this.idleCheckTimer = setInterval(() => this.checkIdleThreads(), 10 * 60 * 1000);
  }

  destroy(): void {
    if (this.idleCheckTimer) clearInterval(this.idleCheckTimer);
    this.threads.clear();
    this.activeUsers.clear();
  }

  private handleComment(payload: OrchestratorPayload): void {
    const commentId = payload.commentId as string;
    const content = payload.content as string;
    const resolved = payload.resolved as boolean;
    const parentId = payload.parentId as string | undefined;

    const trackId = parentId || commentId;

    if (resolved) {
      const thread = this.threads.get(trackId);
      if (thread) thread.resolved = true;
      return;
    }

    this.threads.set(trackId, {
      commentId: trackId,
      content,
      lastActivityAt: Date.now(),
      resolved: false,
    });
  }

  private handleJoin(payload: OrchestratorPayload): void {
    const displayName = (payload.displayName as string) || 'A collaborator';
    const userId = payload.userId as string;

    if (userId) this.activeUsers.add(userId);

    const unresolvedCount = [...this.threads.values()].filter((t) => !t.resolved).length;

    const message = `${displayName} joined the document.`;
    const suggestion = unresolvedCount > 0
      ? `There ${unresolvedCount === 1 ? 'is' : 'are'} ${unresolvedCount} unresolved comment thread${unresolvedCount !== 1 ? 's' : ''} in this document.`
      : undefined;

    this.bus.emit({
      id: uuid(),
      agentName: this.name,
      severity: 'info',
      title: '👥 Collaborator Joined',
      message,
      suggestion,
      timestamp: new Date().toISOString(),
    });
  }

  private handleLeave(payload: OrchestratorPayload): void {
    const displayName = (payload.displayName as string) || 'A collaborator';
    const userId = payload.userId as string;
    if (userId) this.activeUsers.delete(userId);

    this.bus.emit({
      id: uuid(),
      agentName: this.name,
      severity: 'info',
      title: '👤 Collaborator Left',
      message: `${displayName} left the document.`,
      timestamp: new Date().toISOString(),
    });
  }

  private checkIdleThreads(): void {
    const now = Date.now();
    const idleThreads = [...this.threads.values()].filter(
      (t) => !t.resolved && now - t.lastActivityAt > IDLE_THREAD_MS,
    );

    if (idleThreads.length > 0) {
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'warning',
        title: '💬 Idle Comment Threads',
        message: `${idleThreads.length} comment thread${idleThreads.length !== 1 ? 's have' : ' has'} been inactive for over 24 hours.`,
        suggestion: 'Consider resolving or responding to keep the review process moving.',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
