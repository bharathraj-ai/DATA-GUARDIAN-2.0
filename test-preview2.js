const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const links = await prisma.secureLink.findMany({
        include: { UserFile: true }
    });
    console.log(`Found ${links.length} links.`);
    if (links.length > 0) {
        console.log("Files:", links[0].UserFile.map(f => ({ id: f.id, type: f.fileType })));
    }
}
main().finally(() => prisma.$disconnect());
