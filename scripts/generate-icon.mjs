// Generates the 128x128 Token Lens meter icon.
// Pure Node (zlib) PNG encoder; no dependencies.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const S = 128;
const px = Buffer.alloc(S * S * 4);

const setPx = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
};

const rect = (x0, y0, width, height, r, g, b) => {
  for (let y = y0; y < y0 + height; y++)
    for (let x = x0; x < x0 + width; x++) setPx(x, y, r, g, b);
};

// Rounded-square VS Code-style background.
const corner = 22;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = x < corner ? corner : x > S - 1 - corner ? S - 1 - corner : x;
    const cy = y < corner ? corner : y > S - 1 - corner ? S - 1 - corner : y;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > corner * corner) {
      setPx(x, y, 0, 0, 0, 0);
      continue;
    }
    setPx(x, y, 24, 24, 24);
  }
}

// Meter bars and baseline, matching the activity-bar icon.
rect(26, 88, 76, 8, 204, 204, 204);
rect(32, 59, 16, 29, 88, 166, 255);
rect(56, 34, 16, 54, 63, 185, 80);
rect(80, 47, 16, 41, 163, 113, 247);

// PNG encode.
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('media', { recursive: true });
writeFileSync('media/icon.png', png);
console.log('Wrote media/icon.png');
