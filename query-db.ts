import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const token = '8ed4e572-d5bb-4cbd-924e-bc74ddbf62c3';
  const link = await prisma.secureLink.findUnique({
    where: { token },
    include: {
      User: true,
      VendorAccess: true,
      LinkAccess: true,
      UserFile: {
        include: {
          mongoFile: true
        }
      },
    }
  });
  console.log('Link details loaded.');
  
  const fileRecord = link?.UserFile[0];
  if (!fileRecord) {
    console.log('No file record found!');
    return;
  }
  
  if (fileRecord.mongoFile) {
    console.log('Downloading from Mongo gridFSId:', fileRecord.mongoFile.gridFSId);
    const { downloadFromMongo } = await import('./src/lib/mongo/operations');
    const downloadedBuffer = await downloadFromMongo(fileRecord.mongoFile.gridFSId);
    console.log('Downloaded buffer length:', downloadedBuffer.length);
    
    if (fileRecord.iv && fileRecord.authTag) {
      console.log('Decrypting buffer...');
      const { decryptDek, decryptBuffer } = await import('./src/lib/crypto');
      const dek = fileRecord.encryptedDek
          ? decryptDek(fileRecord.encryptedDek)
          : undefined;
      console.log('DEK decrypted:', !!dek);
      const buffer = decryptBuffer(
          downloadedBuffer,
          fileRecord.iv,
          fileRecord.authTag,
          dek
      );
      console.log('Decrypted buffer length:', buffer.length);
    } else {
      console.log('No encryption credentials found on fileRecord.');
    }
  } else {
    console.log('No mongoFile associated with user file.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
