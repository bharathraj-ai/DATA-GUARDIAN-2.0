'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

export async function reviewFile(fileId: string, action: 'approve' | 'reject') {
    try {
        const session = await auth();
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const file = await prisma.userFile.findUnique({
            where: { id: fileId },
            include: { SecureLink: true }
        });

        if (!file) return { success: false, error: 'File not found' };

        // Only owner can review
        if (file.SecureLink.ownerId !== session.user.id) {
            return { success: false, error: 'Unauthorized' };
        }

        const newStatus = action === 'approve' ? 'approved' : 'editing'; 

        await prisma.userFile.update({
            where: { id: fileId },
            data: { 
                status: newStatus,
                editingLocked: action === 'approve' // Lock if approved, unlock if rejected for editing
            } as any
        });

        await prisma.auditLog.create({
            data: {
                action: action === 'approve' ? 'OWNER_APPROVED_FILE' : 'OWNER_REJECTED_FILE',
                linkId: file.secureLinkId,
                reason: `Owner ${action}d file: ${file.fileName}`,
                metadata: JSON.stringify({ fileId, previousStatus: (file as any).status, newStatus })
            }
        });

        revalidatePath(`/view/${file.SecureLink.token}`);
        return { success: true };
    } catch (error) {
        console.error('Review Error:', error);
        return { success: false, error: 'An unexpected error occurred' };
    }
}
