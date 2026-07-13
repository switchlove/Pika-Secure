import { describe, it, expect, vi } from 'vitest';
import quarantine from '../../src/verification/quarantine.js';

const {
  assignUnverifiedRole,
  applyVerifiedRoles,
  syncChannelPermissions,
  syncHoneypotPermissions,
  buildGateMessagePayload,
  buildHoneypotBaitPayload,
  HONEYPOT_BAIT_EMOJI,
} = quarantine;

describe('buildGateMessagePayload', () => {
  it('includes the honeypot warning when a honeypot channel is configured', () => {
    const payload = buildGateMessagePayload({ honeypot_channel_id: 'chan-1' });
    const data = payload.embeds[0].data;
    expect(data.description).toContain('Do not post in or react');
    expect(data.description).toContain('chan-1');
    expect(payload.components).toHaveLength(1);
  });

  it('omits the honeypot warning when no honeypot channel is configured', () => {
    const data = buildGateMessagePayload({}).embeds[0].data;
    expect(data.description).not.toContain('Do not post in or react');
    expect(data.description).toContain('Click **Verify**');
  });

  it('handles a null/undefined guildConfig via optional chaining', () => {
    expect(() => buildGateMessagePayload(null)).not.toThrow();
    expect(() => buildGateMessagePayload(undefined)).not.toThrow();
    const data = buildGateMessagePayload(undefined).embeds[0].data;
    expect(data.description).toContain('Click **Verify**');
  });
});

describe('buildHoneypotBaitPayload', () => {
  it('builds a bait embed referencing the bait emoji by default', () => {
    const data = buildHoneypotBaitPayload().embeds[0].data;
    expect(data.color).toBe(0xed4245);
    expect(data.description).toContain(HONEYPOT_BAIT_EMOJI);
  });

  it('handles a null/undefined guildConfig via optional chaining', () => {
    expect(() => buildHoneypotBaitPayload(null)).not.toThrow();
    expect(() => buildHoneypotBaitPayload(undefined)).not.toThrow();
  });

  it('uses the guild-configured bait message when set', () => {
    const data = buildHoneypotBaitPayload({ honeypot_bait_message: 'Custom bait text' }).embeds[0]
      .data;
    expect(data.description).toBe('Custom bait text');
  });

  it('falls back to the default when honeypot_bait_message is not set', () => {
    const data = buildHoneypotBaitPayload({ honeypot_bait_message: null }).embeds[0].data;
    expect(data.description).toContain(HONEYPOT_BAIT_EMOJI);
  });
});

describe('HONEYPOT_BAIT_EMOJI', () => {
  it('is the party popper emoji', () => {
    expect(HONEYPOT_BAIT_EMOJI).toBe('🎉');
  });
});

