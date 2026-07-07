# PikaSecure

A Discord verification/security bot. New members are quarantined on join, screened with a risk score (account age,
missing avatar, join-burst/raid detection), and must click **Verify** to proceed — risky joins are escalated to an
image captcha. Unverified members are auto-kicked after a configurable timeout. No general moderation commands are
included by design; this bot only handles the join-gate. Configuration (`/setup`) is per-server, so a single bot
process can run across as many servers as it's invited to — see "Running on multiple servers" below.

## Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), add a bot
   user, and enable the **Server Members Intent** (Privileged Gateway Intents). Message Content Intent is not needed.
2. Invite the bot with these permissions: `Manage Roles`, `Kick Members`, `Ban Members`, `View Channel`,
   `Send Messages`, `Embed Links`, `Attach Files`. Make sure the bot's role sits **above** the unverified role.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` (your test
   server's ID, for instant guild-scoped command registration during development).
4. `npm install`
5. `npm run deploy-commands`
6. `npm start`
7. In your server, create an "Unverified" role, a `#verification` channel, and a `#mod-log` channel. Then run:
   - `/setup roles unverified:<role> verified:<role optional>`
   - `/setup channels verification:<channel> modlog:<channel>` (this also posts the persistent Verify button)
   - `/setup honeypot channel:<channel>` (optional) — designate an empty, unused decoy channel. It's automatically
     locked down: hidden from `@everyone` and from the verified role, but left visible and postable for the
     unverified role as bait. Anyone who posts in it is instantly banned, except members with `Manage Server`,
     `Administrator`, `Ban Members`, or `Kick Members` (so staff testing the setup won't get caught). PikaSecure
     also posts a bait message with a seed 🎉 reaction in the channel — reacting to it triggers the same ban, which
     catches bots that auto-react instead of posting.
   - `/setup thresholds ...` to tune timeouts/risk thresholds as desired
   - `/setup view` to confirm the current configuration
   - `/setup admins add role:<role>` (optional) — let members with this role run `/setup` without granting them
     Manage Server. `/setup admins remove role:<role>` revokes it, and `/setup admins list` shows the current list.
     Adding/removing admin roles always requires real **Manage Server** permission (even for members who already
     hold a designated admin role), so a compromised or malicious role can't expand its own access or lock out real
     admins. Real Manage Server/Administrator members always retain full access regardless of this list — it's
     purely additive, and capped at 10 roles per server.

   Running `/setup roles`, `/setup channels`, or `/setup honeypot` automatically configures the unverified role's
   permissions on the relevant channels: view-only (no sending) on the verification channel, fully hidden on the
   mod-log channel, and visible-plus-postable (as bait) on the honeypot channel, where the verified role is instead
   explicitly denied view access. It also grants the bot itself an explicit `View Channel`, `Send Messages`,
   `Embed Links`, `Attach Files`, and `Manage Roles` (plus `Ban Members` on the honeypot channel) overwrite on these
   channels specifically, so the gate keeps working even in servers where `@everyone` is denied broadly. Order
   doesn't matter — whichever subcommand you run later picks up the settings already configured. If it can't apply
   a permission change (e.g. the bot's role sits below the unverified role, or lacks `Manage Roles` in that
   channel), the reply will include a warning telling you which channel to check. Every other channel in the
   server is still your responsibility to lock down for the unverified role (e.g. via category-level permissions)
   — only the verification, mod-log, and honeypot channels are managed automatically. Note also that changing the
   unverified role later does not retroactively clean up the old role's overwrites on these channels.

## Running on multiple servers

The bot's data model and event handling are already per-guild (roles, channels, thresholds, and pending
verifications are all scoped to the guild they belong to), so a single running bot process works across any number
of servers with no code changes. The only thing that differs is command deployment:

- `npm run deploy-commands` — registers `/setup` guild-scoped to `DISCORD_GUILD_ID` (instant propagation), meant for
  fast iteration during development against one test server.
- `npm run deploy-commands:global` — registers `/setup` globally, ignoring `DISCORD_GUILD_ID`. Use this once you're
  ready to invite the bot to multiple servers. Global command updates can take up to an hour to propagate to all
  servers.

After inviting the bot to each additional server, an admin there just needs to run `/setup` once in that server —
its configuration is independent from every other server the bot is in.

## Notes

- Storage is SQLite via Node's built-in `node:sqlite` module (requires Node >= 22.5.0) — no native build step needed.
  If a future Node version drops `node:sqlite`, `better-sqlite3` is a drop-in-shaped fallback (same synchronous
  `prepare().run/get/all` API) but requires a native build toolchain.
- Captcha images are generated with `@napi-rs/canvas`, which ships prebuilt binaries (no Cairo/GTK/node-gyp needed).
  If `npm start` errors with "Cannot find native binding" for `@napi-rs/canvas`, this is a known npm optional-dependency
  bug (npm/cli#4828) — run `npm install` again, or delete `node_modules`/`package-lock.json` and reinstall.
- If you're upgrading an existing deployment, re-run `npm run deploy-commands` (or `:global`) after pulling changes
  that add or modify `/setup` subcommands (e.g. `/setup admins`) — the database schema migrates itself automatically
  on startup, but Discord's command definitions only update when you explicitly redeploy them.
- The auto-kick deadline is persisted in SQLite and swept every ~60s (plus once at startup), so it survives bot
  restarts.
