const { loadImage, createCanvas } = require('@napi-rs/canvas');

// A 9x8 grayscale grid yields 8x8 = 64 pairwise comparisons, one bit each —
// small enough to hash fast, big enough to survive resizing/recompression.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const HASH_BITS = (HASH_WIDTH - 1) * HASH_HEIGHT;
const FETCH_TIMEOUT_MS = 2000;
// The caller always requests a 64x64 PNG, so this leaves generous headroom while still bounding
// worst-case memory use per join if that assumption ever changes (a different CDN, a proxy that
// doesn't enforce Discord's own size limits) instead of decoding an arbitrarily large image.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Computes a 64-bit difference hash (dHash) of the image at avatarURL,
 * returned as a fixed-length hex string. Near-identical images (recompressed,
 * resized, lightly edited) produce hashes with a small Hamming distance,
 * unlike Discord's own avatar hash which only matches byte-identical files.
 */
async function computeAvatarHash(avatarURL) {
  const response = await fetch(avatarURL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to fetch avatar image: HTTP ${response.status}`);

  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES) {
    throw new Error(`Avatar image too large: ${contentLength} bytes (max ${MAX_AVATAR_BYTES})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(`Avatar image too large: ${buffer.length} bytes (max ${MAX_AVATAR_BYTES})`);
  }

  const image = await loadImage(buffer);

  const canvas = createCanvas(HASH_WIDTH, HASH_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);

  const gray = new Array(HASH_WIDTH * HASH_HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  }

  let hash = 0n;
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = gray[row * HASH_WIDTH + col];
      const right = gray[row * HASH_WIDTH + col + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }

  return hash.toString(16).padStart(HASH_BITS / 4, '0');
}

/** Number of differing bits between two hex-encoded hashes of the same length. */
function hammingDistance(hashA, hashB) {
  let xor = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

module.exports = { computeAvatarHash, hammingDistance, HASH_BITS };