function makeMember() {
  return {
    roles: {
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('assignUnverifiedRole', () => {
  it('does nothing when no unverified role is configured', async () => {
    const member = makeMember();
    await assignUnverifiedRole(member, {});
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('adds the unverified role when configured', async () => {
    const member = makeMember();
    await assignUnverifiedRole(member, { unverified_role_id: 'role-u' });
    expect(member.roles.add).toHaveBeenCalledWith('role-u');
  });
});

describe('applyVerifiedRoles', () => {
  it('does nothing when neither role is configured', async () => {
    const member = makeMember();
    await applyVerifiedRoles(member, {});
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it('removes the unverified role only', async () => {
    const member = makeMember();
    await applyVerifiedRoles(member, { unverified_role_id: 'role-u' });
    expect(member.roles.remove).toHaveBeenCalledWith('role-u');
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('adds the verified role only', async () => {
    const member = makeMember();
    await applyVerifiedRoles(member, { verified_role_id: 'role-v' });
    expect(member.roles.add).toHaveBeenCalledWith('role-v');
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it('removes unverified and adds verified when both are configured', async () => {
    const member = makeMember();
    await applyVerifiedRoles(member, { unverified_role_id: 'role-u', verified_role_id: 'role-v' });
    expect(member.roles.remove).toHaveBeenCalledWith('role-u');
    expect(member.roles.add).toHaveBeenCalledWith('role-v');
  });

  it('swallows a rejected roles.remove', async () => {
    const member = makeMember();
    member.roles.remove.mockRejectedValue(new Error('no perms'));
    await expect(
      applyVerifiedRoles(member, { unverified_role_id: 'role-u' }),
    ).resolves.toBeUndefined();
  });

  it('swallows a rejected roles.add', async () => {
    const member = makeMember();
    member.roles.add.mockRejectedValue(new Error('no perms'));
    await expect(
      applyVerifiedRoles(member, { verified_role_id: 'role-v' }),
    ).resolves.toBeUndefined();
  });
});

function makeChannel() {
  return { permissionOverwrites: { edit: vi.fn().mockResolvedValue(undefined) } };
}

function makeGuild({ channels = {} } = {}) {
  return {
    client: { user: { id: 'bot-1' } },
    roles: { everyone: { id: 'everyone-role' } },
    channels: {
      fetch: vi.fn((id) => {
        if (channels[id]) return Promise.resolve(channels[id]);
        return Promise.reject(new Error(`no such channel ${id}`));
      }),
    },
  };
}

describe('syncChannelPermissions', () => {
  it('returns [] immediately when no unverified role is configured', async () => {
    const guild = makeGuild();
    const failures = await syncChannelPermissions(guild, {});
    expect(failures).toEqual([]);
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns [] when neither channel is configured', async () => {
    const guild = makeGuild();
    const failures = await syncChannelPermissions(guild, { unverified_role_id: 'role-u' });
    expect(failures).toEqual([]);
  });

  it('syncs the verification channel on success', async () => {
    const verifChannel = makeChannel();
    const guild = makeGuild({ channels: { 'v-1': verifChannel } });
    const failures = await syncChannelPermissions(guild, {
      unverified_role_id: 'role-u',
      verification_channel_id: 'v-1',
    });
    expect(failures).toEqual([]);
    expect(verifChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      'bot-1',
      expect.any(Object),
    );
    expect(verifChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      'role-u',
      expect.any(Object),
    );
  });

  it('records a failure when the verification channel fetch rejects', async () => {
    const guild = makeGuild();
    const failures = await syncChannelPermissions(guild, {
      unverified_role_id: 'role-u',
      verification_channel_id: 'missing',
    });
    expect(failures).toEqual([`verification channel (<#missing>): no such channel missing`]);
  });

  it('syncs the mod-log channel on success', async () => {
    const modChannel = makeChannel();
    const guild = makeGuild({ channels: { 'm-1': modChannel } });
    const failures = await syncChannelPermissions(guild, {
      unverified_role_id: 'role-u',
      mod_log_channel_id: 'm-1',
    });
    expect(failures).toEqual([]);
    expect(modChannel.permissionOverwrites.edit).toHaveBeenCalledWith('role-u', {
      ViewChannel: false,
    });
  });

  it('records a failure when the mod-log channel fetch rejects', async () => {
    const guild = makeGuild();
    const failures = await syncChannelPermissions(guild, {
      unverified_role_id: 'role-u',
      mod_log_channel_id: 'missing-m',
    });
    expect(failures).toEqual([`mod-log channel (<#missing-m>): no such channel missing-m`]);
  });

  it('accumulates failures from both channels', async () => {
    const guild = makeGuild();
    const failures = await syncChannelPermissions(guild, {
      unverified_role_id: 'role-u',
      verification_channel_id: 'missing-v',
      mod_log_channel_id: 'missing-m',
    });
    expect(failures).toHaveLength(2);
  });
});

describe('syncHoneypotPermissions', () => {
  it('returns [] when no honeypot channel is configured', async () => {
    const guild = makeGuild();
    const failures = await syncHoneypotPermissions(guild, {});
    expect(failures).toEqual([]);
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('syncs bot + everyone permissions with neither role configured', async () => {
    const channel = makeChannel();
    const guild = makeGuild({ channels: { 'h-1': channel } });
    const failures = await syncHoneypotPermissions(guild, { honeypot_channel_id: 'h-1' });
    expect(failures).toEqual([]);
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('bot-1', expect.any(Object));
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('everyone-role', {
      ViewChannel: false,
    });
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(2);
  });

  it('additionally syncs unverified and verified roles when configured', async () => {
    const channel = makeChannel();
    const guild = makeGuild({ channels: { 'h-1': channel } });
    const failures = await syncHoneypotPermissions(guild, {
      honeypot_channel_id: 'h-1',
      unverified_role_id: 'role-u',
      verified_role_id: 'role-v',
    });
    expect(failures).toEqual([]);
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('role-u', expect.any(Object));
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('role-v', {
      ViewChannel: false,
    });
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(4);
  });

  it('records a failure when the honeypot channel fetch rejects', async () => {
    const guild = makeGuild();
    const failures = await syncHoneypotPermissions(guild, { honeypot_channel_id: 'missing-h' });
    expect(failures).toEqual([`honeypot channel (<#missing-h>): no such channel missing-h`]);
  });
});
