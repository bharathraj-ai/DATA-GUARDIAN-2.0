/**
 * Unlock a file that was prematurely locked by submitFinal.
 * 
 * Usage:
 *   npx ts-node scripts/unlock-file.ts <fileId>
 *   npx ts-node scripts/unlock-file.ts --all    (unlock ALL locked files)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const arg = process.argv[2];

    if (!arg) {
        console.error('Usage: npx ts-node scripts/unlock-file.ts <fileId | --all>');
        process.exit(1);
    }

    if (arg === '--all') {
        const result = await (prisma.userFile as any).updateMany({
            where: { editingLocked: true },
            data: { editingLocked: false },
        });
        console.log(`✅ Unlocked ${result.count} file(s).`);
    } else {
        const file = await prisma.userFile.findUnique({ where: { id: arg } });
        if (!file) {
            console.error(`❌ File not found: ${arg}`);
            process.exit(1);
        }

        await (prisma.userFile as any).update({
            where: { id: arg },
            data: { editingLocked: false },
        });
        console.log(`✅ Unlocked file: ${file.fileName} (${arg})`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
