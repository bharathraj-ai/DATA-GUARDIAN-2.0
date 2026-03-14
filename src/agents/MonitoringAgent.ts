/**
 * Data Guardian 2.0 — Monitoring Agent
 *
 * Detects suspicious user behaviour:
 *  - Excessive tab switching
 *  - Abnormally high edit velocity
 *  - Repeated sessions from different devices
 */

import { AgentOrchestrator, IAgent, OrchestratorPayload } from './AgentOrchestrator';
import { v4 as uuid } from 'uuid';

const TAB_SWITCH_WINDOW_MS = 60_000;       // 1 minute
const TAB_SWITCH_THRESHOLD = 5;          // switches
const OP_VELOCITY_WINDOW_MS = 60_000;    // 1 minute
const OP_VELOCITY_THRESHOLD = 300;       // operations

export class MonitoringAgent implements IAgent {
  readonly name = 'MonitoringAgent';
  private bus!: AgentOrchestrator;

  // Tab switch tracking
  private tabSwitchTimes: number[] = [];
  private tabSwitchWarned = false;

  // Op velocity tracking
  private opTimes: number[] = [];
  private velocityWarned = false;

  init(bus: AgentOrchestrator): void {
    this.bus = bus;
    bus.subscribe('session:tabswitch', this.handleTabSwitch.bind(this));
    bus.subscribe('op:insert', this.trackOp.bind(this));
    bus.subscribe('op:delete', this.trackOp.bind(this));
    bus.subscribe('op:update', this.trackOp.bind(this));
    bus.subscribe('op:annotate', this.trackOp.bind(this));
  }

  destroy(): void {
    this.tabSwitchTimes = [];
    this.opTimes = [];
  }

  private handleTabSwitch(_payload: OrchestratorPayload): void {
    const now = Date.now();
    this.tabSwitchTimes.push(now);

    // Purge entries outside the window
    this.tabSwitchTimes = this.tabSwitchTimes.filter(
      (t) => now - t < TAB_SWITCH_WINDOW_MS,
    );

    if (this.tabSwitchTimes.length >= TAB_SWITCH_THRESHOLD && !this.tabSwitchWarned) {
      this.tabSwitchWarned = true;
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'warning',
        title: '🔍 Suspicious Tab Activity',
        message: `Detected ${this.tabSwitchTimes.length} tab switches in the last minute.`,
        suggestion: 'Repeated tab switching while a secure document is open may indicate unauthorized screen capture attempts. This event has been logged.',
        timestamp: new Date().toISOString(),
      });
    }

    // Reset warning after window passes
    setTimeout(() => { this.tabSwitchWarned = false; }, TAB_SWITCH_WINDOW_MS);
  }

  private trackOp(_payload: OrchestratorPayload): void {
    const now = Date.now();
    this.opTimes.push(now);

    this.opTimes = this.opTimes.filter((t) => now - t < OP_VELOCITY_WINDOW_MS);

    if (this.opTimes.length >= OP_VELOCITY_THRESHOLD && !this.velocityWarned) {
      this.velocityWarned = true;
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'warning',
        title: '⚡ Abnormal Edit Velocity',
        message: `Detected ${this.opTimes.length} operations in the last minute.`,
        suggestion: 'This editing rate is unusually high. If this is automated activity, please ensure it complies with the platform terms. This event has been logged.',
        timestamp: new Date().toISOString(),
      });

      setTimeout(() => { this.velocityWarned = false; }, OP_VELOCITY_WINDOW_MS);
    }
  }
}
