require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { getCommandsJSON } = require('./lib/commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  throw new Error('DISCORD_TOKEN and CLIENT_ID are required in .env');
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: getCommandsJSON() });
  console.log(`Successfully deployed commands (${guildId ? 'guild' : 'global'}).`);
})();
