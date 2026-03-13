const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function buildTicketCommand() {
  return new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Professional ticket management')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Setup ticket panel/category/logs')
        .addChannelOption((opt) => opt.setName('panel_channel').setDescription('Channel for ticket panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addChannelOption((opt) => opt.setName('category').setDescription('Category for ticket channels').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        .addChannelOption((opt) => opt.setName('logs_channel').setDescription('Logs channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('message').setDescription('Send or resend ticket panel message'))
    .addSubcommand((sub) =>
      sub
        .setName('staff-role')
        .setDescription('Add support role for ticket access')
        .addRoleOption((opt) => opt.setName('role').setDescription('Support role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Set max open tickets per user')
        .addIntegerOption((opt) => opt.setName('value').setDescription('1 to 5').setMinValue(1).setMaxValue(5).setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('close').setDescription('Close current ticket'))
    .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopen current ticket'))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete current ticket'))
    .addSubcommand((sub) => sub.setName('transcript').setDescription('Generate transcript for current ticket'))
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
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename current ticket')
        .addStringOption((opt) => opt.setName('name').setDescription('New channel name').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
}

function getCommandsJSON() {
  return [buildTicketCommand().toJSON()];
}

module.exports = {
  buildTicketCommand,
  getCommandsJSON
};
