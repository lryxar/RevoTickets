from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, Optional, Tuple

import discord
from dotenv import load_dotenv

from lib.commands_py import build_ticket_group, register_ticket_commands
from lib.store import get_guild_config, load_state, save_state
from lib.ticket_utils import (
    build_control_view,
    build_log_embed,
    build_panel_view,
    create_ticket_transcript,
    format_ticket_name,
    sanitize_channel_name,
)

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN is required in .env")

intents = discord.Intents.default()
intents.guilds = True
intents.guild_messages = True

client = discord.Client(intents=intents)
tree = discord.app_commands.CommandTree(client)
state = load_state()
open_rate_limit: Dict[int, float] = {}


def _get_config(guild: discord.Guild) -> Dict[str, Any]:
    return get_guild_config(state, guild.id)


def _count_open_tickets(config: Dict[str, Any], user_id: int) -> int:
    return sum(1 for t in config["open_tickets"].values() if int(t["owner_id"]) == user_id and not t["closed"])


def _find_ticket(config: Dict[str, Any], channel_id: int) -> Optional[Dict[str, Any]]:
    return config["open_tickets"].get(str(channel_id))


def _is_mod(member: discord.Member, config: Dict[str, Any]) -> bool:
    support = set(config["setup"]["support_role_ids"])
    return member.guild_permissions.manage_channels or any(str(r.id) in support for r in member.roles)


def _can_access(member: discord.Member, ticket: Dict[str, Any], config: Dict[str, Any]) -> bool:
    return member.id == int(ticket["owner_id"]) or _is_mod(member, config)


def _is_setup_complete(config: Dict[str, Any]) -> bool:
    setup = config["setup"]
    return bool(setup["panel_channel_id"] and setup["ticket_category_id"] and setup["logs_channel_id"])


async def _safe_reply(interaction: discord.Interaction, message: str, ephemeral: bool = True) -> None:
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=ephemeral)
    else:
        await interaction.response.send_message(message, ephemeral=ephemeral)


async def _send_log(
    guild: discord.Guild,
    config: Dict[str, Any],
    payload: Dict[str, Any],
    file: discord.File | None = None,
) -> None:
    try:
        logs_id = config["setup"]["logs_channel_id"]
        if not logs_id:
            return
        channel = guild.get_channel(int(logs_id))
        if not isinstance(channel, discord.TextChannel):
            return
        await channel.send(embed=build_log_embed(payload), file=file)
    except Exception as exc:
        print(f"[WARN] failed to send log: {exc}")


async def _create_ticket_channel(guild: discord.Guild, opener: discord.Member, config: Dict[str, Any]) -> discord.TextChannel:
    config["ticket_counter"] += 1
    ticket_no = int(config["ticket_counter"])

    category = guild.get_channel(int(config["setup"]["ticket_category_id"]))
    if not isinstance(category, discord.CategoryChannel):
        raise RuntimeError("Ticket category is invalid")

    channel_name = format_ticket_name(config["setup"]["ticket_prefix"], ticket_no)
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        opener: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
    }

    for role_id in config["setup"]["support_role_ids"]:
        role = guild.get_role(int(role_id))
        if role:
            overwrites[role] = discord.PermissionOverwrite(
                view_channel=True,
                send_messages=True,
                read_message_history=True,
                manage_channels=True,
            )

    channel = await guild.create_text_channel(
        channel_name,
        category=category,
        overwrites=overwrites,
        topic=f"Ticket #{ticket_no:03d} | Owner: {opener.id}",
    )

    embed = discord.Embed(
        title=f"Ticket #{ticket_no:03d}",
        description=config["setup"].get("welcome_message") or "Support team will assist you shortly.",
        color=0x5865F2,
    )
    await channel.send(content=f"{opener.mention} ticket opened.", embed=embed, view=build_control_view())

    config["open_tickets"][str(channel.id)] = {
        "channel_id": str(channel.id),
        "owner_id": str(opener.id),
        "ticket_number": ticket_no,
        "closed": False,
        "claimed_by": None,
        "priority": "medium",
        "created_at": int(time.time()),
    }
    save_state(state)
    return channel


