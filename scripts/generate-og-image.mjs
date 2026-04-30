import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const width = 1200;
const height = 630;
const channels = 4;
const pixels = Buffer.alloc(width * height * channels);

const font = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function setPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * channels;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(pixels[offset] * inverse + color[0] * alpha);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * inverse + color[1] * alpha);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * inverse + color[2] * alpha);
  pixels[offset + 3] = 255;
}

function fillRect(x, y, w, h, color, alpha = 1) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      setPixel(px, py, color, alpha);
    }
  }
}

function drawText(text, x, y, scale, color, tracking = 1) {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    if (char === ' ') {
      cursor += 4 * scale;
      continue;
    }
    const glyph = font[char];
    if (!glyph) {
      cursor += 4 * scale;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === '1') {
          fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += (glyph[0].length + tracking) * scale;
  }
}

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const horizontal = x / (width - 1);
    const vertical = y / (height - 1);
    setPixel(x, y, [
      mix(5, 18, horizontal),
      mix(7, 24, vertical),
      mix(18, 45, (horizontal + vertical) / 2),
    ]);
  }
}

for (let x = 0; x < width; x += 48) {
  fillRect(x, 0, 1, height, [99, 102, 241], 0.12);
}
for (let y = 0; y < height; y += 48) {
  fillRect(0, y, width, 1, [99, 102, 241], 0.12);
}

fillRect(72, 92, 10, 446, [99, 102, 241], 1);
fillRect(82, 92, 402, 10, [99, 102, 241], 1);
fillRect(82, 528, 402, 10, [168, 85, 247], 1);
fillRect(700, 92, 410, 10, [16, 185, 129], 1);
fillRect(1110, 102, 10, 436, [16, 185, 129], 1);
fillRect(700, 528, 410, 10, [99, 102, 241], 1);

fillRect(738, 182, 116, 116, [99, 102, 241], 0.75);
fillRect(890, 182, 116, 116, [16, 185, 129], 0.75);
fillRect(814, 334, 116, 116, [168, 85, 247], 0.75);

drawText('COMPAREAI', 112, 168, 20, [248, 250, 252], 1);
drawText('AI COMPARISON TOOL', 116, 350, 8, [199, 210, 254], 1);
drawText('FOR PRODUCTS APPS DECISIONS', 116, 430, 6, [203, 213, 225], 1);

const raw = Buffer.alloc((width * channels + 1) * height);
for (let y = 0; y < height; y += 1) {
  const rowStart = y * (width * channels + 1);
  raw[rowStart] = 0;
  pixels.copy(raw, rowStart + 1, y * width * channels, (y + 1) * width * channels);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND'),
]);

writeFileSync('public/og-image.png', png);
