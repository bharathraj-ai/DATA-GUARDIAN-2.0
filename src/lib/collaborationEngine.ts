/**
 * Data Guardian 2.0 — Collaboration Engine (client-side)
 *
 * Provides:
 *  - A reconnecting WebSocket client that maintains an op queue and sends
 *    operations with version-based Operational Transformation.
 *  - A server-side room manager (used in the WS API route).
 */

import type { DocumentOperation, CursorPosition, AgentEvent } from './documentModel';

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket message types
// ─────────────────────────────────────────────────────────────────────────────
export type WSMessageType =
  | 'join'       // client → server: client connecting to a document room
  | 'op'         // bidirectional: document operation
  | 'op:ack'     // server → client: operation acknowledged and committed
  | 'op:reject'  // server → client: op rejected (version mismatch, policy)
  | 'cursor'     // bidirectional: cursor position update
  | 'agent'      // server → client: AI agent event
  | 'session'    // server → client: session lifecycle event (revoked/expired)
  | 'presence'   // server → client: list of users currently in the room
  | 'ping'
  | 'pong';

export interface WSMessage {
  type: WSMessageType;
  payload?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client-side collaboration engine
// ─────────────────────────────────────────────────────────────────────────────
export type CollabEventHandler = (msg: WSMessage) => void;

interface PendingOp {
  op: DocumentOperation;
  retries: number;
}

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOps: PendingOp[] = [];
  private listeners: Set<CollabEventHandler> = new Set();
  private destroyed = false;
  private serverVersion = 0;   // last acknowledged version from server

  constructor(url: string) {
    this.url = url;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  connect(): void {
    if (this.destroyed || this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = this.onOpen.bind(this);
      this.ws.onmessage = this.onMessage.bind(this);
      this.ws.onclose = this.onClose.bind(this);
      this.ws.onerror = () => { /* handled by onclose */ };
    } catch {
      this.scheduleReconnect();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
    this.pendingOps = [];
  }

  // ── Event subscription ────────────────────────────────────────────────────
  on(handler: CollabEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  // ── Send operations ───────────────────────────────────────────────────────
  sendOp(op: DocumentOperation): void {
    const adjusted = { ...op, version: this.serverVersion };
    this.pendingOps.push({ op: adjusted, retries: 0 });
    this.flushPending();
  }

  sendCursor(cursor: CursorPosition): void {
    this.send({ type: 'cursor', payload: cursor });
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  private onOpen(): void {
    this.reconnectDelay = 1000;
    this.startHeartbeat();
    this.flushPending();
    this.emit({ type: 'presence', payload: { status: 'connected' } });
  }

  private onMessage(ev: MessageEvent): void {
    try {
      const msg = JSON.parse(ev.data as string) as WSMessage;
      if (msg.type === 'pong') return;
      if (msg.type === 'op:ack') {
        this.serverVersion = (msg.payload as { version: number }).version;
        // Remove acknowledged op from queue
        this.pendingOps.shift();
        this.flushPending();
      }
      this.emit(msg);
    } catch { /* ignore malformed */ }
  }

  private onClose(): void {
    this.clearTimers();
    if (!this.destroyed) {
      this.scheduleReconnect();
    }
    this.emit({ type: 'presence', payload: { status: 'disconnected' } });
  }

  private flushPending(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.pendingOps.length === 0) return;
    // Send only the first pending op (pipeline one at a time)
    const item = this.pendingOps[0];
    this.send({ type: 'op', payload: item.op });
  }

  private send(msg: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* queue */ }
    }
  }

  private emit(msg: WSMessage): void {
    this.listeners.forEach((fn) => {
      try { fn(msg); } catch { /* isolate handler errors */ }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 25_000);
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side room manager (used inside the WS API route, Node.js only)
// ─────────────────────────────────────────────────────────────────────────────
export interface RoomClient {
  ws: unknown; // WebSocket from 'ws' package
  sessionId: string;
  fileId: string;
  displayName: string;
  color: string;
  version: number;
}

export class RoomManager {
  private rooms: Map<string, Set<RoomClient>> = new Map();

  join(fileId: string, client: RoomClient): void {
    if (!this.rooms.has(fileId)) this.rooms.set(fileId, new Set());
    this.rooms.get(fileId)!.add(client);
  }

  leave(fileId: string, sessionId: string): void {
    const room = this.rooms.get(fileId);
    if (!room) return;
    for (const c of room) {
      if (c.sessionId === sessionId) { room.delete(c); break; }
    }
    if (room.size === 0) this.rooms.delete(fileId);
  }

  broadcast(fileId: string, msg: WSMessage, excludeSession?: string): void {
    const room = this.rooms.get(fileId);
    if (!room) return;
    const text = JSON.stringify(msg);
    for (const c of room) {
      if (c.sessionId === excludeSession) continue;
      try {
        (c.ws as { send: (d: string) => void }).send(text);
      } catch { /* client disconnected — ignore */ }
    }
  }

  getPresence(fileId: string): { sessionId: string; displayName: string; color: string }[] {
    return [...(this.rooms.get(fileId) ?? [])].map((c) => ({
      sessionId: c.sessionId,
      displayName: c.displayName,
      color: c.color,
    }));
  }
}

// Singleton for the Node.js process
export const globalRoomManager = new RoomManager();

// ─────────────────────────────────────────────────────────────────────────────
// Cursor colour palette (assigned round-robin)
// ─────────────────────────────────────────────────────────────────────────────
const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];

let _colorIdx = 0;
export function nextCursorColor(): string {
  return CURSOR_COLORS[_colorIdx++ % CURSOR_COLORS.length];
}
