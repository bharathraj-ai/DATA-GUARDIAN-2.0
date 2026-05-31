// scripts/migrate-deks.ts
import { PrismaClient } from '@prisma/client';
import { decryptDek, encryptDek } from '../src/lib/crypto';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main() {
    console.log('--- Starting DEK Migration ---');
    
    // Test if KEK is configured properly
    if (!process.env.KEK_KEY || process.env.KEK_KEY.length !== 64) {
        console.error('ERROR: KEK_KEY is missing or invalid in environment variables. Aborting.');
        process.exit(1);
    }
    
    let migratedFiles = 0;
    let migratedVersions = 0;
    let failedFiles = 0;
    let failedVersions = 0;

    // 1. Migrate UserFiles
    console.log('\nScanning UserFiles...');
    const userFiles = await prisma.userFile.findMany({
        where: { encryptedDek: { not: null } },
        select: { id: true, encryptedDek: true }
    });

    console.log(`Found ${userFiles.length} UserFiles with encrypted DEKs.`);
    for (const file of userFiles) {
        if (!file.encryptedDek) continue;
        try {
            // decryptDek will try KEK first, then fallback to ENCRYPTION_KEY if needed.
            // Either way, it returns the raw DEK Buffer.
            const rawDek = decryptDek(file.encryptedDek);
            
            // encryptDek now strictly uses KEK.
            const newEncryptedDek = encryptDek(rawDek);

            // Check if it actually changed (if it was already migrated, the IV changes anyway because of GCM, 
            // but we can just blindly update it to ensure it's on KEK).
            await prisma.userFile.update({
                where: { id: file.id },
                data: { encryptedDek: newEncryptedDek }
            });
            migratedFiles++;
        } catch (e: any) {
            console.error(`Failed to migrate UserFile ${file.id}: ${e.message}`);
            failedFiles++;
        }
    }

    // 2. Migrate FileVersions
    console.log('\nScanning FileVersions...');
    const fileVersions = await prisma.fileVersion.findMany({
        where: { encryptedDek: { not: null } },
        select: { id: true, encryptedDek: true }
    });

    console.log(`Found ${fileVersions.length} FileVersions with encrypted DEKs.`);
    for (const version of fileVersions) {
        if (!version.encryptedDek) continue;
        try {
            const rawDek = decryptDek(version.encryptedDek);
            const newEncryptedDek = encryptDek(rawDek);

            await prisma.fileVersion.update({
                where: { id: version.id },
                data: { encryptedDek: newEncryptedDek }
            });
            migratedVersions++;
        } catch (e: any) {
            console.error(`Failed to migrate FileVersion ${version.id}: ${e.message}`);
            failedVersions++;
        }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`UserFiles migrated:    ${migratedFiles}`);
    console.log(`UserFiles failed:      ${failedFiles}`);
    console.log(`FileVersions migrated: ${migratedVersions}`);
    console.log(`FileVersions failed:   ${failedVersions}`);
    
    if (failedFiles > 0 || failedVersions > 0) {
        console.warn('\nWARNING: Some files failed to migrate. Check logs above.');
    } else {
        console.log('\nMigration completed successfully!');
    }
}

main()
    .catch((e) => {
        console.error('Fatal error during migration:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
