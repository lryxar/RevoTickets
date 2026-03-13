# RevoTickets (Python Edition)

تم تحويل المشروع بالكامل إلى **Python** باستخدام `discord.py`.

## Requirements

- Python 3.11+
- pip

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

```bash
cp .env.example .env
```

ضع القيم التالية داخل `.env`:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID` (اختياري لتسريع مزامنة الأوامر في سيرفر تجريبي)

## Run Bot

```bash
python src/bot.py
```

## Optional: Deploy/Sync commands manually

```bash
python src/deploy_commands.py
```

## Ticket Features

- Button Open Ticket
- `/ticket` command with actions:
  - setup
  - message
  - staff-role
  - limit
  - close
  - reopen
  - delete
  - transcript
  - add
  - remove
  - rename
- JSON persistence in `data.json`
- Ticket logs to logs channel
- HTML transcript export
- Anti-spam ticket creation cooldown

## Notes

- التحكم بالصلاحيات يعتمد على Discord permissions + support roles.
- عند حذف قناة تذكرة يتم تنظيفها تلقائياً من قاعدة البيانات.
