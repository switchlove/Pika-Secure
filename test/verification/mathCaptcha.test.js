import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { generateMathCaptcha } from '../../src/verification/mathCaptcha.js';

describe('generateMathCaptcha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a prompt and an answer matching the arithmetic result', () => {
    const { prompt, answer } = generateMathCaptcha('normal');
    const match = prompt.match(/What is (\d+) (.) (\d+)\?/);
    expect(match).not.toBeNull();
    const [, aStr, op, bStr] = match;
    const a = Number(aStr);
    const b = Number(bStr);
    const expected = op === '+' ? a + b : op === '-' ? a - b : a * b;
    expect(answer).toBe(String(expected));
  });

  it('never produces a negative subtraction result', () => {
    for (let i = 0; i < 50; i++) {
      const { answer, prompt } = generateMathCaptcha('normal');
      if (prompt.includes(' - ')) {
        expect(Number(answer)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('only uses +/- at the normal tier', () => {
    for (let i = 0; i < 50; i++) {
      const { prompt } = generateMathCaptcha('normal');
      expect(prompt).toMatch(/^What is \d+ [+-] \d+\?$/);
    }
  });

  it('can use multiplication at the hard tier', () => {
    vi.spyOn(crypto, 'randomInt')
      .mockReturnValueOnce(2) // pick the last operation (*)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(7);
    const { prompt, answer } = generateMathCaptcha('hard');
    expect(prompt).toContain(' * ');
    expect(answer).toBe(String(Number(answer)));
  });

  it('falls back to the normal tier for an unknown difficulty', () => {
    const { prompt } = generateMathCaptcha('nonsense');
    expect(prompt).toMatch(/^What is \d+ [+-] \d+\?$/);
  });

  it('defaults to the normal tier when no difficulty is given', () => {
    const { prompt } = generateMathCaptcha();
    expect(prompt).toMatch(/^What is \d+ [+-] \d+\?$/);
  });
});
