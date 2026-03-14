/**
 * Data Guardian 2.0 — Compliance Agent
 *
 * Verifies user actions against access-control policies.
 * Detects role violations and unauthorized content sharing attempts.
 */

import { AgentOrchestrator, IAgent, OrchestratorPayload } from './AgentOrchestrator';
import { v4 as uuid } from 'uuid';

export type UserRole = 'OWNER' | 'TEAM_LEADER' | 'MEMBER' | 'VENDOR';

const ROLE_PERMISSIONS: Record<UserRole, { canAnnotate: boolean; canEdit: boolean; canComment: boolean; canReplace: boolean }> = {
  OWNER:       { canAnnotate: true,  canEdit: true,  canComment: true,  canReplace: true  },
  TEAM_LEADER: { canAnnotate: true,  canEdit: true,  canComment: true,  canReplace: false },
  MEMBER:      { canAnnotate: true,  canEdit: false, canComment: true,  canReplace: false },
  VENDOR:      { canAnnotate: false, canEdit: false, canComment: false, canReplace: false },
};

// Patterns that suggest someone is trying to share document content externally
const SHARING_PATTERNS = [
  /forward this to/i,
  /send this to/i,
  /share with/i,
  /copy to/i,
  /paste (this|it|below)/i,
  /mailto:/i,
];

export class ComplianceAgent implements IAgent {
  readonly name = 'ComplianceAgent';
  private bus!: AgentOrchestrator;
  private userRole: UserRole = 'VENDOR';

  constructor(userRole: UserRole = 'VENDOR') {
    this.userRole = userRole;
  }

  init(bus: AgentOrchestrator): void {
    this.bus = bus;
    bus.subscribe('op:insert', this.checkInsert.bind(this));
    bus.subscribe('op:update', this.checkInsert.bind(this));
    bus.subscribe('op:annotate', this.checkAnnotation.bind(this));
    bus.subscribe('op:comment', this.checkComment.bind(this));
  }

  destroy(): void { /* stateless */ }

  private checkInsert(payload: OrchestratorPayload): void {
    const perms = ROLE_PERMISSIONS[this.userRole];
    if (!perms.canEdit) {
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'error',
        title: '🚫 Edit Restricted',
        message: `Your role (${this.userRole}) does not have permission to edit this document.`,
        suggestion: 'Contact the document owner to request edit access.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check for potential unauthorized sharing
    const text = (payload.text as string) || (payload.content as string) || '';
    for (const pattern of SHARING_PATTERNS) {
      if (pattern.test(text)) {
        this.bus.emit({
          id: uuid(),
          agentName: this.name,
          severity: 'warning',
          title: '📋 Potential Unauthorized Sharing',
          message: 'Your comment or edit suggests sharing document content externally.',
          suggestion: 'All content in this platform is confidential. Sharing externally may violate your access agreement.',
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }
  }

  private checkAnnotation(payload: OrchestratorPayload): void {
    const perms = ROLE_PERMISSIONS[this.userRole];
    if (!perms.canAnnotate) {
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'error',
        title: '🚫 Annotation Restricted',
        message: `Your role (${this.userRole}) cannot add annotations to this document.`,
        suggestion: 'Contact the document owner to request annotation access.',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkComment(payload: OrchestratorPayload): void {
    const perms = ROLE_PERMISSIONS[this.userRole];
    if (!perms.canComment) {
      this.bus.emit({
        id: uuid(),
        agentName: this.name,
        severity: 'error',
        title: '🚫 Comments Restricted',
        message: `Your role (${this.userRole}) cannot add comments to this document.`,
        suggestion: 'Contact the document owner to request comment access.',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
