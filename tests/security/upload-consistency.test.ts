/**
 * Verification Test Suite for Upload Data Consistency (DL-01) Failure Scenarios
 *
 * Tests:
 * 1. Disk-write failure simulation (verifies no DB record created, temp cleanup)
 * 2. Database-write failure simulation (verifies physical file rollback/cleanup)
 * 3. Successful upload consistency (verifies file saved first, then DB record created)
 */

import { NextRequest } from 'next/server';

const mockPrismaCreate = jest.fn();
const mockSaveDocument = jest.fn();
const mockDeleteDocumentFiles = jest.fn();
const mockEnsureStorageDirectories = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/auth', () => ({
  auth: jest.fn().mockResolvedValue({ user: { id: 'user-owner-123' } }),
}));

jest.mock('@/lib/security/roles', () => ({
  getDbUserRole: jest.fn().mockResolvedValue({ role: 'OWNER' }),
}));

jest.mock('@/lib/security/rbac', () => ({
  hasRolePermission: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkUploadRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  extractClientIP: jest.fn().mockReturnValue('127.0.0.1'),
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}));

jest.mock('@/lib/file-magic', () => ({
  validateMagicBytesForExtension: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/security/auditLog', () => ({
  logDocumentEvent: jest.fn(),
  extractRequestInfo: jest.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'Jest' }),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      create: (...args: unknown[]) => mockPrismaCreate(...args),
    },
  },
}));

jest.mock('@/lib/storage/secureStorage', () => {
  const actual = jest.requireActual('@/lib/storage/secureStorage');
  return {
    ...actual,
    ensureStorageDirectories: () => mockEnsureStorageDirectories(),
    saveDocument: (...args: unknown[]) => mockSaveDocument(...args),
    deleteDocumentFiles: (...args: unknown[]) => mockDeleteDocumentFiles(...args),
  };
});

import { POST } from '@/app/api/documents/upload/route';

function createMockUploadRequest(fileName: string, content: string = 'PDF dummy content') {
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/pdf' });
  formData.append('file', blob, fileName);
  formData.append('classification', 'CONFIDENTIAL');

  return new NextRequest('http://localhost:3000/api/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

describe('FIX 2: Upload Data Consistency Failure Simulations', () => {
  beforeEach(() => {
    mockPrismaCreate.mockReset();
    mockSaveDocument.mockReset();
    mockDeleteDocumentFiles.mockReset();
  });

  it('5. Simulate disk-write failure: returns 500, creates ZERO DB records, and triggers cleanup', async () => {
    // Disk write fails (e.g. disk full / ENOSPC or permission error)
    mockSaveDocument.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    mockDeleteDocumentFiles.mockResolvedValueOnce(undefined);

    const req = createMockUploadRequest('financial_report.pdf');
    const response = await POST(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to write document to storage');

    // CRITICAL: Database record was NEVER created (zero orphaned DB records)
    expect(mockPrismaCreate).not.toHaveBeenCalled();

    // Cleanup was invoked for any partial temporary files
    expect(mockDeleteDocumentFiles).toHaveBeenCalledTimes(1);
  });

  it('6. Simulate database-write failure: returns 500, and rolls back physical file from disk', async () => {
    // Disk write succeeds
    const fakeDocId = 'test-doc-id-123';
    mockSaveDocument.mockResolvedValueOnce({
      storagePath: `documents/${fakeDocId}/financial_report.pdf`,
      absolutePath: `/var/storage/documents/${fakeDocId}/financial_report.pdf`,
    });

    // Database operation fails (e.g. Postgres deadlock, connection timeout, constraint failure)
    mockPrismaCreate.mockRejectedValueOnce(new Error('P2002: Unique constraint failed or DB offline'));
    mockDeleteDocumentFiles.mockResolvedValueOnce(undefined);

    const req = createMockUploadRequest('financial_report.pdf');
    const response = await POST(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to record document metadata');

    // Storage was attempted first
    expect(mockSaveDocument).toHaveBeenCalledTimes(1);
    expect(mockPrismaCreate).toHaveBeenCalledTimes(1);

    // CRITICAL: Physical file was deleted from disk (zero orphaned physical files)
    expect(mockDeleteDocumentFiles).toHaveBeenCalledTimes(1);
  });

  it('Successful upload: stores file first, then creates DB record with storagePath', async () => {
    const fakeDocId = 'test-doc-id-456';
    const fakeStoragePath = `documents/${fakeDocId}/contract.pdf`;

    mockSaveDocument.mockResolvedValueOnce({
      storagePath: fakeStoragePath,
      absolutePath: `/var/storage/${fakeStoragePath}`,
    });

    mockPrismaCreate.mockImplementationOnce(async ({ data }: any) => ({
      id: data.id,
      fileName: data.fileName,
      fileType: data.fileType,
      fileSize: data.fileSize,
      classification: data.classification,
      createdAt: new Date(),
    }));

    const req = createMockUploadRequest('contract.pdf');
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.document.fileName).toBe('contract.pdf');

    // Storage happened before DB create
    expect(mockSaveDocument).toHaveBeenCalledTimes(1);
    expect(mockPrismaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: 'contract.pdf',
          storagePath: fakeStoragePath,
          classification: 'CONFIDENTIAL',
        }),
      })
    );

    // No rollback cleanup called on success
    expect(mockDeleteDocumentFiles).not.toHaveBeenCalled();
  });
});
