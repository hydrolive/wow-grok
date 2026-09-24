'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const protocol = require('../bridge/protocol');

function writeBmp(file, width, height, paint) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowStride * height;
  const buf = Buffer.alloc(54 + pixelSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + pixelSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelSize, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const row = height - 1 - y;
      const off = 54 + row * rowStride + x * 3;
      buf[off] = b;
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
  }
  fs.writeFileSync(file, buf);
}

test('capture.ps1 decodes a strip bitmap', { timeout: 60000 }, () => {
  const payload = protocol.encodePayload([
    { session: 'abc', chat: '1', id: 7, cwd: '', name: 'Chat 1', text: 'Hello strip' },
  ]);
  const frame = protocol.encodeFrame(7, payload);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowgrok-cap-'));
  const bmp = path.join(root, 'strip.bmp');
  writeBmp(bmp, 800, 192, (x, y) => {
    const index = Math.floor(y / 4) * 200 + Math.floor(x / 4);
    const cell = frame.cells[index];
    if (cell == null) return [0, 0, 0];
    const color = protocol.cellColor(cell);
    return [color.r * 255, color.g * 255, color.b * 255];
  });
  const script = path.join(__dirname, '..', 'bridge', 'capture.ps1');
  const ran = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-TestImage', bmp,
  ], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  const line = ran.stdout.trim().split(/\r?\n/).filter((row) => row.startsWith('{')).pop();
  const msg = JSON.parse(line);
  assert.equal(msg.error, undefined);
  assert.equal(msg.id, 7);
  assert.equal(msg.text, payload);
  fs.rmSync(root, { recursive: true, force: true });
});
