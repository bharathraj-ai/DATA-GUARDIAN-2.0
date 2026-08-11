process.env.DATABASE_URL = process.env.DIRECT_URL;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Attempting to connect to database using DIRECT_URL:', process.env.DATABASE_URL);
  try {
    const start = Date.now();
    const result = await prisma.$queryRaw`SELECT 1 as result`;
    console.log('Success! Result:', result);
    console.log(`Connection took ${Date.now() - start}ms`);
  } catch (error) {
    console.error('Error connecting to database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
