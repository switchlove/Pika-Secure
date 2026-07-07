const { createCanvas } = require('@napi-rs/canvas');

// Excludes visually ambiguous characters (0/O, 1/I/L).
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const HEIGHT = 100;
const CHAR_WIDTH = 38;

const DIFFICULTY_TIERS = {
  normal: { codeLength: 6, noiseLines: 6, noiseDots: 40, rotationRange: 0.35 },
  hard: { codeLength: 8, noiseLines: 12, noiseDots: 80, rotationRange: 0.5 },
};
const DEFAULT_DIFFICULTY = 'normal';

function randomChar() {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)];
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function generateCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += randomChar();
  return code;
}

function renderCaptchaImage(code, tier) {
  const width = CHAR_WIDTH * (code.length + 1);
  const canvas = createCanvas(width, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
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
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < code.length; i++) {
    const x = charWidth * (i + 1);
    const y = HEIGHT / 2 + randomInRange(-8, 8);
    const angle = randomInRange(-tier.rotationRange, tier.rotationRange);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = `hsl(${Math.floor(randomInRange(0, 360))}, 70%, 75%)`;
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  // Noise dots on top.
  for (let i = 0; i < tier.noiseDots; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${randomInRange(0.1, 0.4)})`;
    ctx.beginPath();
    ctx.arc(randomInRange(0, width), randomInRange(0, HEIGHT), randomInRange(0.5, 1.5), 0, Math.PI * 2);
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
  return String(value || '').trim().toUpperCase();
}

module.exports = { generateImageCaptcha, pickDifficulty, normalizeAnswer };
