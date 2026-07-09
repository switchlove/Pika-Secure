import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { bustSrcRequireCache, injectFakeModule } from '../helpers/moduleCache.js';

const require = createRequire(import.meta.url);

let guildConfigMod;
let pendingVerifications;
let auditLog;
let riskAssessment;
let joinBurstTracker;
let avatarTracker;
let quarantine;
let captcha;
let modlog;
let embeds;
let logger;
let flow;

const UNCONFIGURED_EMBED = { sentinel: 'unconfigured' };
const JOINED_EMBED = { sentinel: 'joined' };
const VERIFIED_EMBED = { sentinel: 'verified' };
const CAPTCHA_ESCALATED_EMBED = { sentinel: 'captcha-escalated' };
const CAPTCHA_FAILED_EMBED = { sentinel: 'captcha-failed' };

function baseGuildConfig(overrides = {}) {
  return {
    unverified_role_id: 'role-unverified',
    verification_channel_id: 'chan-verify',
    verification_timeout_min: 15,
    join_burst_window_seconds: 60,
    avatar_reuse_window_seconds: 300,
    captcha_risk_threshold: 50,
    hard_captcha_risk_threshold: 75,
    max_captcha_attempts: 3,
    ...overrides,
  };
}

beforeEach(() => {
  bustSrcRequireCache(require);

  guildConfigMod = injectFakeModule(require, '../../src/database/guildConfig.js', { getGuildConfig: vi.fn() });

  pendingVerifications = injectFakeModule(require, '../../src/database/pendingVerifications.js', {
    createPendingVerification: vi.fn(),
    getPendingVerification: vi.fn(),
    markVerified: vi.fn(),
    escalateToCaptcha: vi.fn(),
    recordCaptchaFailure: vi.fn(),
  });

  auditLog = injectFakeModule(require, '../../src/database/auditLog.js', { insertAuditLog: vi.fn() });

  riskAssessment = injectFakeModule(require, '../../src/verification/riskAssessment.js', {
    computeRiskScore: vi.fn().mockReturnValue({ score: 10, reasons: ['low risk'] }),
  });

  joinBurstTracker = injectFakeModule(require, '../../src/verification/joinBurstTracker.js', {
    recordJoin: vi.fn().mockReturnValue(1),
  });

  avatarTracker = injectFakeModule(require, '../../src/verification/avatarTracker.js', {
    recordAvatar: vi.fn().mockReturnValue(0),
  });

  quarantine = injectFakeModule(require, '../../src/verification/quarantine.js', {
    assignUnverifiedRole: vi.fn().mockResolvedValue(undefined),
    applyVerifiedRoles: vi.fn().mockResolvedValue(undefined),
  });

  captcha = injectFakeModule(require, '../../src/verification/captcha.js', {
    generateImageCaptcha: vi.fn().mockReturnValue({ answer: 'ABC123', buffer: Buffer.from('fake-png') }),
    pickDifficulty: vi.fn().mockReturnValue('normal'),
    normalizeAnswer: vi.fn((v) => String(v || '').trim().toUpperCase()),
  });

  modlog = injectFakeModule(require, '../../src/modlog/modlog.js', { send: vi.fn().mockResolvedValue(undefined) });

  embeds = injectFakeModule(require, '../../src/modlog/embeds.js', {
    unconfiguredEmbed: vi.fn().mockReturnValue(UNCONFIGURED_EMBED),
    joinedEmbed: vi.fn().mockReturnValue(JOINED_EMBED),
    verifiedEmbed: vi.fn().mockReturnValue(VERIFIED_EMBED),
    captchaEscalatedEmbed: vi.fn().mockReturnValue(CAPTCHA_ESCALATED_EMBED),
    captchaFailedEmbed: vi.fn().mockReturnValue(CAPTCHA_FAILED_EMBED),
  });

  logger = injectFakeModule(require, '../../src/utils/logger.js', { warn: vi.fn(), error: vi.fn(), info: vi.fn() });

  flow = require('../../src/verification/flow.js');

  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeMember(overrides = {}) {
  return {
    id: 'user-1',
    guild: { id: 'guild-1' },
    client: {},
    user: { avatar: 'hash-1', tag: 'user#0001' },
    ...overrides,
  };
}

function makeInteraction(overrides = {}) {
  return {
    guild: { id: 'guild-1' },
    user: { id: 'user-1', tag: 'user#0001' },
    member: { id: 'user-1', guild: { id: 'guild-1' } },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    fields: { getTextInputValue: vi.fn() },
    ...overrides,
  };
}

describe('handleMemberJoin', () => {
  it('warns, notifies modlog, and returns early when the guild is not configured', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig({ unverified_role_id: null }));
    const member = makeMember();

    await flow.handleMemberJoin(member);

    expect(logger.warn).toHaveBeenCalled();
    expect(modlog.send).toHaveBeenCalledWith(member.client, expect.any(Object), UNCONFIGURED_EMBED);
    expect(pendingVerifications.createPendingVerification).not.toHaveBeenCalled();
  });

  it('also treats a missing verification_channel_id as unconfigured', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig({ verification_channel_id: null }));
    await flow.handleMemberJoin(makeMember());
    expect(pendingVerifications.createPendingVerification).not.toHaveBeenCalled();
  });

  it('records risk signals, creates a pending record, assigns the role, and logs the join', async () => {
    const guildConfig = baseGuildConfig({ verification_timeout_min: 10 });
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    const member = makeMember();

    await flow.handleMemberJoin(member);

    expect(joinBurstTracker.recordJoin).toHaveBeenCalledWith('guild-1', 60);
    expect(avatarTracker.recordAvatar).toHaveBeenCalledWith('guild-1', 'hash-1', 300);
    expect(riskAssessment.computeRiskScore).toHaveBeenCalledWith(member, guildConfig, 1, 0);

    expect(pendingVerifications.createPendingVerification).toHaveBeenCalledWith({
      guildId: 'guild-1',
      userId: 'user-1',
      riskScore: 10,
      riskReasons: ['low risk'],
      deadlineAt: 1_000_000 + 10 * 60_000,
      joinedAt: 1_000_000,
    });

    expect(quarantine.assignUnverifiedRole).toHaveBeenCalledWith(member, guildConfig);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'joined', {
      score: 10,
      reasons: ['low risk'],
    });
    expect(modlog.send).toHaveBeenCalledWith(member.client, guildConfig, JOINED_EMBED);
  });

  it('continues (audit log + modlog) even when assigning the unverified role fails', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    quarantine.assignUnverifiedRole.mockRejectedValue(new Error('missing perms'));
    const member = makeMember();

    await flow.handleMemberJoin(member);

    expect(logger.error).toHaveBeenCalled();
    expect(auditLog.insertAuditLog).toHaveBeenCalled();
    expect(modlog.send).toHaveBeenCalledWith(member.client, expect.any(Object), JOINED_EMBED);
  });
});

