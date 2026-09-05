import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Migrating User roles to OWNER...');
  await prisma.user.updateMany({
    where: { role: { in: ['MANAGER', 'TEAM_LEADER'] } },
    data: { role: 'OWNER' },
  });

  console.log('Migrating OrganizationMember roles to OWNER...');
  await prisma.organizationMember.updateMany({
    where: { role: { in: ['MANAGER', 'TEAM_LEADER'] } },
    data: { role: 'OWNER' },
  });

  console.log('Migrating OrganizationInvite roles to OWNER...');
  await prisma.organizationInvite.updateMany({
    where: { role: { in: ['MANAGER', 'TEAM_LEADER'] } },
    data: { role: 'OWNER' },
  });

  console.log('Migrating DocumentSession roles to OWNER...');
  await prisma.documentSession.updateMany({
    where: { role: { in: ['MANAGER', 'TEAM_LEADER'] } },
    data: { role: 'OWNER' },
  });

  console.log('Migration complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
