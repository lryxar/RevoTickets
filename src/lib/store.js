const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(process.cwd(), 'data.json');

const defaultState = () => ({
  guilds: {}
});

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
  }
}

function loadState() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.guilds) parsed.guilds = {};
    return parsed;
  } catch (error) {
    console.error('Failed to load data.json, rebuilding.', error);
    const state = defaultState();
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf8');
    return state;
  }
}

function saveState(state) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function getGuildConfig(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = {
      setup: {
        panelChannelId: null,
        ticketCategoryId: null,
        logsChannelId: null,
        supportRoleIds: [],
        ticketLimit: 1
      },
      ticketCounter: 0,
      openTickets: {}
    };
  }
  return state.guilds[guildId];
}

module.exports = {
  loadState,
  saveState,
  getGuildConfig
};
