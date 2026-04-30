import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const channels = 4;
const sampleScale = 4;

const font = {
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
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

function createCanvas(size) {
  return {
    size,
    pixels: Buffer.alloc(size * size * channels),
  };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function setPixel(canvas, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (Math.floor(y) * canvas.size + Math.floor(x)) * channels;
  const inverse = 1 - alpha;
  canvas.pixels[offset] = Math.round(canvas.pixels[offset] * inverse + color[0] * alpha);
  canvas.pixels[offset + 1] = Math.round(canvas.pixels[offset + 1] * inverse + color[1] * alpha);
  canvas.pixels[offset + 2] = Math.round(canvas.pixels[offset + 2] * inverse + color[2] * alpha);
  canvas.pixels[offset + 3] = Math.round(canvas.pixels[offset + 3] * inverse + 255 * alpha);
}

function fillCanvasGradient(canvas) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const horizontal = x / (canvas.size - 1);
      const vertical = y / (canvas.size - 1);
      setPixel(canvas, x, y, [
        mix(10, 18, horizontal),
        mix(10, 16, vertical),
        mix(15, 35, (horizontal + vertical) / 2),
      ]);
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function fillPolygon(canvas, points, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))));
  const maxX = Math.min(canvas.size - 1, Math.ceil(Math.max(...points.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(canvas.size - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) {
        setPixel(canvas, x, y, color, alpha);
      }
    }
  }
}

function fillCircle(canvas, centerX, centerY, radius, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(canvas.size - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(canvas.size - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(canvas, x, y, color, alpha);
      }
    }
  }
}

function fillRect(canvas, x, y, width, height, color, alpha = 1) {
  const startX = Math.max(0, Math.floor(x));
  const endX = Math.min(canvas.size, Math.ceil(x + width));
  const startY = Math.max(0, Math.floor(y));
  const endY = Math.min(canvas.size, Math.ceil(y + height));

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      setPixel(canvas, px, py, color, alpha);
    }
  }
}

function drawGlyph(canvas, glyph, x, y, scale, color, alpha = 1) {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === '1') {
        fillRect(canvas, x + col * scale, y + row * scale, scale, scale, color, alpha);
      }
    }
  }
}

function drawIcon(canvas) {
  const s = canvas.size;
  const p = (value) => value * s;

  fillCanvasGradient(canvas);
  fillCircle(canvas, p(0.37), p(0.5), p(0.39), hexToRgb('#667eea'), 0.12);
  fillCircle(canvas, p(0.63), p(0.5), p(0.39), hexToRgb('#a855f7'), 0.12);

  fillPolygon(
    canvas,
    [
      [p(0.45), p(0.16)],
      [p(0.74), p(0.39)],
      [p(0.45), p(0.63)],
      [p(0.16), p(0.39)],
    ],
    hexToRgb('#667eea'),
    0.94,
  );
  fillPolygon(
    canvas,
    [
      [p(0.55), p(0.16)],
      [p(0.84), p(0.39)],
      [p(0.55), p(0.63)],
      [p(0.26), p(0.39)],
    ],
    hexToRgb('#a855f7'),
    0.9,
  );
  fillPolygon(
    canvas,
    [
      [p(0.5), p(0.21)],
      [p(0.6), p(0.39)],
      [p(0.5), p(0.58)],
      [p(0.4), p(0.39)],
    ],
    hexToRgb('#c084fc'),
    0.68,
  );

  const scanLineColor = hexToRgb('#ffffff');
  fillRect(canvas, p(0.5), p(0.26), p(0.012), p(0.28), scanLineColor, 0.22);
  fillRect(canvas, p(0.55), p(0.31), p(0.01), p(0.18), scanLineColor, 0.16);

  const glyphScale = Math.floor(s * 0.092);
  drawGlyph(canvas, font.C, p(0.5) - glyphScale * 2.5, p(0.5) - glyphScale * 3.55, glyphScale, hexToRgb('#ffffff'), 0.96);
}

function downsample(source, outputSize) {
  const output = createCanvas(outputSize);
  const ratio = source.size / outputSize;
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      const startX = Math.floor(x * ratio);
      const endX = Math.floor((x + 1) * ratio);
      const startY = Math.floor(y * ratio);
      const endY = Math.floor((y + 1) * ratio);

      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          const sourceOffset = (sy * source.size + sx) * channels;
          totals[0] += source.pixels[sourceOffset];
          totals[1] += source.pixels[sourceOffset + 1];
          totals[2] += source.pixels[sourceOffset + 2];
          totals[3] += source.pixels[sourceOffset + 3];
          count += 1;
        }
      }

      const outputOffset = (y * outputSize + x) * channels;
      output.pixels[outputOffset] = Math.round(totals[0] / count);
      output.pixels[outputOffset + 1] = Math.round(totals[1] / count);
      output.pixels[outputOffset + 2] = Math.round(totals[2] / count);
      output.pixels[outputOffset + 3] = Math.round(totals[3] / count);
    }
  }
  return output;
}

function encodePng(canvas) {
  const raw = Buffer.alloc((canvas.size * channels + 1) * canvas.size);
  for (let y = 0; y < canvas.size; y += 1) {
    const rowStart = y * (canvas.size * channels + 1);
    raw[rowStart] = 0;
    canvas.pixels.copy(raw, rowStart + 1, y * canvas.size * channels, (y + 1) * canvas.size * channels);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.size, 0);
  ihdr.writeUInt32BE(canvas.size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ]);
}

function createPng(size) {
  const source = createCanvas(size * sampleScale);
  drawIcon(source);
  return encodePng(downsample(source, size));
}

function createIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size === 256 ? 0 : size;
  header[7] = size === 256 ? 0 : size;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const favicon48 = createPng(48);
writeFileSync('public/favicon-48x48.png', favicon48);
writeFileSync('public/favicon-192x192.png', createPng(192));
writeFileSync('public/apple-touch-icon.png', createPng(180));
writeFileSync('public/favicon.ico', createIco(favicon48, 48));
