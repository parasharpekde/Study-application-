const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const c = crc32(typeAndData);
  chunk.writeUInt32BE(c, 8 + len);
  return chunk;
}

function createPng(width, height) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw image scanlines
  const bytesPerPixel = 4;
  const stride = 1 + width * bytesPerPixel;
  const rawData = Buffer.alloc(stride * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.44;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * stride;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * bytesPerPixel;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Gradient background (deep indigo #0b0f19 to violet #6d28d9)
      const gradT = Math.min(1, Math.max(0, (y / height) * 0.8 + (x / width) * 0.2));
      let r = Math.round(11 + (109 - 11) * gradT);
      let g = Math.round(15 + (40 - 15) * gradT);
      let b = Math.round(25 + (217 - 25) * gradT);
      let a = 255;

      // Rounded container outline
      if (dist > radius) {
        a = 0; // Transparent corners
      } else if (dist > radius - 2) {
        a = Math.round(255 * (radius - dist) / 2);
      }

      // Draw stylized lightning/focus icon in center
      // Coordinates normalized to [-1, 1]
      const nx = dx / (width * 0.3);
      const ny = dy / (height * 0.3);

      // Simple diamond / shield glow in center
      const inIcon = (Math.abs(nx) + Math.abs(ny) < 0.65) &&
                     (Math.abs(nx * 0.6 - ny * 0.8) < 0.4);

      if (a > 0 && inIcon) {
        // Bright cyan/violet glow
        r = 167; // #a78bfa
        g = 139;
        b = 250;
      }

      // Border ring
      if (dist > radius - 6 && dist <= radius - 2 && a > 0) {
        r = 139;
        g = 92;
        b = 246;
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'icon-192.png'), createPng(192, 192));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), createPng(512, 512));

console.log('✅ Generated public/icon-192.png and public/icon-512.png successfully!');
