require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const { loadState, saveState, getGuildConfig } = require('./lib/store');
const { getCommandsJSON } = require('./lib/commands');
const {
  panelComponents,
  createTicketChannel,
  createTicketTranscript,
  buildLogEmbed,
  sanitizeChannelName
} = require('./lib/ticket-utils');

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is required in .env');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

const state = loadState();
const openRateLimit = new Map();

function countOpenTicketsForUser(config, userId) {
  return Object.values(config.openTickets).filter((ticket) => ticket.ownerId === userId && !ticket.closed).length;
}

function findTicketByChannel(config, channelId) {
  return config.openTickets[channelId] || null;
}

function hasSupportRole(member, supportRoleIds) {
  if (!member) return false;
  return supportRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function canModerateTicket(member, config) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || hasSupportRole(member, config.setup.supportRoleIds);
}

function canAccessTicket(member, ticket, config) {
  if (!member || !ticket) return false;
  if (member.id === ticket.ownerId) return true;
  return canModerateTicket(member, config);
}

function hasCompleteSetup(config) {
  return Boolean(config.setup.panelChannelId && config.setup.ticketCategoryId && config.setup.logsChannelId);
}

async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ ...payload, ephemeral: true });
    return;
  }
  await interaction.reply(payload);
}

async function sendLog(guild, config, payload, attachment = null) {
  try {
    if (!config.setup.logsChannelId) return;
    const logsChannel = guild.channels.cache.get(config.setup.logsChannelId);
    if (!logsChannel || logsChannel.type !== ChannelType.GuildText) return;

    await logsChannel.send({
      embeds: [buildLogEmbed(payload)],
      files: attachment ? [attachment] : []
    });
  } catch (error) {
    console.error('Failed to send ticket log:', error);
  }
}

async function closeTicket(channel, guild, config, moderator, source) {
  const ticket = findTicketByChannel(config, channel.id);
  if (!ticket) return { ok: false, reason: 'not_ticket' };
  if (ticket.closed) return { ok: false, reason: 'already_closed' };

  ticket.closed = true;
  ticket.closedBy = moderator.id;
  ticket.closedAt = Date.now();

  await channel.permissionOverwrites.edit(ticket.ownerId, {
    ViewChannel: true,
    SendMessages: false
  });

  await channel.send('🔒 Ticket closed. Use `/ticket reopen` to reopen it.');

  await sendLog(guild, config, {
    title: 'Ticket Closed',
    description: `Ticket closed via ${source}.`,
    user: await client.users.fetch(ticket.ownerId).catch(() => null),
    moderator,
    channel,
    ticketNumber: ticket.ticketNumber,
    guildName: guild.name
  });

  saveState(state);
  return { ok: true, ticket };
}

async function reopenTicket(channel, guild, config, moderator, source) {
  const ticket = findTicketByChannel(config, channel.id);
  if (!ticket) return { ok: false, reason: 'not_ticket' };
  if (!ticket.closed) return { ok: false, reason: 'already_open' };

  ticket.closed = false;
  ticket.closedBy = null;
  ticket.closedAt = null;

  await channel.permissionOverwrites.edit(ticket.ownerId, {
    ViewChannel: true,
    SendMessages: true
  });

  await sendLog(guild, config, {
    title: 'Ticket Reopened',
    description: `Ticket reopened via ${source}.`,
    user: await client.users.fetch(ticket.ownerId).catch(() => null),
    moderator,
    channel,
    ticketNumber: ticket.ticketNumber,
    guildName: guild.name
  });

  saveState(state);
  return { ok: true, ticket };
}