class TicketHandlers:
    @staticmethod
    def _require_guild(interaction: discord.Interaction) -> Tuple[Optional[discord.Guild], Optional[discord.Member]]:
        guild = interaction.guild
        user = interaction.user
        if not guild or not isinstance(user, discord.Member):
            return None, None
        return guild, user

    async def _ticket_context(
        self,
        interaction: discord.Interaction,
        require_mod: bool = False,
    ) -> Tuple[Optional[discord.Guild], Optional[discord.Member], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        guild, user = self._require_guild(interaction)
        if not guild or not user:
            await _safe_reply(interaction, "Guild only command.")
            return None, None, None, None
        if not isinstance(interaction.channel, discord.TextChannel):
            await _safe_reply(interaction, "Use this command inside a ticket channel.")
            return None, None, None, None

        config = _get_config(guild)
        ticket = _find_ticket(config, interaction.channel.id)
        if not ticket:
            await _safe_reply(interaction, "This is not a ticket channel.")
            return None, None, None, None
        if not _can_access(user, ticket, config):
            await _safe_reply(interaction, "You are not allowed to manage this ticket.")
            return None, None, None, None
        if require_mod and not _is_mod(user, config):
            await _safe_reply(interaction, "Only support/admin can do this action.")
            return None, None, None, None
        return guild, user, config, ticket

    async def _ensure_admin(self, interaction: discord.Interaction) -> Tuple[Optional[discord.Guild], Optional[discord.Member], Optional[Dict[str, Any]]]:
        guild, user = self._require_guild(interaction)
        if not guild or not user:
            await _safe_reply(interaction, "Guild only command.")
            return None, None, None
        if not user.guild_permissions.manage_channels:
            await _safe_reply(interaction, "Need Manage Channels permission.")
            return None, None, None
        return guild, user, _get_config(guild)

    async def cmd_setup(self, interaction: discord.Interaction, panel_channel: discord.TextChannel, category: discord.CategoryChannel, logs_channel: discord.TextChannel) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        config["setup"]["panel_channel_id"] = str(panel_channel.id)
        config["setup"]["ticket_category_id"] = str(category.id)
        config["setup"]["logs_channel_id"] = str(logs_channel.id)
        save_state(state)
        await _safe_reply(interaction, "✅ Ticket setup saved.")

    async def cmd_message(self, interaction: discord.Interaction) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        panel_id = config["setup"]["panel_channel_id"]
        panel = guild.get_channel(int(panel_id)) if panel_id else None
        if not isinstance(panel, discord.TextChannel):
            await _safe_reply(interaction, "Panel channel not configured. Use /ticket setup first.")
            return
        embed = discord.Embed(title="Support System", description="If you need help from the staff, click the button below.", color=0x5865F2)
        await panel.send(embed=embed, view=build_panel_view())
        await _safe_reply(interaction, "✅ Ticket panel sent.")

    async def cmd_settings(self, interaction: discord.Interaction) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        s = config["setup"]
        await _safe_reply(
            interaction,
            f"Settings:\n"
            f"- prefix: `{s['ticket_prefix']}`\n"
            f"- limit: `{s['ticket_limit']}`\n"
            f"- cooldown: `{s['open_cooldown_seconds']}s`\n"
            f"- auto_close_hours: `{s['auto_close_hours']}`\n"
            f"- support roles: `{len(s['support_role_ids'])}`",
        )

    async def cmd_set_prefix(self, interaction: discord.Interaction, prefix: str) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        safe = sanitize_channel_name(prefix).replace("-", "")[:12] or "ticket"
        config["setup"]["ticket_prefix"] = safe
        save_state(state)
        await _safe_reply(interaction, f"✅ Ticket prefix set to `{safe}`")

    async def cmd_set_welcome(self, interaction: discord.Interaction, message: str) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        config["setup"]["welcome_message"] = message[:1200]
        save_state(state)
        await _safe_reply(interaction, "✅ Welcome message updated.")

    async def cmd_set_cooldown(self, interaction: discord.Interaction, seconds: int) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        config["setup"]["open_cooldown_seconds"] = int(seconds)
        save_state(state)
        await _safe_reply(interaction, f"✅ Cooldown set to {seconds}s")

    async def cmd_set_autoclose(self, interaction: discord.Interaction, hours: int) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        config["setup"]["auto_close_hours"] = int(hours)
        save_state(state)
        await _safe_reply(interaction, f"✅ Auto-close set to {hours} hour(s)")

    async def cmd_staff_add(self, interaction: discord.Interaction, role: discord.Role) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        role_id = str(role.id)
        if role_id not in config["setup"]["support_role_ids"]:
            config["setup"]["support_role_ids"].append(role_id)
            save_state(state)
        await _safe_reply(interaction, f"✅ Added support role: {role.mention}")

    async def cmd_staff_remove(self, interaction: discord.Interaction, role: discord.Role) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        role_id = str(role.id)
        if role_id in config["setup"]["support_role_ids"]:
            config["setup"]["support_role_ids"].remove(role_id)
            save_state(state)
            await _safe_reply(interaction, f"✅ Removed support role: {role.mention}")
            return
        await _safe_reply(interaction, "Role is not in support list.")

    async def cmd_staff_list(self, interaction: discord.Interaction) -> None:
        guild, user = self._require_guild(interaction)
        if not guild or not user:
            await _safe_reply(interaction, "Guild only command.")
            return
        config = _get_config(guild)
        roles = [guild.get_role(int(rid)).mention for rid in config["setup"]["support_role_ids"] if guild.get_role(int(rid))]
        await _safe_reply(interaction, "Support roles: " + (", ".join(roles) if roles else "None"))

    async def cmd_limit(self, interaction: discord.Interaction, value: int) -> None:
        guild, _user, config = await self._ensure_admin(interaction)
        if not guild or not config:
            return
        config["setup"]["ticket_limit"] = int(value)
        save_state(state)
        await _safe_reply(interaction, f"✅ Ticket limit set to {value}")

    async def cmd_claim(self, interaction: discord.Interaction) -> None:
        guild, user, _config, ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild:
            return
        ticket["claimed_by"] = str(user.id)
        save_state(state)
        await _safe_reply(interaction, f"👤 {user.mention} claimed this ticket.", ephemeral=False)

    async def cmd_unclaim(self, interaction: discord.Interaction) -> None:
        guild, _user, _config, ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild:
            return
        ticket["claimed_by"] = None
        save_state(state)
        await _safe_reply(interaction, "✅ Ticket unclaimed.")

    async def cmd_close(self, interaction: discord.Interaction, reason: str | None = None) -> None:
        guild, user, config, ticket = await self._ticket_context(interaction)
        if not guild:
            return
        if ticket["closed"]:
            await _safe_reply(interaction, "Ticket already closed.")
            return
        ticket["closed"] = True
        ticket["closed_reason"] = reason or "No reason"
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner and isinstance(interaction.channel, discord.TextChannel):
            await interaction.channel.set_permissions(owner, send_messages=False, view_channel=True)
        save_state(state)
        await _safe_reply(interaction, "🔒 Ticket closed.")
        await _send_log(
            guild,
            config,
            {
                "title": "Ticket Closed",
                "description": f"Ticket closed. Reason: {ticket['closed_reason']}",
                "user": guild.get_member(int(ticket["owner_id"])),
                "moderator": user,
                "channel": interaction.channel,
                "ticket_number": int(ticket["ticket_number"]),
                "guild_name": guild.name,
            },
        )

    async def cmd_reopen(self, interaction: discord.Interaction) -> None:
        guild, _user, _config, ticket = await self._ticket_context(interaction)
        if not guild:
            return
        if not ticket["closed"]:
            await _safe_reply(interaction, "Ticket already open.")
            return
        ticket["closed"] = False
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner and isinstance(interaction.channel, discord.TextChannel):
            await interaction.channel.set_permissions(owner, send_messages=True, view_channel=True)
        save_state(state)
        await _safe_reply(interaction, "🔁 Ticket reopened.")

    async def cmd_delete(self, interaction: discord.Interaction) -> None:
        guild, user, config, ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await _send_log(
            guild,
            config,
            {
                "title": "Ticket Deleted",
                "description": "Ticket deleted by command.",
                "user": guild.get_member(int(ticket["owner_id"])),
                "moderator": user,
                "channel": interaction.channel,
                "ticket_number": int(ticket["ticket_number"]),
                "guild_name": guild.name,
            },
            transcript,
        )
        del config["open_tickets"][str(interaction.channel.id)]
        save_state(state)
        await _safe_reply(interaction, "🗑️ Ticket will be deleted.")
        await interaction.channel.delete(reason="Ticket deleted")

    async def cmd_transcript(self, interaction: discord.Interaction) -> None:
        guild, user, config, ticket = await self._ticket_context(interaction)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await _send_log(
            guild,
            config,
            {
                "title": "Ticket Transcript",
                "description": "Transcript generated.",
                "user": guild.get_member(int(ticket["owner_id"])),
                "moderator": user,
                "channel": interaction.channel,
                "ticket_number": int(ticket["ticket_number"]),
                "guild_name": guild.name,
            },
            transcript,
        )
        await _safe_reply(interaction, "📁 Transcript sent to logs.")

    async def cmd_add(self, interaction: discord.Interaction, member: discord.Member) -> None:
        guild, _user, _config, _ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        await interaction.channel.set_permissions(member, view_channel=True, send_messages=True, read_message_history=True)
        await _safe_reply(interaction, f"➕ Added {member.mention}")

    async def cmd_remove(self, interaction: discord.Interaction, member: discord.Member) -> None:
        guild, _user, _config, ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        if member.id == int(ticket["owner_id"]):
            await _safe_reply(interaction, "Cannot remove ticket owner.")
            return
        await interaction.channel.set_permissions(member, overwrite=None)
        await _safe_reply(interaction, f"➖ Removed {member.mention}")

    async def cmd_rename(self, interaction: discord.Interaction, name: str) -> None:
        guild, _user, _config, _ticket = await self._ticket_context(interaction)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        new_name = sanitize_channel_name(name)
        await interaction.channel.edit(name=new_name)
        await _safe_reply(interaction, f"✏️ Renamed to `{new_name}`")

    async def cmd_move(self, interaction: discord.Interaction, category: discord.CategoryChannel) -> None:
        guild, _user, _config, _ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild or not isinstance(interaction.channel, discord.TextChannel):
            return
        await interaction.channel.edit(category=category)
        await _safe_reply(interaction, f"📦 Moved ticket to {category.name}")

    async def cmd_priority(self, interaction: discord.Interaction, level: str) -> None:
        guild, _user, _config, ticket = await self._ticket_context(interaction, require_mod=True)
        if not guild:
            return
        ticket["priority"] = level
        save_state(state)
        await _safe_reply(interaction, f"✅ Ticket priority set to `{level}`")

    async def cmd_stats(self, interaction: discord.Interaction) -> None:
        guild, user = self._require_guild(interaction)
        if not guild or not user:
            await _safe_reply(interaction, "Guild only command.")
            return
        config = _get_config(guild)
        total_open = sum(1 for t in config["open_tickets"].values() if not t["closed"])
        total_closed = sum(1 for t in config["open_tickets"].values() if t["closed"])
        await _safe_reply(interaction, f"Stats\n- Open: {total_open}\n- Closed: {total_closed}\n- Counter: {config['ticket_counter']}")

    async def cmd_info(self, interaction: discord.Interaction) -> None:
        guild, _user, _config, ticket = await self._ticket_context(interaction)
        if not guild:
            return
        claimed = ticket.get("claimed_by")
        claimed_text = f"<@{claimed}>" if claimed else "Nobody"
        await _safe_reply(
            interaction,
            f"Ticket #{int(ticket['ticket_number']):03d}\n"
            f"Owner: <@{ticket['owner_id']}>\n"
            f"Claimed: {claimed_text}\n"
            f"Priority: {ticket.get('priority', 'medium')}\n"
            f"Closed: {ticket['closed']}",
        )


handlers = TicketHandlers()
ticket_group = build_ticket_group()
register_ticket_commands(ticket_group, handlers)
tree.add_command(ticket_group)


@client.event
async def setup_hook() -> None:
    client.add_view(build_panel_view())
    client.add_view(build_control_view())
    client.loop.create_task(_auto_close_worker())


@client.event
async def on_ready() -> None:
    await tree.sync()
    print(f"[READY] {client.user} synced {len(tree.get_commands())} root command(s)")


@client.event
async def on_interaction(interaction: discord.Interaction) -> None:
    if interaction.type != discord.InteractionType.component:
        return
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return

    config = _get_config(interaction.guild)
    custom_id = interaction.data.get("custom_id") if interaction.data else None
    if not custom_id:
        return

    if custom_id == "ticket_open":
        if not _is_setup_complete(config):
            await _safe_reply(interaction, "System not configured. Use /ticket setup first.")
            return
        now = time.time()
        cooldown = int(config["setup"].get("open_cooldown_seconds", 7))
        if now - open_rate_limit.get(interaction.user.id, 0) < cooldown:
            await _safe_reply(interaction, f"Wait {cooldown} seconds before opening another ticket.")
            return
        if _count_open_tickets(config, interaction.user.id) >= int(config["setup"]["ticket_limit"]):
            await _safe_reply(interaction, "You reached your ticket limit.")
            return
        open_rate_limit[interaction.user.id] = now
        channel = await _create_ticket_channel(interaction.guild, interaction.user, config)
        await _safe_reply(interaction, f"✅ Ticket created: {channel.mention}")
        await _send_log(
            interaction.guild,
            config,
            {
                "title": "Ticket Opened",
                "description": "New ticket opened.",
                "user": interaction.user,
                "moderator": None,
                "channel": channel,
                "ticket_number": int(config["ticket_counter"]),
                "guild_name": interaction.guild.name,
            },
        )
        return

    if not isinstance(interaction.channel, discord.TextChannel):
        return
    ticket = _find_ticket(config, interaction.channel.id)
    if not ticket:
        await _safe_reply(interaction, "This is not a ticket channel.")
        return
    if not _can_access(interaction.user, ticket, config):
        await _safe_reply(interaction, "You cannot use ticket controls here.")
        return

    try:
        if custom_id == "ticket_claim":
            await handlers.cmd_claim(interaction)
        elif custom_id == "ticket_close":
            await handlers.cmd_close(interaction, None)
        elif custom_id == "ticket_reopen":
            await handlers.cmd_reopen(interaction)
        elif custom_id == "ticket_transcript":
            await handlers.cmd_transcript(interaction)
        elif custom_id == "ticket_delete":
            await handlers.cmd_delete(interaction)
    except Exception as exc:
        print(f"[ERROR] button action failed: {exc}")
        await _safe_reply(interaction, "Unexpected error while processing button action.")


@client.event
async def on_guild_channel_delete(channel: discord.abc.GuildChannel) -> None:
    if not isinstance(channel, discord.TextChannel) or not channel.guild:
        return
    config = _get_config(channel.guild)
    if str(channel.id) in config["open_tickets"]:
        del config["open_tickets"][str(channel.id)]
        save_state(state)


async def _auto_close_worker() -> None:
    await client.wait_until_ready()
    while not client.is_closed():
        now = int(time.time())
        for guild in client.guilds:
            config = _get_config(guild)
            hours = int(config["setup"].get("auto_close_hours", 0))
            if hours <= 0:
                continue
            threshold = hours * 3600
            changed = False
            for channel_id, ticket in list(config["open_tickets"].items()):
                if ticket.get("closed"):
                    continue
                if now - int(ticket.get("created_at", now)) < threshold:
                    continue
                channel = guild.get_channel(int(channel_id))
                if not isinstance(channel, discord.TextChannel):
                    ticket["closed"] = True
                    changed = True
                    continue
                owner = guild.get_member(int(ticket["owner_id"]))
                if owner:
                    await channel.set_permissions(owner, send_messages=False, view_channel=True)
                ticket["closed"] = True
                ticket["closed_reason"] = "Auto-close timeout"
                changed = True
            if changed:
                save_state(state)
        await asyncio.sleep(60)


def main() -> None:
    client.run(TOKEN)


if __name__ == "__main__":
    main()
