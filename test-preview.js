const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const link = await prisma.secureLink.findFirst({
        where: { isUsed: true, isRevoked: false },
        include: { UserFile: true, VendorAccess: true }
    });
    if (!link || link.UserFile.length === 0) {
        console.log("No valid link/file found");
        return;
    }
    const token = link.token;
    const fileId = link.UserFile[0].id;
    console.log(`Token: ${token}`);
    console.log(`FileId: ${fileId}`);
    
    // Check what happens when we fetch it locally without a session cookie
    const res = await fetch(`http://localhost:3000/api/stream/${token}/preview/${fileId}`);
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Body:", body.substring(0, 500));
}
main().finally(() => prisma.$disconnect());
