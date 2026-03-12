const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require('discord.js');

function formatTicketName(prefix, counter) {
  return `${prefix}-${String(counter).padStart(3, '0')}`;
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
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    )
  ];
}

function sanitizeChannelName(name) {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);

  return safe || `ticket-${Date.now().toString().slice(-6)}`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function createTicketChannel(guild, opener, ticketNumber, setup) {
  const channelName = formatTicketName(setup.ticketPrefix || 'ticket', ticketNumber);
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
    name: channelName,
    type: ChannelType.GuildText,
    parent: setup.ticketCategoryId,
    permissionOverwrites: overwrites,
    topic: `Ticket #${ticketNumber} | Owner: ${opener.id}`
  });

  await channel.send({
    content: `${opener} أهلاً بك، تم فتح تذكرتك بنجاح.`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Ticket #${String(ticketNumber).padStart(3, '0')}`)
        .setDescription('فريق الدعم سيرد عليك قريباً. استخدم الأزرار للإدارة.')
        .setTimestamp()
    ],
    components: controlPanelComponents()
  });

  return channel;
}

async function createTicketTranscript(channel, ticketNumber) {
  const collected = [];
  let before;

  for (let i = 0; i < 10; i += 1) {
    const fetched = await channel.messages.fetch({ limit: 100, before });
    if (fetched.size === 0) break;

    const batch = [...fetched.values()];
    collected.push(...batch);
    before = batch[batch.length - 1].id;

    if (fetched.size < 100) break;
  }

  const ordered = collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const rows = ordered
    .map((message) => {
      const time = new Date(message.createdTimestamp).toISOString();
      const author = escapeHtml(`${message.author.tag} (${message.author.id})`);
      const content = escapeHtml(message.content || '[Attachment/Embed]');
      return `<tr><td>${time}</td><td>${author}</td><td>${content}</td></tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Ticket #${String(ticketNumber).padStart(3, '0')}</title>
<style>
body { font-family: Arial, sans-serif; background: #111; color: #f1f1f1; }
h1 { color: #8ab4ff; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #333; padding: 8px; text-align: left; vertical-align: top; }
th { background: #1f1f1f; }
tr:nth-child(even) { background: #171717; }
</style>
</head>
<body>
<h1>Transcript - Ticket #${String(ticketNumber).padStart(3, '0')}</h1>
<table>
<thead>
<tr><th>Time</th><th>User</th><th>Message</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `ticket-${String(ticketNumber).padStart(3, '0')}.html`
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
      { name: 'Server', value: guildName || 'Unknown', inline: true },
      { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setTimestamp();
}

module.exports = {
  panelComponents,
  sanitizeChannelName,
  createTicketChannel,
  createTicketTranscript,
  buildLogEmbed,
  formatTicketName
};
