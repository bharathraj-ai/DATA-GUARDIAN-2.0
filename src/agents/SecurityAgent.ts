/**
 * Data Guardian 2.0 — Security Agent
 *
 * Scans inserted text for PII and sensitive data patterns.
 * Emits warnings when potentially sensitive content is detected.
 */

import { AgentOrchestrator, IAgent, OrchestratorPayload } from './AgentOrchestrator';
import { v4 as uuid } from 'uuid';

interface PiiPattern {
  name: string;
  regex: RegExp;
  severity: 'warning' | 'error';
  suggestion: string;
}

const PII_PATTERNS: PiiPattern[] = [
  {
    name: 'Credit Card Number',
    regex: /\b(?:\d[ -]?){13,16}\b/,
    severity: 'error',
    suggestion: 'Avoid sharing financial credentials. Redact before sharing.',
  },
  {
    name: 'Indian Aadhaar Number',
    regex: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/,
    severity: 'error',
    suggestion: 'Aadhaar numbers are personally identifiable. Remove or mask.',
  },
  {
    name: 'US Social Security Number',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
    severity: 'error',
    suggestion: 'SSNs are legally protected. Do not include in shared documents.',
  },
  {
    name: 'Passport Number',
    regex: /\b[A-Z]{1,2}\d{6,9}\b/,
    severity: 'warning',
    suggestion: 'Passport numbers may be sensitive. Confirm this is intentional.',
  },
  {
    name: 'Phone Number',
    regex: /\b(?:\+\d{1,3}[\s-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
    severity: 'warning',
    suggestion: 'Phone numbers are personal data. Ensure sharing is authorized.',
  },
  {
    name: 'Email Address',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
    severity: 'warning',
    suggestion: 'Email addresses are PII. Ensure the recipient is authorized.',
  },
  {
    name: 'Bank Account Number',
    regex: /\b\d{8,17}\b/,
    severity: 'warning',
    suggestion: 'This may be a bank account number. Verify before sharing.',
  },
  {
    name: 'IP Address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    severity: 'warning',
    suggestion: 'IP addresses may reveal infrastructure details.',
  },
];

export class SecurityAgent implements IAgent {
  readonly name = 'SecurityAgent';
  private bus!: AgentOrchestrator;

  init(bus: AgentOrchestrator): void {
    this.bus = bus;
    bus.subscribe('op:insert', this.handleInsert.bind(this));
    bus.subscribe('op:update', this.handleInsert.bind(this));
    bus.subscribe('op:comment', this.handleInsert.bind(this));
  }

  destroy(): void { /* stateless */ }

  private handleInsert(payload: OrchestratorPayload): void {
    const text =
      (payload.text as string) ||
      (payload.content as string) ||
      '';
    if (!text || text.length < 4) return;

    for (const pattern of PII_PATTERNS) {
      if (pattern.regex.test(text)) {
        this.bus.emit({
          id: uuid(),
          agentName: this.name,
          severity: pattern.severity,
          title: `⚠ Sensitive Data Detected: ${pattern.name}`,
          message: `Your input appears to contain a ${pattern.name}.`,
          suggestion: pattern.suggestion,
          relatedOpId: payload.opId as string | undefined,
          timestamp: new Date().toISOString(),
        });
        // Emit once per op (first match wins)
        break;
      }
    }
  }
}
