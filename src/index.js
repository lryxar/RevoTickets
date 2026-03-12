const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');
const { loadState, saveState, getGuildConfig } = require('./lib/store');
const {
  panelComponents,
  createTicketChannel,
  createTicketTranscript,
  buildLogEmbed
} = require('./lib/ticket-utils');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const state = loadState();
const openCooldown = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Create or update ticket system setup')
        .addChannelOption((opt) => opt.setName('panel_channel').setDescription('Channel for ticket message').setRequired(true))
        .addChannelOption((opt) => opt.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        .addChannelOption((opt) => opt.setName('logs_channel').setDescription('Logs channel').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('message').setDescription('Send ticket panel message'))
    .addSubcommand((sub) =>
      sub
        .setName('staff-role')
        .setDescription('Add support role')
        .addRoleOption((opt) => opt.setName('role').setDescription('Support role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Set ticket limit per member')
        .addIntegerOption((opt) => opt.setName('value').setDescription('Max open tickets').setMinValue(1).setMaxValue(5).setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('close').setDescription('Close this ticket'))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete this ticket'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add member to this ticket')
        .addUserOption((opt) => opt.setName('member').setDescription('Member to add').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove member from this ticket')
        .addUserOption((opt) => opt.setName('member').setDescription('Member to remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename this ticket')
        .addStringOption((opt) => opt.setName('name').setDescription('New channel name').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopen this ticket'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map((c) => c.toJSON());

async function sendLog(guild, config, payload, attachment = null) {
  if (!config.setup.logsChannelId) return;
  const logsChannel = guild.channels.cache.get(config.setup.logsChannelId);
  if (!logsChannel || logsChannel.type !== ChannelType.GuildText) return;
  await logsChannel.send({ embeds: [buildLogEmbed(payload)], files: attachment ? [attachment] : [] });
}

function getTicketDataByChannel(config, channelId) {
  return Object.entries(config.openTickets).find(([, ticket]) => ticket.channelId === channelId);
}

async function closeTicket(channel, guild, config, moderator, byButton = false) {
  const pair = getTicketDataByChannel(config, channel.id);
  if (!pair) return { ok: false, reason: 'not_ticket' };
  const [userId, ticket] = pair;
  if (ticket.closed) return { ok: false, reason: 'already_closed' };

  ticket.closed = true;
  ticket.closedBy = moderator.id;
  ticket.closedAt = Date.now();
  await channel.permissionOverwrites.edit(userId, { SendMessages: false, ViewChannel: true });
  await channel.send('تم إغلاق التذكرة. استخدم /ticket reopen لإعادة فتحها أو /ticket delete للحذف.');

  const opener = await guild.client.users.fetch(userId).catch(() => null);
  await sendLog(guild, config, {
    title: 'Ticket Closed',
    description: byButton ? 'Ticket closed with button.' : 'Ticket closed with slash command.',
    user: opener,
    moderator,
    channel,
    ticketNumber: ticket.ticketNumber,
    guildName: guild.name
  });

  saveState(state);
  return { ok: true, ticket, userId };
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await readyClient.application.commands.set(commands);
  console.log('Slash commands registered globally.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
    const guild = interaction.guild;
    if (!guild) return;
    const config = getGuildConfig(state, guild.id);
    const sub = interaction.options.getSubcommand();

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) && !['close', 'delete', 'add', 'remove', 'rename', 'reopen'].includes(sub)) {
      await interaction.reply({ content: 'You need Manage Channels permission.', ephemeral: true });
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
      await interaction.reply({ content: '✅ Ticket setup saved.', ephemeral: true });
      return;
    }

    if (sub === 'message') {
      const panelChannel = guild.channels.cache.get(config.setup.panelChannelId);
      if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'Run /ticket setup first.', ephemeral: true });
        return;
      }
      await panelChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Support System')
            .setDescription('If you need help from the staff click the button below.')
        ],
        components: panelComponents()
      });
      await interaction.reply({ content: '✅ Ticket panel message sent.', ephemeral: true });
      return;
    }

    if (sub === 'staff-role') {
      const role = interaction.options.getRole('role', true);
      if (!config.setup.supportRoleIds.includes(role.id)) {
        config.setup.supportRoleIds.push(role.id);
      }
      saveState(state);
      await interaction.reply({ content: `✅ Added ${role} as support role.`, ephemeral: true });
      return;
    }

    if (sub === 'limit') {
      const value = interaction.options.getInteger('value', true);
      config.setup.ticketLimit = value;
      saveState(state);
      await interaction.reply({ content: `✅ Ticket limit set to ${value}.`, ephemeral: true });
      return;
    }

    const ticketPair = getTicketDataByChannel(config, interaction.channelId);
    if (!ticketPair) {
      await interaction.reply({ content: 'This command can only be used inside a ticket channel.', ephemeral: true });
      return;
    }

    const [ownerId, ticket] = ticketPair;

    if (sub === 'close') {
      const result = await closeTicket(interaction.channel, guild, config, interaction.user);
      await interaction.reply({ content: result.ok ? '✅ Ticket closed.' : 'Ticket already closed.', ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
      await sendLog(guild, config, {
        title: 'Ticket Deleted',
        description: 'Ticket was deleted.',
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      }, transcript);
      delete config.openTickets[ownerId];
      saveState(state);
      await interaction.reply({ content: '🗑 Ticket deleted.', ephemeral: true });
      await interaction.channel.delete('Ticket deleted by command');
      return;
    }

    if (sub === 'add') {
      const member = interaction.options.getUser('member', true);
      await interaction.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
      await interaction.reply({ content: `➕ Added ${member}.`, ephemeral: true });
      await sendLog(guild, config, {
        title: 'Ticket Member Added',
        description: 'Member added to ticket.',
        user: member,
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (sub === 'remove') {
      const member = interaction.options.getUser('member', true);
      await interaction.channel.permissionOverwrites.delete(member.id);
      await interaction.reply({ content: `➖ Removed ${member}.`, ephemeral: true });
      await sendLog(guild, config, {
        title: 'Ticket Member Removed',
        description: 'Member removed from ticket.',
        user: member,
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (sub === 'rename') {
      const name = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
      await interaction.channel.setName(name);
      await interaction.reply({ content: `✏️ Renamed ticket to ${name}.`, ephemeral: true });
      await sendLog(guild, config, {
        title: 'Ticket Renamed',
        description: `Ticket renamed to **${name}**.`,
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (sub === 'reopen') {
      if (!ticket.closed) {
        await interaction.reply({ content: 'Ticket is already open.', ephemeral: true });
        return;
      }
      ticket.closed = false;
      await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: true, ViewChannel: true });
      saveState(state);
      await interaction.reply({ content: '🔁 Ticket reopened.', ephemeral: true });
      await sendLog(guild, config, {
        title: 'Ticket Reopened',
        description: 'Ticket reopened by staff.',
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
    }

    return;
  }

  if (interaction.isButton()) {
    const guild = interaction.guild;
    if (!guild) return;
    const config = getGuildConfig(state, guild.id);

    if (interaction.customId === 'ticket_open') {
      const now = Date.now();
      const cooldown = openCooldown.get(interaction.user.id);
      if (cooldown && now - cooldown < 5000) {
        await interaction.reply({ content: 'Please wait a few seconds before creating another ticket.', ephemeral: true });
        return;
      }
      openCooldown.set(interaction.user.id, now);

      const existing = config.openTickets[interaction.user.id];
      const openCount = Object.values(config.openTickets).filter((t) => t.ownerId === interaction.user.id && !t.closed).length;
      if ((existing && !existing.closed) || openCount >= config.setup.ticketLimit) {
        await interaction.reply({ content: `You already reached your open ticket limit (${config.setup.ticketLimit}).`, ephemeral: true });
        return;
      }

      if (!config.setup.ticketCategoryId) {
        await interaction.reply({ content: 'System is not configured. Run /ticket setup.', ephemeral: true });
        return;
      }

      config.ticketCounter += 1;
      const channel = await createTicketChannel(guild, interaction.user, config.ticketCounter, config.setup);
      config.openTickets[interaction.user.id] = {
        ownerId: interaction.user.id,
        ticketNumber: config.ticketCounter,
        channelId: channel.id,
        closed: false,
        claimedBy: null,
        createdAt: Date.now()
      };
      saveState(state);
      await interaction.reply({ content: `✅ Your ticket has been created: ${channel}`, ephemeral: true });

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

    const ticketPair = getTicketDataByChannel(config, interaction.channelId);
    if (!ticketPair) {
      await interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
      return;
    }

    const [ownerId, ticket] = ticketPair;

    if (interaction.customId === 'ticket_claim') {
      ticket.claimedBy = interaction.user.id;
      saveState(state);
      await interaction.reply({ content: `👤 ${interaction.user} claimed this ticket.` });
      await sendLog(guild, config, {
        title: 'Ticket Claimed',
        description: 'Ticket has been claimed by staff.',
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (interaction.customId === 'ticket_close') {
      const result = await closeTicket(interaction.channel, guild, config, interaction.user, true);
      await interaction.reply({ content: result.ok ? '🔒 Ticket closed.' : 'Ticket already closed.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_reopen') {
      if (!ticket.closed) {
        await interaction.reply({ content: 'Ticket is already open.', ephemeral: true });
        return;
      }
      ticket.closed = false;
      await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: true, ViewChannel: true });
      saveState(state);
      await interaction.reply({ content: '🔁 Ticket reopened.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_transcript') {
      const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
      await interaction.reply({ content: '📁 Transcript saved to logs.', ephemeral: true });
      await sendLog(guild, config, {
        title: 'Ticket Transcript',
        description: 'Transcript generated manually.',
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      }, transcript);
      return;
    }

    if (interaction.customId === 'ticket_delete') {
      const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
      await sendLog(guild, config, {
        title: 'Ticket Deleted',
        description: 'Ticket deleted with button.',
        user: await client.users.fetch(ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      }, transcript);
      delete config.openTickets[ownerId];
      saveState(state);
      await interaction.reply({ content: '🗑 Ticket will be deleted.', ephemeral: true });
      await interaction.channel.delete('Ticket deleted');
      return;
    }

    if (interaction.customId === 'ticket_add_member' || interaction.customId === 'ticket_remove_member' || interaction.customId === 'ticket_rename' || interaction.customId === 'ticket_move') {
      await interaction.reply({ content: 'Use slash commands: /ticket add, /ticket remove, /ticket rename. Move can be done by dragging channel category.', ephemeral: true });
    }
  }
});

client.login(token);
