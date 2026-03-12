const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { createTranscript } = require('discord-html-transcripts');

function formatTicketName(counter) {
  return `ticket-${String(counter).padStart(3, '0')}`;
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Open Ticket')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function controlPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('👤').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setEmoji('🔁').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Transcript').setEmoji('📁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('🗑').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_add_member').setLabel('Add Member').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_remove_member').setLabel('Remove Member').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_rename').setLabel('Rename Ticket').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_move').setLabel('Move Ticket').setEmoji('📦').setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function createTicketChannel(guild, opener, ticketNumber, setup) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: opener.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }
  ];

  for (const roleId of setup.supportRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
    });
  }

  const channel = await guild.channels.create({
    name: formatTicketName(ticketNumber),
    type: ChannelType.GuildText,
    parent: setup.ticketCategoryId,
    permissionOverwrites: overwrites,
    topic: `Ticket #${ticketNumber} | User: ${opener.id}`
  });

  await channel.send({
    content: `${opener} مرحباً! فريق الدعم سيساعدك قريباً.`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Ticket #${ticketNumber}`)
        .setDescription('استخدم لوحة التحكم لإدارة التذكرة.')
        .setTimestamp()
    ],
    components: controlPanelComponents()
  });

  return channel;
}

async function createTicketTranscript(channel, ticketNumber) {
  return createTranscript(channel, {
    saveImages: true,
    filename: `ticket-${ticketNumber}.html`,
    poweredBy: false
  });
}

function buildLogEmbed({ title, description, user, moderator, channel, ticketNumber, guildName }) {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: 'User', value: user ? `${user.tag} (${user.id})` : 'N/A', inline: true },
      { name: 'Moderator', value: moderator ? `${moderator.tag} (${moderator.id})` : 'N/A', inline: true },
      { name: 'Channel', value: channel ? `${channel}` : 'N/A', inline: true },
      { name: 'Ticket Number', value: `#${String(ticketNumber).padStart(3, '0')}`, inline: true },
      { name: 'Server', value: guildName, inline: true },
      { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
}

module.exports = {
  panelComponents,
  controlPanelComponents,
  createTicketChannel,
  createTicketTranscript,
  buildLogEmbed,
  formatTicketName
};
