import { describe, it, expect } from 'vitest';
import embeds from '../../src/modlog/embeds.js';

const {
  joinedEmbed,
  rejoinWhileFlaggedEmbed,
  verifiedEmbed,
  captchaEscalatedEmbed,
  captchaFailedEmbed,
  fastSolveFlaggedEmbed,
  flaggedListEmbed,
  auditLogListEmbed,
  autoKickedEmbed,
  honeypotTriggeredEmbed,
  raidLockdownEngagedEmbed,
  raidLockdownLiftedEmbed,
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

describe('rejoinWhileFlaggedEmbed', () => {
  it('states the flag was not reset and includes the current score/reasons', () => {
    const data = rejoinWhileFlaggedEmbed(makeMember(), 55, ['reason one', 'reason two']).data;
    expect(data.color).toBe(0xed4245);
    expect(data.title).toContain('rejoined');
    expect(data.description).toContain('member-1');
    expect(data.description).toContain('not');
    expect(data.fields).toEqual([
      { name: 'Current risk score', value: '55/100' },
      { name: 'Reasons', value: '• reason one\n• reason two' },
    ]);
  });

  it('handles an empty reasons array', () => {
    const data = rejoinWhileFlaggedEmbed(makeMember(), 0, []).data;
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

describe('fastSolveFlaggedEmbed', () => {
  it('reports the solve time and repeat count', () => {
    const data = fastSolveFlaggedEmbed(makeMember(), 900, 4).data;
    expect(data.color).toBe(0xed4245);
    expect(data.title).toBe('Captcha solved correctly — flagged for review');
    expect(data.fields).toEqual([
      { name: 'Solve time', value: '900ms' },
      { name: 'Fast solves in window', value: '4' },
    ]);
  });
});

describe('flaggedListEmbed', () => {
  it('shows an empty-state message when there are no records', () => {
    const data = flaggedListEmbed([]).data;
    expect(data.description).toBe('No members currently flagged.');
    expect(data.fields).toBeUndefined();
  });

  it('renders a field per flagged record', () => {
    const records = [
      {
        user_id: 'user-1',
        risk_score: 80,
        captcha_attempts: 3,
        risk_reasons: JSON.stringify(['no avatar', 'join burst']),
      },
    ];
    const data = flaggedListEmbed(records).data;
    expect(data.fields).toHaveLength(1);
    expect(data.fields[0].name).toContain('user-1');
    expect(data.fields[0].value).toContain('80/100');
    expect(data.fields[0].value).toContain('no avatar, join burst');
  });

  it('falls back to a placeholder when reasons are empty', () => {
    const records = [
      { user_id: 'user-1', risk_score: 10, captcha_attempts: 0, risk_reasons: '[]' },
    ];
    const data = flaggedListEmbed(records).data;
    expect(data.fields[0].value).toContain('No reasons recorded');
  });
});

describe('auditLogListEmbed', () => {
  it('shows an empty-state message when there are no entries', () => {
    const data = auditLogListEmbed([]).data;
    expect(data.description).toBe('No matching audit log entries.');
    expect(data.fields).toBeUndefined();
  });

  it('renders a field per entry, with N/A for a null user', () => {
    const entries = [
      { event_type: 'auto_kicked', user_id: null, detail: null, created_at: 1_700_000_000_000 },
      {
        event_type: 'verified',
        user_id: 'user-1',
        detail: JSON.stringify({ viaCaptcha: true }),
        created_at: 1_700_000_000_000,
      },
    ];
    const data = auditLogListEmbed(entries).data;
    expect(data.fields).toHaveLength(2);
    expect(data.fields[0].name).toContain('auto_kicked');
    expect(data.fields[0].value).toContain('N/A');
    expect(data.fields[1].value).toContain('user-1');
    expect(data.fields[1].value).toContain('viaCaptcha');
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

  it('reports the ban failure and asks for manual action when banFailed is true', () => {
    const data = honeypotTriggeredEmbed(makeMember(), 'message', true).data;
    expect(data.title).toContain('ban FAILED');
    expect(data.description).toContain('could not ban this member');
  });
});

describe('raidLockdownEngagedEmbed', () => {
  it('reports success when the verification level was raised', () => {
    const data = raidLockdownEngagedEmbed(20, true).data;
    expect(data.color).toBe(0xff0000);
    expect(data.description).toContain('20 joins');
    expect(data.fields[0].name).toContain('raised');
    expect(data.fields[0].value).toContain('revert automatically');
  });

  it('warns when the verification level could not be raised', () => {
    const data = raidLockdownEngagedEmbed(20, false).data;
    expect(data.fields[0].name).toContain("Couldn't raise");
    expect(data.fields[0].value).toContain('Manage Server');
  });
});

describe('raidLockdownLiftedEmbed', () => {
  it('reports success when reverted', () => {
    const data = raidLockdownLiftedEmbed(true).data;
    expect(data.color).toBe(0x57f287);
    expect(data.description).toContain('reverted');
  });

  it('warns when the revert failed', () => {
    const data = raidLockdownLiftedEmbed(false).data;
    expect(data.description).toContain('failed');
  });
});

describe('unconfiguredEmbed', () => {
  it('describes the missing configuration', () => {
    const data = unconfiguredEmbed(makeMember()).data;
    expect(data.color).toBe(0xed4245);
    expect(data.description).toContain('/setup');
  });
});
