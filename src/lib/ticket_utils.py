from __future__ import annotations

import html
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict

import discord


def format_ticket_name(prefix: str, counter: int) -> str:
    return f"{prefix}-{counter:03d}"


def sanitize_channel_name(name: str) -> str:
    sanitized = "".join(ch.lower() if ch.isalnum() or ch in "-_" else "-" for ch in name)
    while "--" in sanitized:
        sanitized = sanitized.replace("--", "-")
    sanitized = sanitized.strip("-")[:90]
    return sanitized or f"ticket-{datetime.now(timezone.utc).strftime('%H%M%S')}"


def build_panel_view() -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(
        discord.ui.Button(
            custom_id="ticket_open",
            label="Open Ticket",
            emoji="🎟️",
            style=discord.ButtonStyle.primary,
        )
    )
    return view


def build_control_view() -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    controls = [
        ("ticket_claim", "Claim", "👤", discord.ButtonStyle.secondary),
        ("ticket_close", "Close", "🔒", discord.ButtonStyle.danger),
        ("ticket_reopen", "Reopen", "🔁", discord.ButtonStyle.success),
        ("ticket_transcript", "Transcript", "📁", discord.ButtonStyle.primary),
        ("ticket_delete", "Delete", "🗑️", discord.ButtonStyle.danger),
    ]
    for custom_id, label, emoji, style in controls:
        view.add_item(discord.ui.Button(custom_id=custom_id, label=label, emoji=emoji, style=style))
    return view


def build_log_embed(payload: Dict[str, Any]) -> discord.Embed:
    ticket_number = int(payload.get("ticket_number", 0))
    embed = discord.Embed(
        title=payload.get("title", "Ticket Log"),
        description=payload.get("description", ""),
        color=0x2B2D31,
        timestamp=datetime.now(timezone.utc),
    )
    user = payload.get("user")
    moderator = payload.get("moderator")
    channel = payload.get("channel")
    guild_name = payload.get("guild_name", "Unknown")

    embed.add_field(name="User", value=f"{user} ({getattr(user, 'id', 'N/A')})" if user else "N/A", inline=True)
    embed.add_field(name="Moderator", value=f"{moderator} ({getattr(moderator, 'id', 'N/A')})" if moderator else "N/A", inline=True)
    embed.add_field(name="Channel", value=f"{channel.mention if channel else 'N/A'}", inline=True)
    embed.add_field(name="Ticket Number", value=f"#{ticket_number:03d}", inline=True)
    embed.add_field(name="Server", value=guild_name, inline=True)
    return embed


async def create_ticket_transcript(channel: discord.TextChannel, ticket_number: int) -> discord.File:
    messages = []
    async for message in channel.history(limit=1000, oldest_first=True):
        messages.append(message)

    rows = []
    for message in messages:
        stamp = message.created_at.replace(tzinfo=timezone.utc).isoformat()
        author = html.escape(f"{message.author} ({message.author.id})")
        content = html.escape(message.content or "[Attachment/Embed]")
        rows.append(f"<tr><td>{stamp}</td><td>{author}</td><td>{content}</td></tr>")

    document = f"""<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <title>Ticket #{ticket_number:03d}</title>
  <style>
    body {{ background: #111; color: #f3f3f3; font-family: Arial, sans-serif; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ border: 1px solid #333; padding: 8px; text-align: left; vertical-align: top; }}
  </style>
</head>
<body>
  <h1>Transcript - Ticket #{ticket_number:03d}</h1>
  <table>
    <thead><tr><th>Time</th><th>User</th><th>Message</th></tr></thead>
    <tbody>{''.join(rows)}</tbody>
  </table>
</body>
</html>"""

    return discord.File(BytesIO(document.encode("utf-8")), filename=f"ticket-{ticket_number:03d}.html")
