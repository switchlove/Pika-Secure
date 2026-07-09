import { describe, it, expect } from 'vitest';
import captcha from '../../src/verification/captcha.js';

const { generateImageCaptcha, pickDifficulty, normalizeAnswer } = captcha;

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('pickDifficulty', () => {
  it('returns "normal" below the threshold', () => {
    expect(pickDifficulty(49, 50)).toBe('normal');
  });

  it('returns "hard" at the threshold boundary', () => {
    expect(pickDifficulty(50, 50)).toBe('hard');
  });

  it('returns "hard" above the threshold', () => {
    expect(pickDifficulty(90, 50)).toBe('hard');
  });
});

describe('normalizeAnswer', () => {
  it('trims and uppercases', () => {
    expect(normalizeAnswer('  abc123  ')).toBe('ABC123');
  });

  it('returns an empty string for undefined', () => {
    expect(normalizeAnswer(undefined)).toBe('');
  });

  it('returns an empty string for null', () => {
    expect(normalizeAnswer(null)).toBe('');
  });

  it('returns an empty string for an empty string', () => {
    expect(normalizeAnswer('')).toBe('');
  });
});

describe('generateImageCaptcha', () => {
  it('defaults to the normal tier (6-character code)', () => {
    const { answer, buffer } = generateImageCaptcha();
    expect(answer).toHaveLength(6);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect([...buffer.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });

  it('produces an 8-character code for the hard tier', () => {
    const { answer } = generateImageCaptcha('hard');
    expect(answer).toHaveLength(8);
  });

  it('falls back to the default tier for an unknown difficulty', () => {
    const { answer } = generateImageCaptcha('nonsense');
    expect(answer).toHaveLength(6);
  });

  it('only uses characters from the unambiguous charset', () => {
    const { answer } = generateImageCaptcha('hard');
    for (const char of answer) {
      expect(CHARSET).toContain(char);
    }
  });
});