describe('handleVerifyButtonClick', () => {
  it('replies when there is no pending record', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue(undefined);
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('nothing to verify') }),
    );
  });

  it.each([
    ['verified', 'already verified'],
    ['kicked', 'window expired'],
    ['flagged', 'Too many failed attempts'],
  ])('replies with the %s-state message', async (state, expectedSubstring) => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue({ state });
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(expectedSubstring) }),
    );
  });

  it('auto-verifies a low-risk pending member via the button', async () => {
    const guildConfig = baseGuildConfig({ captcha_risk_threshold: 50 });
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    pendingVerifications.getPendingVerification.mockReturnValue({ state: 'pending', risk_score: 20 });
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(quarantine.applyVerifiedRoles).toHaveBeenCalledWith(interaction.member, guildConfig);
    expect(pendingVerifications.markVerified).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'verified', {
      viaCaptcha: false,
      latencyMs: null,
      fastSolve: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('verified') }),
    );
  });

  it('shows a cooldown message when an active captcha was issued recently', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 4000,
      risk_score: 80,
    });
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(captcha.generateImageCaptcha).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('active captcha') }),
    );
  });

  it('presents a fresh captcha once the cooldown has passed', async () => {
    const guildConfig = baseGuildConfig({ hard_captcha_risk_threshold: 75 });
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 6000,
      risk_score: 80,
    });
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(captcha.pickDifficulty).toHaveBeenCalledWith(80, 75);
    expect(captcha.generateImageCaptcha).toHaveBeenCalledWith('normal');
    expect(pendingVerifications.escalateToCaptcha).toHaveBeenCalledWith('guild-1', 'user-1', 'ABC123');
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'captcha_escalated');
    expect(modlog.send).toHaveBeenCalledWith(interaction.client, guildConfig, CAPTCHA_ESCALATED_EMBED);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ files: expect.any(Array), components: expect.any(Array) }),
    );
  });

  it('escalates a pending member whose risk is at/above the captcha threshold', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig({ captcha_risk_threshold: 50 }));
    pendingVerifications.getPendingVerification.mockReturnValue({ state: 'pending', risk_score: 50 });
    const interaction = makeInteraction();

    await flow.handleVerifyButtonClick(interaction);

    expect(captcha.generateImageCaptcha).toHaveBeenCalled();
    expect(pendingVerifications.escalateToCaptcha).toHaveBeenCalled();
  });
});

