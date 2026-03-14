/**
 * Data Guardian 2.0 — Document Analysis Agent
 *
 * On document load, analyzes structure and emits an info summary.
 * Identifies section headings, estimates reading time, detects tables.
 */

import { AgentOrchestrator, IAgent, OrchestratorPayload } from './AgentOrchestrator';
import { v4 as uuid } from 'uuid';
import type { InternalDocument } from '@/lib/documentModel';

const WORDS_PER_MINUTE = 200;

export class DocumentAnalysisAgent implements IAgent {
  readonly name = 'DocumentAnalysisAgent';
  private bus!: AgentOrchestrator;

  init(bus: AgentOrchestrator): void {
    this.bus = bus;
    bus.subscribe('doc:load', this.analyzeDocument.bind(this));
  }

  destroy(): void { /* stateless */ }

  private analyzeDocument(payload: OrchestratorPayload): void {
    const doc = payload.document as InternalDocument | undefined;

    if (doc) {
      this.analyzeInternalDocument(doc);
      return;
    }

    // Fallback: raw stats from payload
    const pageCount = (payload.pageCount as number) || 0;
    const fileName = (payload.fileName as string) || 'document';
    const fileType = (payload.fileType as string) || 'pdf';

    let message = `**${fileName}** loaded successfully.`;
    const details: string[] = [];
    if (pageCount > 0) details.push(`${pageCount} page${pageCount !== 1 ? 's' : ''}`);
    if (fileType === 'pdf') details.push('PDF format');
    if (details.length) message += ` (${details.join(', ')})`;

    const suggestions: string[] = [];
    if (pageCount > 100) suggestions.push('Large document detected — page virtualization is active for smooth performance.');
    if (pageCount > 300) suggestions.push('Consider using the page navigation bar to jump directly to a section.');

    this.bus.emit({
      id: uuid(),
      agentName: this.name,
      severity: 'info',
      title: '📄 Document Loaded',
      message,
      suggestion: suggestions.join(' ') || undefined,
      timestamp: new Date().toISOString(),
    });
  }

  private analyzeInternalDocument(doc: InternalDocument): void {
    const allBlocks = doc.pages.flatMap((p) => p.blocks);
    const wordCount = allBlocks.reduce((acc, b) => acc + (b.content?.split(/\s+/).length ?? 0), 0);
    const readingMinutes = Math.ceil(wordCount / WORDS_PER_MINUTE);
    const headings = allBlocks.filter((b) => b.type.startsWith('heading'));
    const tableCount = allBlocks.filter((b) => b.type === 'tableRow').length;

    const details: string[] = [
      `${doc.pages.length} page${doc.pages.length !== 1 ? 's' : ''}`,
      `~${wordCount.toLocaleString()} words`,
      `${readingMinutes} min read`,
    ];
    if (headings.length > 0) details.push(`${headings.length} sections`);
    if (tableCount > 0) details.push(`${tableCount} table rows`);

    this.bus.emit({
      id: uuid(),
      agentName: this.name,
      severity: 'info',
      title: '📊 Document Analysis',
      message: `**${doc.title || 'Document'}** – ${details.join(' · ')}`,
      suggestion:
        headings.length > 0
          ? `Detected sections: ${headings.slice(0, 3).map((h) => h.content).join(', ')}${headings.length > 3 ? '…' : ''}`
          : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
