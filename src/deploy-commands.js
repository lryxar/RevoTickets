const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');
}

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
      sub.setName('staff-role').setDescription('Add support role').addRoleOption((opt) => opt.setName('role').setDescription('Support role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Set ticket limit per member')
        .addIntegerOption((opt) => opt.setName('value').setDescription('Max open tickets').setMinValue(1).setMaxValue(5).setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('close').setDescription('Close this ticket'))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete this ticket'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add member to this ticket').addUserOption((opt) => opt.setName('member').setDescription('Member to add').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove member from this ticket').addUserOption((opt) => opt.setName('member').setDescription('Member to remove').setRequired(true)))
    .addSubcommand((sub) => sub.setName('rename').setDescription('Rename this ticket').addStringOption((opt) => opt.setName('name').setDescription('New channel name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopen this ticket'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`Successfully deployed commands (${guildId ? 'guild' : 'global'}).`);
})();
