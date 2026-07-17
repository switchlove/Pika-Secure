const path = require('path');
const { randomInt } = require('node:crypto');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { generateMathCaptcha } = require('./mathCaptcha');

// Bundled rather than relying on a system font: generic CSS family names like
// "sans-serif" don't resolve in @napi-rs/canvas, and minimal/production hosts
// may have no fonts installed at all, which renders captcha text as tofu boxes.
const FONT_FAMILY = 'PikaSecure Captcha';
GlobalFonts.registerFromPath(
  path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  FONT_FAMILY,
);

// Excludes visually ambiguous characters (0/O, 1/I/L).
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HEIGHT = 100;
const CHAR_WIDTH = 38;

const DIFFICULTY_TIERS = {
  normal: { codeLength: 6, noiseLines: 6, noiseDots: 40, rotationRange: 0.35 },
  hard: { codeLength: 8, noiseLines: 12, noiseDots: 80, rotationRange: 0.5 },
};
const DEFAULT_DIFFICULTY = 'normal';

// The captcha answer is the bot's actual anti-automation secret, so it's drawn from a CSPRNG
// rather than Math.random() (whose internal state has published recovery attacks given enough
// sampled outputs). The visual jitter/noise below (randomInRange) isn't a secret, so it's left on
// Math.random().
function randomChar() {
  return CHARSET[randomInt(CHARSET.length)];
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function generateCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += randomChar();
  return code;
}

const BACKGROUND_COLOR = { r: 0x1e, g: 0x1f, b: 0x22 };

// Bends each pixel row sideways along a sine wave, in pixel space rather than
// per-glyph — this is what actually defeats "crop fixed-width slices and
// classify each independently" segmentation, since column boundaries no
// longer line up with character boundaries after the warp. Whole-glyph
// rotation alone (still applied per-character below) doesn't distort shape
// this way, which is what most classic OCR pipelines are tuned to expect.
function applyWaveDistortion(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  const amplitude = randomInRange(2.5, 4.5);
  const frequency = randomInRange(0.12, 0.22);
  const phase = randomInRange(0, Math.PI * 2);

  for (let y = 0; y < height; y++) {
    const shift = Math.round(amplitude * Math.sin(y * frequency + phase));
    for (let x = 0; x < width; x++) {
      const destOffset = (y * width + x) * 4;
      const srcX = x - shift;

      if (srcX >= 0 && srcX < width) {
        const srcOffset = (y * width + srcX) * 4;
        out[destOffset] = src[srcOffset];
        out[destOffset + 1] = src[srcOffset + 1];
        out[destOffset + 2] = src[srcOffset + 2];
        out[destOffset + 3] = src[srcOffset + 3];
      } else {
        out[destOffset] = BACKGROUND_COLOR.r;
        out[destOffset + 1] = BACKGROUND_COLOR.g;
        out[destOffset + 2] = BACKGROUND_COLOR.b;
        out[destOffset + 3] = 255;
      }
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

function renderCaptchaImage(code, tier) {
  const width = CHAR_WIDTH * (code.length + 1);
  const canvas = createCanvas(width, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = `rgb(${BACKGROUND_COLOR.r}, ${BACKGROUND_COLOR.g}, ${BACKGROUND_COLOR.b})`;
  ctx.fillRect(0, 0, width, HEIGHT);

  // Noise lines behind the text.
  for (let i = 0; i < tier.noiseLines; i++) {
    ctx.strokeStyle = `hsl(${Math.floor(randomInRange(0, 360))}, 60%, 45%)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(randomInRange(0, width), randomInRange(0, HEIGHT));
    ctx.lineTo(randomInRange(0, width), randomInRange(0, HEIGHT));
    ctx.stroke();
  }

  const charWidth = width / (code.length + 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < code.length; i++) {
    // Per-character size and horizontal jitter (on top of the wave warp
    // applied below) breaks the fixed-slot, fixed-font assumption that makes
    // this style of captcha easy to automate: every character used to render
    // at the exact same size, in the exact same evenly-spaced column.
    const fontSize = Math.round(randomInRange(36, 46));
    const x = charWidth * (i + 1) + randomInRange(-6, 6);
    const y = HEIGHT / 2 + randomInRange(-8, 8);
    const angle = randomInRange(-tier.rotationRange, tier.rotationRange);

    ctx.save();
    ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = `hsl(${Math.floor(randomInRange(0, 360))}, 70%, 75%)`;
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  applyWaveDistortion(ctx, width, HEIGHT);

  // Occluding strokes drawn on top of the (now-warped) text, in a hue range
  // that overlaps the glyph colors above — a solver that denoises by
  // thresholding "bright pastel text vs. everything else" can no longer
  // cleanly separate noise from strokes the way it could when noise only
  // ever sat behind the text or at low alpha.
  for (let i = 0; i < Math.ceil(tier.noiseLines / 2); i++) {
    ctx.strokeStyle = `hsla(${Math.floor(randomInRange(0, 360))}, 70%, 75%, 0.5)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(randomInRange(0, width), randomInRange(0, HEIGHT));
    ctx.lineTo(randomInRange(0, width), randomInRange(0, HEIGHT));
    ctx.stroke();
  }

  // Noise dots on top.
  for (let i = 0; i < tier.noiseDots; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${randomInRange(0.1, 0.4)})`;
    ctx.beginPath();
    ctx.arc(
      randomInRange(0, width),
      randomInRange(0, HEIGHT),
      randomInRange(0.5, 1.5),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

function generateImageCaptcha(difficulty = DEFAULT_DIFFICULTY) {
  const tier = DIFFICULTY_TIERS[difficulty] ?? DIFFICULTY_TIERS[DEFAULT_DIFFICULTY];
  const answer = generateCode(tier.codeLength);
  const buffer = renderCaptchaImage(answer, tier);
  return { answer, buffer };
}

// Escalates to the harder captcha tier once a member's risk score reaches the
// guild's configured threshold — riskier joins get a longer, noisier code.
function pickDifficulty(riskScore, hardThreshold) {
  return riskScore >= hardThreshold ? 'hard' : 'normal';
}

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

// A plaintext math question has essentially zero bot-resistance (trivially
// machine-parseable), so hard-difficulty joins always get the image captcha
// regardless of the guild's configured mode — math is only ever offered
// alongside the normal tier, as an accessibility/diversity option.
function pickCaptchaType(captchaMode, difficulty) {
  if (difficulty === 'hard') return 'image';
  if (captchaMode === 'random') return Math.random() < 0.5 ? 'image' : 'math';
  return captchaMode === 'math' ? 'math' : 'image';
}

function generateChallenge(type, difficulty) {
  if (type === 'math') {
    const { answer, prompt } = generateMathCaptcha(difficulty);
    return { type: 'math', answer, prompt, buffer: null };
  }
  const { answer, buffer } = generateImageCaptcha(difficulty);
  return { type: 'image', answer, buffer, prompt: null };
}

module.exports = {
  generateImageCaptcha,
  generateChallenge,
  pickCaptchaType,
  pickDifficulty,
  normalizeAnswer,
};
