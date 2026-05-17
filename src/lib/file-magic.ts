/**
 * Magic-byte sniffing for upload validation (extension is user-controlled; MIME can lie).
 */

function matches(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Map declared extension to expected container / format.
 */
export function sniffFileKind(buf: Buffer, declaredExt: string): 'pdf' | 'zip' | 'image' | 'text' | 'unknown' {
  const ext = declaredExt.toLowerCase();

  if (matches(buf, [0x25, 0x50, 0x44, 0x46])) {
    return ext === 'pdf' ? 'pdf' : 'unknown';
  }

  const isZip =
    matches(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    matches(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    matches(buf, [0x50, 0x4b, 0x07, 0x08]);
  if (isZip) {
    const office = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
    return office.has(ext) ? 'zip' : ext === 'zip' ? 'zip' : 'unknown';
  }

  if (matches(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || matches(buf, [0xff, 0xd8, 0xff])) {
    return ['png', 'jpg', 'jpeg'].includes(ext) ? 'image' : 'unknown';
  }

  // UTF-8 / ASCII text heuristic for .txt / .csv / .rtf
  if (['txt', 'csv', 'rtf'].includes(ext)) {
    const sample = buf.subarray(0, Math.min(4096, buf.length));
    if (sample.length === 0) return 'unknown';
    let printable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === undefined) break;
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
    }
    if (printable / sample.length > 0.94) return 'text';
  }

  return 'unknown';
}

export function validateMagicBytesForExtension(buffer: Buffer, declaredExt: string): boolean {
  const ext = declaredExt.toLowerCase();
  const kind = sniffFileKind(buffer, ext);

  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) {
    return kind === 'zip';
  }
  if (ext === 'pdf') return kind === 'pdf';
  if (['png', 'jpg', 'jpeg'].includes(ext)) return kind === 'image';
  if (['txt', 'csv', 'rtf'].includes(ext)) return kind === 'text';
  // Legacy binary formats without strong magic — extension-only fallback (still size-limited elsewhere)
  if (['doc', 'xls', 'ppt'].includes(ext)) return buffer.length >= 8;
  return false;
}