describe('handleCaptchaModalOpen', () => {
  it('replies with a guard message when there is no active captcha', async () => {
    pendingVerifications.getPendingVerification.mockReturnValue({ state: 'pending' });
    const interaction = makeInteraction();

    await flow.handleCaptchaModalOpen(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No active captcha') }),
    );
  });

  it('replies with a guard message when there is no record at all', async () => {
    pendingVerifications.getPendingVerification.mockReturnValue(undefined);
    const interaction = makeInteraction();

    await flow.handleCaptchaModalOpen(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('shows a modal sized to the captcha answer length', async () => {
    pendingVerifications.getPendingVerification.mockReturnValue({ state: 'captcha', captcha_answer: 'ABCDEF' });
    const interaction = makeInteraction();

    await flow.handleCaptchaModalOpen(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0][0];
    const json = modal.toJSON();
    expect(json.custom_id).toBe('captcha:submit');
    const textInput = json.components[0].components[0];
    expect(textInput.min_length).toBe(6);
    expect(textInput.max_length).toBe(6);
  });
});

describe('handleCaptchaModalSubmit', () => {
  function setSubmittedAnswer(value) {
    captcha.normalizeAnswer.mockReturnValue(value);
  }

  it('replies with a guard message when there is no active captcha', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue({ state: 'pending' });
    const interaction = makeInteraction();

    await flow.handleCaptchaModalSubmit(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('No active captcha') }),
    );
  });

  it('throttles resubmits within MIN_RESUBMIT_MS', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 500,
      captcha_answer: 'ABC123',
    });
    const interaction = makeInteraction();

    await flow.handleCaptchaModalSubmit(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('wait a moment') }),
    );
    expect(pendingVerifications.recordCaptchaFailure).not.toHaveBeenCalled();
  });

  it('verifies the member on a correct answer, passing latency and fastSolve through', async () => {
    const guildConfig = baseGuildConfig();
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 1500,
      captcha_answer: 'ABC123',
    });
    setSubmittedAnswer('ABC123');
    const interaction = makeInteraction();

    await flow.handleCaptchaModalSubmit(interaction);

    expect(quarantine.applyVerifiedRoles).toHaveBeenCalledWith(interaction.member, guildConfig);
    expect(pendingVerifications.markVerified).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'verified', {
      viaCaptcha: true,
      latencyMs: 1500,
      fastSolve: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Correct!') }),
    );
  });

  it('flags a fast solve under MIN_HUMAN_SOLVE_MS as fastSolve=true', async () => {
    guildConfigMod.getGuildConfig.mockReturnValue(baseGuildConfig());
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 1100,
      captcha_answer: 'ABC123',
    });
    setSubmittedAnswer('ABC123');
    const interaction = makeInteraction();

    await flow.handleCaptchaModalSubmit(interaction);

    expect(auditLog.insertAuditLog).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'verified',
      expect.objectContaining({ fastSolve: true }),
    );
  });

  it('regenerates a captcha on an incorrect answer with attempts remaining', async () => {
    const guildConfig = baseGuildConfig({ max_captcha_attempts: 3, hard_captcha_risk_threshold: 75 });
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 2000,
      captcha_answer: 'ABC123',
      captcha_attempts: 0,
      risk_score: 40,
    });
    setSubmittedAnswer('WRONG1');
    captcha.generateImageCaptcha.mockReturnValue({ answer: 'NEWCODE', buffer: Buffer.from('new-png') });
    const interaction = makeInteraction();

    await flow.handleCaptchaModalSubmit(interaction);

    expect(pendingVerifications.recordCaptchaFailure).toHaveBeenCalledWith('guild-1', 'user-1', 'NEWCODE', false);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'captcha_failed', { attempts: 1 });
    expect(modlog.send).toHaveBeenCalledWith(interaction.client, guildConfig, CAPTCHA_FAILED_EMBED);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ files: expect.any(Array) }),
    );
  });

  it('flags the record and stops generating captchas once max attempts is reached', async () => {
    const guildConfig = baseGuildConfig({ max_captcha_attempts: 3 });
    guildConfigMod.getGuildConfig.mockReturnValue(guildConfig);
    pendingVerifications.getPendingVerification.mockReturnValue({
      state: 'captcha',
      updated_at: 1_000_000 - 2000,
      captcha_answer: 'ABC123',
      captcha_attempts: 2,
      risk_score: 40,
    });
    setSubmittedAnswer('WRONG1');
    const interaction = makeInteraction();
    const callsBefore = captcha.generateImageCaptcha.mock.calls.length;

    await flow.handleCaptchaModalSubmit(interaction);

    expect(captcha.generateImageCaptcha.mock.calls.length).toBe(callsBefore);
    expect(pendingVerifications.recordCaptchaFailure).toHaveBeenCalledWith('guild-1', 'user-1', null, true);
    expect(auditLog.insertAuditLog).toHaveBeenCalledWith('guild-1', 'user-1', 'captcha_max_failed', { attempts: 3 });
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too many failed attempts') }),
    );
  });
});
