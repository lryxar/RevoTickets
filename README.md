# RevoTickets

Professional Discord Ticket Support System with buttons + slash commands.

## Features

- Button-based ticket creation (`🎟️ Open Ticket`)
- Full `/ticket` slash command suite:
  - `setup`, `message`, `staff-role`, `limit`
  - `close`, `delete`, `add`, `remove`, `rename`, `reopen`
- Advanced logs in a configured logs channel
- Transcript export as HTML (`discord-html-transcripts`)
- Anti-spam + ticket-per-user limit
- Persistent JSON storage (`data.json`)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file:
   ```bash
   cp .env.example .env
   ```
3. Fill `.env` values:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - optional `GUILD_ID` (for fast guild-only slash command deploy)
4. Deploy commands:
   ```bash
   npm run deploy
   ```
5. Start bot:
   ```bash
   npm start
   ```

## First-time Discord configuration

1. Run `/ticket setup` and choose:
   - panel channel
   - tickets category
   - logs channel
2. Run `/ticket staff-role` (repeat if multiple support roles)
3. Run `/ticket limit 1` (or any value 1–5)
4. Run `/ticket message` to send panel embed with button

## Notes

- Data is persisted in `data.json`.
- Ticket names are auto-numbered: `ticket-001`, `ticket-002`, ...
- Use channel-level permissions so bot can create/manage channels.
