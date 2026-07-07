import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import permissions from '../../src/utils/permissions.js';

const { isTrueAdmin, canManageBot } = permissions;

function makeMember({ hasManageGuild = false, roleIds = [] } = {}) {
  return {
    permissions: {
      has: (flag) => (flag === PermissionFlagsBits.ManageGuild ? hasManageGuild : false),
    },
    roles: {
      cache: {
        some: (predicate) => roleIds.some((id) => predicate({ id })),
      },
    },
  };
}

describe('isTrueAdmin', () => {
  it('returns true when the member has Manage Guild', () => {
    expect(isTrueAdmin(makeMember({ hasManageGuild: true }))).toBe(true);
  });

  it('returns false when the member lacks Manage Guild', () => {
    expect(isTrueAdmin(makeMember({ hasManageGuild: false }))).toBe(false);
  });

  it('returns false when permissions is missing', () => {
    expect(isTrueAdmin({ permissions: undefined })).toBe(false);
  });
});

describe('canManageBot', () => {
  it('returns true for a true admin regardless of admin_role_ids', () => {
    const member = makeMember({ hasManageGuild: true });
    expect(canManageBot(member, { admin_role_ids: [] })).toBe(true);
  });

  it('returns true when the member holds a configured admin role', () => {
    const member = makeMember({ hasManageGuild: false, roleIds: ['role-1', 'role-2'] });
    expect(canManageBot(member, { admin_role_ids: ['role-2'] })).toBe(true);
  });

  it('returns false when the member holds none of the configured admin roles', () => {
    const member = makeMember({ hasManageGuild: false, roleIds: ['role-1'] });
    expect(canManageBot(member, { admin_role_ids: ['role-2'] })).toBe(false);
  });

  it('returns false when admin_role_ids is empty', () => {
    const member = makeMember({ hasManageGuild: false, roleIds: ['role-1'] });
    expect(canManageBot(member, { admin_role_ids: [] })).toBe(false);
  });

  it('returns false when guildConfig is missing admin_role_ids', () => {
    const member = makeMember({ hasManageGuild: false, roleIds: ['role-1'] });
    expect(canManageBot(member, {})).toBe(false);
  });
});
