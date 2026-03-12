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
  buildLogEmbed,
  sanitizeChannelName
} = require('./lib/ticket-utils');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

const state = loadState();
const openRateLimit = new Map();

const ticketCommand = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket management')
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Create or update ticket system setup')
      .addChannelOption((opt) => opt.setName('panel_channel').setDescription('Channel for ticket panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((opt) => opt.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((opt) => opt.setName('logs_channel').setDescription('Logs channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
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
  .addSubcommand((sub) =>
    sub
      .setName('rename')
      .setDescription('Rename current ticket')
      .addStringOption((opt) => opt.setName('name').setDescription('New ticket name').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('close').setDescription('Close current ticket'))
  .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopen current ticket'))
  .addSubcommand((sub) => sub.setName('delete').setDescription('Delete current ticket'))
  .addSubcommand((sub) => sub.setName('transcript').setDescription('Save transcript for current ticket'))
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add member to current ticket')
      .addUserOption((opt) => opt.setName('member').setDescription('Member to add').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove member from current ticket')
      .addUserOption((opt) => opt.setName('member').setDescription('Member to remove').setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .toJSON();

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

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

function canAccessTicketAction(member, ticket, config) {
  if (!member || !ticket) return false;
  if (member.id === ticket.ownerId) return true;
  return canModerateTicket(member, config);
}

async function sendLog(guild, config, payload, attachment = null) {
  const logChannelId = config.setup.logsChannelId;
  if (!logChannelId) return;

  const logsChannel = guild.channels.cache.get(logChannelId);
  if (!logsChannel || logsChannel.type !== ChannelType.GuildText) return;

  await logsChannel.send({
    embeds: [buildLogEmbed(payload)],
    files: attachment ? [attachment] : []
  });
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

  await channel.send('🔒 تم إغلاق التذكرة. يمكن إعادة فتحها عبر /ticket reopen أو زر Reopen.');

  const opener = await client.users.fetch(ticket.ownerId).catch(() => null);
  await sendLog(guild, config, {
    title: 'Ticket Closed',
    description: `Ticket closed (${source}).`,
    user: opener,
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
  const opener = await client.users.fetch(ticket.ownerId).catch(() => null);

  await sendLog(
    guild,
    config,
    {
      title: 'Ticket Deleted',
      description: `Ticket deleted (${source}).`,
      user: opener,
      moderator,
      channel,
      ticketNumber: ticket.ticketNumber,
      guildName: guild.name
    },
    transcript
  );

  delete config.openTickets[channel.id];
  saveState(state);

  return { ok: true };
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await readyClient.application.commands.set([ticketCommand]);
  console.log('Slash commands registered globally.');
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
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const config = getGuildConfig(state, guild.id);

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
    const sub = interaction.options.getSubcommand();
    const managementSubs = ['setup', 'message', 'staff-role', 'limit'];

    if (managementSubs.includes(sub) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: '❌ تحتاج صلاحية Manage Channels لاستخدام هذا الأمر.', ephemeral: true });
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

      await interaction.reply({ content: '✅ تم حفظ إعدادات نظام التذاكر.', ephemeral: true });
      return;
    }

    if (sub === 'message') {
      const panelChannel = guild.channels.cache.get(config.setup.panelChannelId);
      if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: '❌ لم يتم إعداد روم البانل. استخدم /ticket setup أولاً.', ephemeral: true });
        return;
      }

      await panelChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Support System')
            .setDescription('If you need help from the staff, click the button below.')
            .setFooter({ text: 'RevoTickets' })
        ],
        components: panelComponents()
      });

      await interaction.reply({ content: '✅ تم إرسال رسالة فتح التذاكر.', ephemeral: true });
      return;
    }

    if (sub === 'staff-role') {
      const role = interaction.options.getRole('role', true);
      if (!config.setup.supportRoleIds.includes(role.id)) {
        config.setup.supportRoleIds.push(role.id);
        saveState(state);
      }

      await interaction.reply({ content: `✅ تمت إضافة ${role} كرتبة دعم.`, ephemeral: true });
      return;
    }

    if (sub === 'limit') {
      const value = interaction.options.getInteger('value', true);
      config.setup.ticketLimit = value;
      saveState(state);
      await interaction.reply({ content: `✅ الحد الأقصى للتذاكر لكل عضو: ${value}.`, ephemeral: true });
      return;
    }

    const ticket = findTicketByChannel(config, interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: '❌ هذا الأمر يعمل فقط داخل روم تذكرة.', ephemeral: true });
      return;
    }

    if (!canAccessTicketAction(interaction.member, ticket, config)) {
      await interaction.reply({ content: '❌ لا تملك صلاحية تنفيذ هذا الإجراء داخل التذكرة.', ephemeral: true });
      return;
    }

    if (sub === 'close') {
      const result = await closeTicket(interaction.channel, guild, config, interaction.user, 'slash');
      await interaction.reply({ content: result.ok ? '✅ تم إغلاق التذكرة.' : '⚠️ التذكرة مغلقة مسبقاً.', ephemeral: true });
      return;
    }

    if (sub === 'reopen') {
      if (!ticket.closed) {
        await interaction.reply({ content: '⚠️ التذكرة مفتوحة بالفعل.', ephemeral: true });
        return;
      }

      ticket.closed = false;
      ticket.closedBy = null;
      ticket.closedAt = null;
      await interaction.channel.permissionOverwrites.edit(ticket.ownerId, {
        ViewChannel: true,
        SendMessages: true
      });
      saveState(state);

      await interaction.reply({ content: '🔁 تم إعادة فتح التذكرة.', ephemeral: true });

      await sendLog(guild, config, {
        title: 'Ticket Reopened',
        description: 'Ticket reopened by slash command.',
        user: await client.users.fetch(ticket.ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (sub === 'delete') {
      if (!canModerateTicket(interaction.member, config)) {
        await interaction.reply({ content: '❌ فقط الإدارة/الدعم يمكنهم حذف التذكرة.', ephemeral: true });
        return;
      }

      const result = await deleteTicket(interaction.channel, guild, config, interaction.user, 'slash');
      if (!result.ok) {
        await interaction.reply({ content: '❌ لا يمكن حذف هذه القناة لأنها ليست تذكرة.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: '🗑️ سيتم حذف التذكرة الآن.', ephemeral: true });
      await interaction.channel.delete('Ticket deleted by slash command');
      return;
    }

    if (sub === 'transcript') {
      const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
      await sendLog(
        guild,
        config,
        {
          title: 'Ticket Transcript',
          description: 'Manual transcript generated with slash command.',
          user: await client.users.fetch(ticket.ownerId).catch(() => null),
          moderator: interaction.user,
          channel: interaction.channel,
          ticketNumber: ticket.ticketNumber,
          guildName: guild.name
        },
        transcript
      );
      await interaction.reply({ content: '📁 تم حفظ التفريغ في روم اللوغ.', ephemeral: true });
      return;
    }

    if (sub === 'add') {
      if (!canModerateTicket(interaction.member, config)) {
        await interaction.reply({ content: '❌ فقط فريق الدعم يمكنه إضافة أعضاء.', ephemeral: true });
        return;
      }

      const member = interaction.options.getUser('member', true);
      await interaction.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });

      await interaction.reply({ content: `➕ تمت إضافة ${member}.`, ephemeral: true });
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
      if (!canModerateTicket(interaction.member, config)) {
        await interaction.reply({ content: '❌ فقط فريق الدعم يمكنه إزالة أعضاء.', ephemeral: true });
        return;
      }

      const member = interaction.options.getUser('member', true);
      if (member.id === ticket.ownerId) {
        await interaction.reply({ content: '❌ لا يمكن إزالة صاحب التذكرة.', ephemeral: true });
        return;
      }

      await interaction.channel.permissionOverwrites.delete(member.id);
      await interaction.reply({ content: `➖ تمت إزالة ${member}.`, ephemeral: true });
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
      const newName = sanitizeChannelName(interaction.options.getString('name', true));
      await interaction.channel.setName(newName);
      await interaction.reply({ content: `✏️ تم تغيير اسم التذكرة إلى \`${newName}\`.`, ephemeral: true });

      await sendLog(guild, config, {
        title: 'Ticket Renamed',
        description: `Ticket renamed to **${newName}**.`,
        user: await client.users.fetch(ticket.ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
    }

    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'ticket_open') {
      if (!config.setup.ticketCategoryId || !config.setup.panelChannelId || !config.setup.logsChannelId) {
        await interaction.reply({ content: '❌ النظام غير مُعد بالكامل. استخدم /ticket setup أولاً.', ephemeral: true });
        return;
      }

      const lastOpened = openRateLimit.get(interaction.user.id);
      const now = Date.now();
      if (lastOpened && now - lastOpened < 7000) {
        await interaction.reply({ content: '⚠️ انتظر قليلاً قبل فتح تذكرة جديدة.', ephemeral: true });
        return;
      }

      const openCount = countOpenTicketsForUser(config, interaction.user.id);
      if (openCount >= config.setup.ticketLimit) {
        await interaction.reply({ content: `❌ وصلت لحد التذاكر المسموح (${config.setup.ticketLimit}).`, ephemeral: true });
        return;
      }

      openRateLimit.set(interaction.user.id, now);
      config.ticketCounter += 1;

      const channel = await createTicketChannel(guild, interaction.user, config.ticketCounter, config.setup);
      config.openTickets[channel.id] = {
        channelId: channel.id,
        ownerId: interaction.user.id,
        ticketNumber: config.ticketCounter,
        closed: false,
        claimedBy: null,
        createdAt: Date.now(),
        createdAtEpoch: nowEpochSeconds()
      };

      saveState(state);

      await interaction.reply({ content: `✅ تم فتح تذكرتك: ${channel}`, ephemeral: true });
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
      await interaction.reply({ content: '❌ هذه ليست قناة تذكرة.', ephemeral: true });
      return;
    }

    if (!canAccessTicketAction(interaction.member, ticket, config)) {
      await interaction.reply({ content: '❌ لا تملك صلاحية استخدام أزرار التذكرة.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_claim') {
      if (!canModerateTicket(interaction.member, config)) {
        await interaction.reply({ content: '❌ فقط فريق الدعم يمكنه استلام التذكرة.', ephemeral: true });
        return;
      }

      ticket.claimedBy = interaction.user.id;
      saveState(state);

      await interaction.reply({ content: `👤 ${interaction.user} استلم التذكرة.` });
      await sendLog(guild, config, {
        title: 'Ticket Claimed',
        description: 'Ticket has been claimed by staff.',
        user: await client.users.fetch(ticket.ownerId).catch(() => null),
        moderator: interaction.user,
        channel: interaction.channel,
        ticketNumber: ticket.ticketNumber,
        guildName: guild.name
      });
      return;
    }

    if (interaction.customId === 'ticket_close') {
      const result = await closeTicket(interaction.channel, guild, config, interaction.user, 'button');
      await interaction.reply({ content: result.ok ? '🔒 تم إغلاق التذكرة.' : '⚠️ التذكرة مغلقة مسبقاً.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_reopen') {
      if (ticket.closed === false) {
        await interaction.reply({ content: '⚠️ التذكرة مفتوحة بالفعل.', ephemeral: true });
        return;
      }

      ticket.closed = false;
      ticket.closedBy = null;
      ticket.closedAt = null;
      await interaction.channel.permissionOverwrites.edit(ticket.ownerId, {
        ViewChannel: true,
        SendMessages: true
      });
      saveState(state);
      await interaction.reply({ content: '🔁 تم إعادة فتح التذكرة.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_transcript') {
      const transcript = await createTicketTranscript(interaction.channel, ticket.ticketNumber);
      await sendLog(
        guild,
        config,
        {
          title: 'Ticket Transcript',
          description: 'Manual transcript generated with button.',
          user: await client.users.fetch(ticket.ownerId).catch(() => null),
          moderator: interaction.user,
          channel: interaction.channel,
          ticketNumber: ticket.ticketNumber,
          guildName: guild.name
        },
        transcript
      );
      await interaction.reply({ content: '📁 تم حفظ التفريغ في روم اللوغ.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_delete') {
      if (!canModerateTicket(interaction.member, config)) {
        await interaction.reply({ content: '❌ فقط فريق الدعم يمكنه حذف التذكرة.', ephemeral: true });
        return;
      }

      const result = await deleteTicket(interaction.channel, guild, config, interaction.user, 'button');
      if (!result.ok) {
        await interaction.reply({ content: '❌ لا يمكن حذف هذه القناة لأنها ليست تذكرة.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: '🗑️ سيتم حذف التذكرة.', ephemeral: true });
      await interaction.channel.delete('Ticket deleted by button');
      return;
    }
  }
});

client.login(token);
