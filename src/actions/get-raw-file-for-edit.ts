'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { decryptUserFileBytes } from '@/lib/decrypt-user-file';

export type RawFileData = {
    success: boolean;
    base64Content?: string;
    mimeType?: string;
    fileName?: string;
    version?: number;
    myAssignedLevel?: number;
    capabilities?: { canEdit: boolean; canPreview: boolean; canComment: boolean; canDownload: boolean };
    remainingSeconds?: number;
    viewerEmail?: string | null;
    error?: string;
};

export async function getRawFileForEdit(token: string, fileId: string): Promise<RawFileData> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }

        const secureLink = authResult.context.secureLink;
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, secureLink.id);

        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if (!secureLink.allowEditing) {
            return { success: false, error: 'Editing is not permitted by the owner' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // Transition status to 'editing' if it's currently 'draft'
        if ((fileRecord as any).status === 'draft') {
            await prisma.userFile.update({
                where: { id: fileId },
                data: { status: 'editing' } as any
            });
        }

        let buffer: Buffer;
        try {
            buffer = await decryptUserFileBytes(fileRecord);
        } catch (e) {
            console.error('[EDIT] Decrypt failed:', e);
            return { success: false, error: 'Failed to retrieve or decrypt file from storage' };
        }

        const myAssignedLevel = authResult.context.isOwner
            ? 1
            : (authResult.context.vendorAccess?.level ?? 2);

        return {
            success: true,
            mimeType: fileRecord.fileType,
            fileName: fileRecord.fileName,
            version: fileRecord.version,
            base64Content: buffer.toString('base64'),
            myAssignedLevel,
            capabilities: authResult.context.capabilities,
            remainingSeconds: Math.max(
                0,
                Math.floor((secureLink.expiresAt.getTime() - Date.now()) / 1000),
            ),
            viewerEmail: authResult.context.effectiveEmail || null,
        };

    } catch (error) {
        console.error('Get Raw File Error:', error);
        return { success: false, error: 'Failed to load file content' };
    }
}
