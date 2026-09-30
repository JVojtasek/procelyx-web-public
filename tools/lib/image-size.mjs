// Width and height of PNG, JPEG and WebP files from their headers (no native dependency).
export function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return {type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7)};
      }
      i += 2 + len;
    }
    throw new Error('JPEG without SOF marker');
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return {type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3)};
    if (chunk === 'VP8 ') return {type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff};
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return {type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff)};
    }
  }
  throw new Error('unsupported image format');
}