async function deleteTicket(channel, guild, config, moderator, source) {
  const ticket = findTicketByChannel(config, channel.id);
  if (!ticket) return { ok: false, reason: 'not_ticket' };

  const transcript = await createTicketTranscript(channel, ticket.ticketNumber);

  await sendLog(guild, config, {
    title: 'Ticket Deleted',
    description: `Ticket deleted via ${source}.`,
    user: await client.users.fetch(ticket.ownerId).catch(() => null),
    moderator,
    channel,
    ticketNumber: ticket.ticketNumber,
    guildName: guild.name
  }, transcript);

  delete config.openTickets[channel.id];
  saveState(state);
  return { ok: true, ticket };
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag}`);
  await readyClient.application.commands.set(getCommandsJSON());
  console.log('[READY] Slash commands synced globally.');
});

client.on(Events.ChannelDelete, (channel) => {
  if (!channel.guildId) return;
  const config = getGuildConfig(state, channel.guildId);
  if (config.openTickets[channel.id]) {
    delete config.openTickets[channel.id];
    saveState(state);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guild) return;

    const guild = interaction.guild;
    const config = getGuildConfig(state, guild.id);

    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
      const sub = interaction.options.getSubcommand();
      const adminSubs = ['setup', 'message', 'staff-role', 'limit'];

      if (adminSubs.includes(sub) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
        await safeReply(interaction, { content: '❌ You need Manage Channels permission.', ephemeral: true });
        return;
      }

      if (sub === 'setup') {
        const panelChannel = interaction.options.getChannel('panel_channel', true);
        const category = interaction.options.getChannel('category', true);
        const logsChannel = interaction.options.getChannel('logs_channel', true);

        config.setup.panelChannelId = panelChannel.id;
        config.setup.ticketCategoryId = category.id;
        config.setup.logsChannelId = logsChannel.id;
        saveState(state);

        await safeReply(interaction, { content: '✅ Ticket setup saved.', ephemeral: true });
        return;
      }

      if (sub === 'message') {
        const panelChannel = guild.channels.cache.get(config.setup.panelChannelId);
        if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
          await safeReply(interaction, { content: '❌ Panel channel not found. Run `/ticket setup`.', ephemeral: true });
          return;
        }

        await panelChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('Support System')
              .setDescription('If you need help from the staff, click the button below.')
          ],
          components: panelComponents()
        });

        await safeReply(interaction, { content: '✅ Ticket panel message sent.', ephemeral: true });
        return;
      }

      if (sub === 'staff-role') {
        const role = interaction.options.getRole('role', true);
        if (!config.setup.supportRoleIds.includes(role.id)) {
          config.setup.supportRoleIds.push(role.id);
          saveState(state);
        }
        await safeReply(interaction, { content: `✅ Added ${role} as support role.`, ephemeral: true });
        return;
      }

      if (sub === 'limit') {
        const value = interaction.options.getInteger('value', true);
        config.setup.ticketLimit = value;
        saveState(state);
        await safeReply(interaction, { content: `✅ Ticket limit set to ${value}.`, ephemeral: true });
        return;
      }

      const ticket = findTicketByChannel(config, interaction.channelId);
      if (!ticket) {
        await safeReply(interaction, { content: '❌ This command only works inside ticket channels.', ephemeral: true });
        return;
      }

      if (!canAccessTicket(interaction.member, ticket, config)) {
        await safeReply(interaction, { content: '❌ You are not allowed to manage this ticket.', ephemeral: true });
        return;
      }

      if (sub === 'close') {
        const result = await closeTicket(interaction.channel, guild, config, interaction.user, 'slash command');
        await safeReply(interaction, { content: result.ok ? '✅ Ticket closed.' : '⚠️ Ticket already closed.', ephemeral: true });
        return;
      }

      if (sub === 'reopen') {
        const result = await reopenTicket(interaction.channel, guild, config, interaction.user, 'slash command');
        await safeReply(interaction, { content: result.ok ? '✅ Ticket reopened.' : '⚠️ Ticket already open.', ephemeral: true });
        return;
      }

      if (sub === 'delete') {
        if (!canModerateTicket(interaction.member, config)) {
          await safeReply(interaction, { content: '❌ Only support staff/admin can delete tickets.', ephemeral: true });
          return;
        }

        const result = await deleteTicket(interaction.channel, guild, config, interaction.user, 'slash command');
        if (!result.ok) {
          await safeReply(interaction, { content: '❌ Ticket not found.', ephemeral: true });
          return;
        }

        await safeReply(interaction, { content: '🗑️ Ticket will be deleted.', ephemeral: true });
        await interaction.channel.delete('Ticket deleted by slash command');
        return;
      }

      if (sub === 'transcript') {
        const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
        await sendLog(guild, config, {
          title: 'Ticket Transcript',
          description: 'Transcript generated with slash command.',
          user: await client.users.fetch(ticket.ownerId).catch(() => null),
          moderator: interaction.user,
          channel: interaction.channel,
          ticketNumber: ticket.ticketNumber,
          guildName: guild.name
        }, transcript);

        await safeReply(interaction, { content: '✅ Transcript sent to logs.', ephemeral: true });
        return;
      }

      if (sub === 'add') {
        if (!canModerateTicket(interaction.member, config)) {
          await safeReply(interaction, { content: '❌ Only support staff/admin can add members.', ephemeral: true });
          return;
        }

        const member = interaction.options.getUser('member', true);
        await interaction.channel.permissionOverwrites.edit(member.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        await safeReply(interaction, { content: `✅ Added ${member}.`, ephemeral: true });
        return;
      }

      if (sub === 'remove') {
        if (!canModerateTicket(interaction.member, config)) {
          await safeReply(interaction, { content: '❌ Only support staff/admin can remove members.', ephemeral: true });
          return;
        }

        const member = interaction.options.getUser('member', true);
        if (member.id === ticket.ownerId) {
          await safeReply(interaction, { content: '❌ You cannot remove the ticket owner.', ephemeral: true });
          return;
        }

        await interaction.channel.permissionOverwrites.delete(member.id);
        await safeReply(interaction, { content: `✅ Removed ${member}.`, ephemeral: true });
        return;
      }

      if (sub === 'rename') {
        const newName = sanitizeChannelName(interaction.options.getString('name', true));
        await interaction.channel.setName(newName);
        await safeReply(interaction, { content: `✅ Ticket renamed to \`${newName}\`.`, ephemeral: true });
      }

      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_open') {
        if (!hasCompleteSetup(config)) {
          await safeReply(interaction, { content: '❌ Ticket system is not configured. Run `/ticket setup` first.', ephemeral: true });
          return;
        }

        const lastOpen = openRateLimit.get(interaction.user.id);
        if (lastOpen && Date.now() - lastOpen < 7000) {
          await safeReply(interaction, { content: '⚠️ Slow down. Wait 7 seconds before opening another ticket.', ephemeral: true });
          return;
        }

        const openCount = countOpenTicketsForUser(config, interaction.user.id);
        if (openCount >= config.setup.ticketLimit) {
          await safeReply(interaction, { content: `❌ You reached your ticket limit (${config.setup.ticketLimit}).`, ephemeral: true });
          return;
        }

        openRateLimit.set(interaction.user.id, Date.now());
        config.ticketCounter += 1;

        const channel = await createTicketChannel(guild, interaction.user, config.ticketCounter, config.setup);

        config.openTickets[channel.id] = {
          channelId: channel.id,
          ownerId: interaction.user.id,
          ticketNumber: config.ticketCounter,
          closed: false,
          claimedBy: null,
          createdAt: Date.now()
        };

        saveState(state);

        await safeReply(interaction, { content: `✅ Ticket created: ${channel}`, ephemeral: true });

        await sendLog(guild, config, {
          title: 'Ticket Opened',
          description: 'A new ticket has been opened.',
          user: interaction.user,
          moderator: null,
          channel,
          ticketNumber: config.ticketCounter,
          guildName: guild.name
        });
        return;
      }

      const ticket = findTicketByChannel(config, interaction.channelId);
      if (!ticket) {
        await safeReply(interaction, { content: '❌ This is not a ticket channel.', ephemeral: true });
        return;
      }

      if (!canAccessTicket(interaction.member, ticket, config)) {
        await safeReply(interaction, { content: '❌ You are not allowed to use ticket controls here.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_claim') {
        if (!canModerateTicket(interaction.member, config)) {
          await safeReply(interaction, { content: '❌ Only support staff/admin can claim tickets.', ephemeral: true });
          return;
        }

        ticket.claimedBy = interaction.user.id;
        saveState(state);
        await safeReply(interaction, { content: `✅ ${interaction.user} claimed this ticket.` });
        return;
      }

      if (interaction.customId === 'ticket_close') {
        const result = await closeTicket(interaction.channel, guild, config, interaction.user, 'button');
        await safeReply(interaction, { content: result.ok ? '✅ Ticket closed.' : '⚠️ Ticket already closed.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_reopen') {
        const result = await reopenTicket(interaction.channel, guild, config, interaction.user, 'button');
        await safeReply(interaction, { content: result.ok ? '✅ Ticket reopened.' : '⚠️ Ticket already open.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_transcript') {
        const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
        await sendLog(guild, config, {
          title: 'Ticket Transcript',
          description: 'Transcript generated with button.',
          user: await client.users.fetch(ticket.ownerId).catch(() => null),
          moderator: interaction.user,
          channel: interaction.channel,
          ticketNumber: ticket.ticketNumber,
          guildName: guild.name
        }, transcript);

        await safeReply(interaction, { content: '✅ Transcript sent to logs.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_delete') {
        if (!canModerateTicket(interaction.member, config)) {
          await safeReply(interaction, { content: '❌ Only support staff/admin can delete tickets.', ephemeral: true });
          return;
        }

        const result = await deleteTicket(interaction.channel, guild, config, interaction.user, 'button');
        if (!result.ok) {
          await safeReply(interaction, { content: '❌ Ticket not found.', ephemeral: true });
          return;
        }

        await safeReply(interaction, { content: '🗑️ Ticket will be deleted.', ephemeral: true });
        await interaction.channel.delete('Ticket deleted by button');
      }
    }
  } catch (error) {
    console.error('Interaction handler error:', error);
    if (interaction.isRepliable()) {
      await safeReply(interaction, {
        content: '❌ Unexpected error happened while processing this action.',
        ephemeral: true
      }).catch(() => null);
    }
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(token);
