import { inspectUploadBytes, EICAR_SIGNATURE } from '@/lib/security/malware-signatures';
import { scanUploadBuffer, assertScanAllowed } from '@/lib/security/malware-scan';

describe('malware signatures', () => {
  it('flags the EICAR test string and PE headers', () => {
    expect(inspectUploadBytes(Buffer.from(EICAR_SIGNATURE)).infected).toBe(true);
    expect(inspectUploadBytes(Buffer.from('hello pdf')).infected).toBe(false);
    const pe = Buffer.alloc(64, 0);
    pe[0] = 0x4d;
    pe[1] = 0x5a;
    expect(inspectUploadBytes(pe).detail).toMatch(/PE/);
  });

  it('flags a zip local header that names an exe', () => {
    const name = Buffer.from('payload.exe', 'ascii');
    const hdr = Buffer.alloc(30 + name.length, 0);
    hdr[0] = 0x50;
    hdr[1] = 0x4b;
    hdr[2] = 0x03;
    hdr[3] = 0x04;
    hdr.writeUInt16LE(name.length, 26);
    name.copy(hdr, 30);
    expect(inspectUploadBytes(hdr).infected).toBe(true);
  });
});

describe('scanUploadBuffer local path', () => {
  it('rejects EICAR before Lambda is invoked', async () => {
    const result = await scanUploadBuffer(Buffer.from(EICAR_SIGNATURE), 'eicar.txt');
    expect(result.status).toBe('infected');
    expect(() => assertScanAllowed(result, 'eicar.txt')).toThrow(/malware scan/);
  });

  it('skips remote scan in tests when no scanner is configured', async () => {
    delete process.env.AWS_LAMBDA_SCAN_FUNCTION;
    delete process.env.MALWARE_SCAN_WEBHOOK_URL;
    const result = await scanUploadBuffer(Buffer.from('%PDF-1.4 sample'), 'doc.pdf');
    expect(result.status).toBe('skipped');
  });
});
