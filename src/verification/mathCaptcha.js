const DIFFICULTY_TIERS = {
  normal: { operations: ['+', '-'], maxOperand: 20 },
  hard: { operations: ['+', '-', '*'], maxOperand: 50 },
};
const DEFAULT_DIFFICULTY = 'normal';

function randomInt(max) {
  return Math.floor(Math.random() * (max + 1));
}

function generateMathCaptcha(difficulty = DEFAULT_DIFFICULTY) {
  const tier = DIFFICULTY_TIERS[difficulty] ?? DIFFICULTY_TIERS[DEFAULT_DIFFICULTY];
  const op = tier.operations[Math.floor(Math.random() * tier.operations.length)];
  let a = randomInt(tier.maxOperand);
  let b = randomInt(tier.maxOperand);
  if (op === '-' && b > a) [a, b] = [b, a]; // avoid negative answers

  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { prompt: `What is ${a} ${op} ${b}?`, answer: String(answer) };
}

module.exports = { generateMathCaptcha };
