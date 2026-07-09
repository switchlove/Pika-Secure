import { describe, it, expect } from 'vitest';
import embeds from '../../src/modlog/embeds.js';

const {
  joinedEmbed,
  verifiedEmbed,
  captchaEscalatedEmbed,
  captchaFailedEmbed,
  autoKickedEmbed,
  honeypotTriggeredEmbed,
  unconfiguredEmbed,
} = embeds;

function makeMember({ id = 'member-1', tag = 'user#0001' } = {}) {
  return { id, user: { tag } };
}

describe('joinedEmbed', () => {
  it('includes the risk score and formatted reasons', () => {
    const data = joinedEmbed(makeMember(), 42, ['reason one', 'reason two']).data;
    expect(data.color).toBe(0xfee75c);
    expect(data.title).toBe('Member joined — quarantined');
    expect(data.description).toContain('member-1');
    expect(data.fields).toEqual([
      { name: 'Risk score', value: '42/100' },
      { name: 'Reasons', value: '• reason one\n• reason two' },
    ]);
  });

  it('handles an empty reasons array', () => {
    const data = joinedEmbed(makeMember(), 0, []).data;
    expect(data.fields[1].value).toBe('');
  });
});

describe('verifiedEmbed', () => {
  it('reports button verification without a fast-solve field', () => {
    const data = verifiedEmbed(makeMember(), false).data;
    expect(data.color).toBe(0x57f287);
    expect(data.fields).toEqual([{ name: 'Method', value: 'Button (low risk)' }]);
  });

  it('reports captcha verification', () => {
    const data = verifiedEmbed(makeMember(), true).data;
    expect(data.fields[0].value).toBe('Captcha');
  });

  it('adds a fast-solve warning field when fastSolve is true', () => {
    const data = verifiedEmbed(makeMember(), true, 800, true).data;
    expect(data.fields).toHaveLength(2);
    expect(data.fields[1].name).toBe('⚠️ Unusually fast solve');
    expect(data.fields[1].value).toContain('800ms');
  });

  it('does not add the fast-solve field when fastSolve is false', () => {
    const data = verifiedEmbed(makeMember(), true, 5000, false).data;
    expect(data.fields).toHaveLength(1);
  });
});

describe('captchaEscalatedEmbed', () => {
  it('describes the escalation', () => {
    const data = captchaEscalatedEmbed(makeMember()).data;
    expect(data.color).toBe(0xe67e22);
    expect(data.title).toBe('Captcha escalated');
    expect(data.description).toContain('require a captcha');
  });
});

describe('captchaFailedEmbed', () => {
  it('uses the non-flagged color/title and reports attempts', () => {
    const data = captchaFailedEmbed(makeMember(), 1, 3, false).data;
    expect(data.color).toBe(0xe67e22);
    expect(data.title).toBe('Captcha attempt failed');
    expect(data.fields).toEqual([{ name: 'Attempts', value: '1/3' }]);
  });

  it('uses the flagged color/title when flagged', () => {
    const data = captchaFailedEmbed(makeMember(), 3, 3, true).data;
    expect(data.color).toBe(0xed4245);
    expect(data.title).toBe('Captcha failed — flagged for review');
  });
});

describe('autoKickedEmbed', () => {
  it('describes the kicked user by id', () => {
    const data = autoKickedEmbed('guild-1', 'user-9').data;
    expect(data.color).toBe(0xed4245);
    expect(data.title).toBe('Auto-kick performed');
    expect(data.description).toContain('user-9');
  });
});

describe('honeypotTriggeredEmbed', () => {
  it('defaults to the message-post phrasing', () => {
    const data = honeypotTriggeredEmbed(makeMember()).data;
    expect(data.description).toContain('posted in the honeypot channel');
  });

  it('uses reaction phrasing when trigger is "reaction"', () => {
    const data = honeypotTriggeredEmbed(makeMember(), 'reaction').data;
    expect(data.description).toContain('reacted to the bait message');
  });
});

describe('unconfiguredEmbed', () => {
  it('describes the missing configuration', () => {
    const data = unconfiguredEmbed(makeMember()).data;
    expect(data.color).toBe(0xed4245);
    expect(data.description).toContain('/setup');
  });
});
