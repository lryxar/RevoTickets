const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(process.cwd(), 'data.json');

function createDefaultGuildState() {
  return {
    setup: {
      panelChannelId: null,
      ticketCategoryId: null,
      logsChannelId: null,
      supportRoleIds: [],
      ticketLimit: 1,
      ticketPrefix: 'ticket'
    },
    ticketCounter: 0,
    openTickets: {}
  };
}

function defaultState() {
  return { guilds: {} };
}

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
  }
}

function normalizeGuildState(rawGuild = {}) {
  const base = createDefaultGuildState();
  const setup = rawGuild.setup || {};

  return {
    setup: {
      panelChannelId: setup.panelChannelId ?? base.setup.panelChannelId,
      ticketCategoryId: setup.ticketCategoryId ?? base.setup.ticketCategoryId,
      logsChannelId: setup.logsChannelId ?? base.setup.logsChannelId,
      supportRoleIds: Array.isArray(setup.supportRoleIds) ? [...new Set(setup.supportRoleIds)] : [],
      ticketLimit: Number.isInteger(setup.ticketLimit) && setup.ticketLimit > 0 ? setup.ticketLimit : 1,
      ticketPrefix: typeof setup.ticketPrefix === 'string' && setup.ticketPrefix.length > 0 ? setup.ticketPrefix : 'ticket'
    },
    ticketCounter: Number.isInteger(rawGuild.ticketCounter) && rawGuild.ticketCounter >= 0 ? rawGuild.ticketCounter : 0,
    openTickets: rawGuild.openTickets && typeof rawGuild.openTickets === 'object' ? rawGuild.openTickets : {}
  };
}

function loadState() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const guilds = parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {};

    const normalized = { guilds: {} };
    for (const [guildId, guildState] of Object.entries(guilds)) {
      normalized.guilds[guildId] = normalizeGuildState(guildState);
    }

    return normalized;
  } catch (error) {
    console.error('Failed to load data.json, resetting state.', error);
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
    state.guilds[guildId] = createDefaultGuildState();
  }
  return state.guilds[guildId];
}

module.exports = {
  loadState,
  saveState,
  getGuildConfig
};
