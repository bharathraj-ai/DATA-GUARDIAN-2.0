/**
 * Regression test suite for view-only preview download restriction.
 */

import { mayStreamOriginalFileBytes } from '@/lib/linkAuthorization';

describe('View-Only Preview Download Restriction', () => {
  it('mayStreamOriginalFileBytes returns false when canDownload is false', () => {
    const caps = {
      canEdit: false,
      canPreview: true,
      canComment: true,
      canDownload: false,
    };
    expect(mayStreamOriginalFileBytes(caps)).toBe(false);
  });

  it('mayStreamOriginalFileBytes returns true only when canDownload is true', () => {
    const caps = {
      canEdit: true,
      canPreview: true,
      canComment: true,
      canDownload: true,
    };
    expect(mayStreamOriginalFileBytes(caps)).toBe(true);
  });

  it('rejects preview route requests when download permission is disabled', async () => {
    const { GET } = await import('@/app/api/stream/[token]/preview/[fileId]/route');

    jest.mock('@/lib/linkAuthorization', () => ({
      ...jest.requireActual('@/lib/linkAuthorization'),
      authorizeSecureLink: jest.fn().mockResolvedValue({
        success: true,
        context: {
          capabilities: {
            canEdit: false,
            canPreview: true,
            canComment: true,
            canDownload: false,
          },
          secureLink: { id: 'link-123' },
        },
      }),
    }));

    jest.mock('@/lib/rate-limit', () => ({
      checkDownloadRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      checkLinkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      extractClientIP: jest.fn().mockReturnValue('127.0.0.1'),
    }));

    const req = new Request('http://localhost:3000/api/stream/test-token/preview/file-123');
    const res = await GET(req as any, {
      params: Promise.resolve({ token: 'test-token', fileId: 'file-123' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/Original-file preview is disabled/);
  });
});

