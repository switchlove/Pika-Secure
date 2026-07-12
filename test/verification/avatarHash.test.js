import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import avatarHash from '../../src/verification/avatarHash.js';

const { computeAvatarHash, hammingDistance, HASH_BITS } = avatarHash;

function pngBuffer(paint) {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  paint(ctx);
  return canvas.toBuffer('image/png');
}

function solidImage(hex) {
  return pngBuffer((ctx) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function checkeredImage() {
  return pngBuffer((ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#000000';
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        if ((x / 8 + y / 8) % 2 === 0) ctx.fillRect(x, y, 8, 8);
      }
    }
  });
}

function stubFetch(buffer, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeAvatarHash', () => {
  it('returns a fixed-length hex string sized to HASH_BITS', async () => {
    stubFetch(solidImage('#336699'));
    const hash = await computeAvatarHash('https://cdn.example/avatar.png');
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).toHaveLength(HASH_BITS / 4);
  });

  it('is deterministic for the same image', async () => {
    const buffer = solidImage('#a1b2c3');
    stubFetch(buffer);
    const first = await computeAvatarHash('https://cdn.example/avatar.png');
    stubFetch(buffer);
    const second = await computeAvatarHash('https://cdn.example/avatar.png');
    expect(second).toBe(first);
  });

  it('throws when the fetch response is not ok', async () => {
    stubFetch(solidImage('#ffffff'), { ok: false, status: 404 });
    await expect(computeAvatarHash('https://cdn.example/missing.png')).rejects.toThrow(/404/);
  });
});

describe('hammingDistance', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('abcd1234', 'abcd1234')).toBe(0);
  });

  it('is the full bit count for fully complementary hashes', () => {
    expect(hammingDistance('0000', 'ffff')).toBe(16);
  });

  it('reports a small distance for near-duplicate images', async () => {
    stubFetch(solidImage('#336699'));
    const solidHash = await computeAvatarHash('https://cdn.example/a.png');
    stubFetch(solidImage('#346699'));
    const nearDuplicateHash = await computeAvatarHash('https://cdn.example/b.png');

    expect(hammingDistance(solidHash, nearDuplicateHash)).toBeLessThanOrEqual(2);
  });

  it('reports a large distance for visually distinct images', async () => {
    stubFetch(solidImage('#ffffff'));
    const solidHash = await computeAvatarHash('https://cdn.example/a.png');
    stubFetch(checkeredImage());
    const checkeredHash = await computeAvatarHash('https://cdn.example/b.png');

    expect(hammingDistance(solidHash, checkeredHash)).toBeGreaterThan(10);
  });
});
