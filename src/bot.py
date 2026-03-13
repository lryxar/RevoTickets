from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

import discord
from discord import app_commands
from dotenv import load_dotenv

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
tree = app_commands.CommandTree(client)
state = load_state()
open_rate_limit: Dict[int, float] = {}


def count_open_tickets(config: Dict[str, Any], user_id: int) -> int:
    return sum(1 for t in config["open_tickets"].values() if int(t["owner_id"]) == user_id and not t["closed"])


def find_ticket_by_channel(config: Dict[str, Any], channel_id: int) -> Optional[Dict[str, Any]]:
    return config["open_tickets"].get(str(channel_id))


def can_moderate(member: discord.Member, config: Dict[str, Any]) -> bool:
    role_ids = set(config["setup"]["support_role_ids"])
    return member.guild_permissions.manage_channels or any(str(role.id) in role_ids for role in member.roles)


def can_access(member: discord.Member, ticket: Dict[str, Any], config: Dict[str, Any]) -> bool:
    return member.id == int(ticket["owner_id"]) or can_moderate(member, config)


async def send_log(guild: discord.Guild, config: Dict[str, Any], payload: Dict[str, Any], file: discord.File | None = None) -> None:
    channel_id = config["setup"]["logs_channel_id"]
    if not channel_id:
        return
    channel = guild.get_channel(int(channel_id))
    if not isinstance(channel, discord.TextChannel):
        return
    await channel.send(embed=build_log_embed(payload), file=file)


async def create_ticket_channel(guild: discord.Guild, opener: discord.Member, config: Dict[str, Any]) -> discord.TextChannel:
    config["ticket_counter"] += 1
    ticket_no = int(config["ticket_counter"])
    prefix = config["setup"]["ticket_prefix"]
    channel_name = format_ticket_name(prefix, ticket_no)

    category = guild.get_channel(int(config["setup"]["ticket_category_id"]))
    if not isinstance(category, discord.CategoryChannel):
        raise RuntimeError("Ticket category not configured correctly")

    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        opener: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
    }

    for role_id in config["setup"]["support_role_ids"]:
        role = guild.get_role(int(role_id))
        if role:
            overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, manage_channels=True)

    channel = await guild.create_text_channel(channel_name, category=category, overwrites=overwrites, topic=f"Ticket #{ticket_no:03d} | Owner: {opener.id}")

    embed = discord.Embed(title=f"Ticket #{ticket_no:03d}", description="Support team will respond soon.", color=0x5865F2)
    await channel.send(content=f"{opener.mention} ticket opened successfully.", embed=embed, view=build_control_view())

    config["open_tickets"][str(channel.id)] = {
        "channel_id": str(channel.id),
        "owner_id": str(opener.id),
        "ticket_number": ticket_no,
        "closed": False,
        "claimed_by": None,
        "created_at": int(time.time()),
    }
    save_state(state)
    return channel


@client.event
async def on_ready() -> None:
    print(f"Logged in as {client.user}")
    await tree.sync()
    print("Slash commands synced.")


@tree.command(name="ticket", description="Ticket management")
@app_commands.describe(action="Action", panel_channel="Panel channel", category="Ticket category", logs_channel="Logs channel", role="Support role", value="Ticket limit", member="Target member", name="New ticket name")
@app_commands.choices(action=[
    app_commands.Choice(name="setup", value="setup"),
    app_commands.Choice(name="message", value="message"),
    app_commands.Choice(name="staff-role", value="staff-role"),
    app_commands.Choice(name="limit", value="limit"),
    app_commands.Choice(name="close", value="close"),
    app_commands.Choice(name="reopen", value="reopen"),
    app_commands.Choice(name="delete", value="delete"),
    app_commands.Choice(name="transcript", value="transcript"),
    app_commands.Choice(name="add", value="add"),
    app_commands.Choice(name="remove", value="remove"),
    app_commands.Choice(name="rename", value="rename"),
])
async def ticket_command(
    interaction: discord.Interaction,
    action: app_commands.Choice[str],
    panel_channel: Optional[discord.TextChannel] = None,
    category: Optional[discord.CategoryChannel] = None,
    logs_channel: Optional[discord.TextChannel] = None,
    role: Optional[discord.Role] = None,
    value: Optional[int] = None,
    member: Optional[discord.Member] = None,
    name: Optional[str] = None,
) -> None:
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        await interaction.response.send_message("Guild only command.", ephemeral=True)
        return

    guild = interaction.guild
    config = get_guild_config(state, guild.id)
    act = action.value

    admin_actions = {"setup", "message", "staff-role", "limit"}
    if act in admin_actions and not interaction.user.guild_permissions.manage_channels:
        await interaction.response.send_message("You need Manage Channels permission.", ephemeral=True)
        return

    if act == "setup":
        if not panel_channel or not category or not logs_channel:
            await interaction.response.send_message("setup يحتاج panel_channel + category + logs_channel", ephemeral=True)
            return
        config["setup"]["panel_channel_id"] = str(panel_channel.id)
        config["setup"]["ticket_category_id"] = str(category.id)
        config["setup"]["logs_channel_id"] = str(logs_channel.id)
        save_state(state)
        await interaction.response.send_message("✅ setup saved", ephemeral=True)
        return

    if act == "message":
        panel = guild.get_channel(int(config["setup"]["panel_channel_id"])) if config["setup"]["panel_channel_id"] else None
        if not isinstance(panel, discord.TextChannel):
            await interaction.response.send_message("Run setup first.", ephemeral=True)
            return
        embed = discord.Embed(title="Support System", description="If you need help from staff, click the button below.", color=0x5865F2)
        await panel.send(embed=embed, view=build_panel_view())
        await interaction.response.send_message("✅ panel sent", ephemeral=True)
        return

    if act == "staff-role":
        if not role:
            await interaction.response.send_message("حدد role", ephemeral=True)
            return
        if str(role.id) not in config["setup"]["support_role_ids"]:
            config["setup"]["support_role_ids"].append(str(role.id))
            save_state(state)
        await interaction.response.send_message(f"✅ added {role.mention}", ephemeral=True)
        return

    if act == "limit":
        if not value or value < 1 or value > 5:
            await interaction.response.send_message("limit لازم بين 1 و 5", ephemeral=True)
            return
        config["setup"]["ticket_limit"] = value
        save_state(state)
        await interaction.response.send_message(f"✅ limit set to {value}", ephemeral=True)
        return

    if not isinstance(interaction.channel, discord.TextChannel):
        await interaction.response.send_message("Use inside ticket channel.", ephemeral=True)
        return

    ticket = find_ticket_by_channel(config, interaction.channel.id)
    if not ticket:
        await interaction.response.send_message("This is not a ticket channel.", ephemeral=True)
        return

    if not can_access(interaction.user, ticket, config):
        await interaction.response.send_message("Not allowed.", ephemeral=True)
        return

    if act == "close":
        ticket["closed"] = True
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner:
            await interaction.channel.set_permissions(owner, send_messages=False, view_channel=True)
        save_state(state)
        await interaction.response.send_message("🔒 ticket closed", ephemeral=True)
        return

    if act == "reopen":
        ticket["closed"] = False
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner:
            await interaction.channel.set_permissions(owner, send_messages=True, view_channel=True)
        save_state(state)
        await interaction.response.send_message("🔁 ticket reopened", ephemeral=True)
        return

    if act == "transcript":
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await send_log(guild, config, {
            "title": "Ticket Transcript",
            "description": "Transcript generated",
            "user": guild.get_member(int(ticket["owner_id"])),
            "moderator": interaction.user,
            "channel": interaction.channel,
            "ticket_number": int(ticket["ticket_number"]),
            "guild_name": guild.name,
        }, transcript)
        await interaction.response.send_message("📁 transcript sent to logs", ephemeral=True)
        return

    if act == "add":
        if not can_moderate(interaction.user, config) or not member:
            await interaction.response.send_message("Only support/admin + member required", ephemeral=True)
            return
        await interaction.channel.set_permissions(member, view_channel=True, send_messages=True, read_message_history=True)
        await interaction.response.send_message(f"➕ Added {member.mention}", ephemeral=True)
        return

    if act == "remove":
        if not can_moderate(interaction.user, config) or not member:
            await interaction.response.send_message("Only support/admin + member required", ephemeral=True)
            return
        if member.id == int(ticket["owner_id"]):
            await interaction.response.send_message("Cannot remove owner", ephemeral=True)
            return
        await interaction.channel.set_permissions(member, overwrite=None)
        await interaction.response.send_message(f"➖ Removed {member.mention}", ephemeral=True)
        return

    if act == "rename":
        if not name:
            await interaction.response.send_message("rename يحتاج name", ephemeral=True)
            return
        new_name = sanitize_channel_name(name)
        await interaction.channel.edit(name=new_name)
        await interaction.response.send_message(f"✏️ renamed to `{new_name}`", ephemeral=True)
        return

    if act == "delete":
        if not can_moderate(interaction.user, config):
            await interaction.response.send_message("Only support/admin can delete", ephemeral=True)
            return
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await send_log(guild, config, {
            "title": "Ticket Deleted",
            "description": "Ticket deleted",
            "user": guild.get_member(int(ticket["owner_id"])),
            "moderator": interaction.user,
            "channel": interaction.channel,
            "ticket_number": int(ticket["ticket_number"]),
            "guild_name": guild.name,
        }, transcript)
        del config["open_tickets"][str(interaction.channel.id)]
        save_state(state)
        await interaction.response.send_message("🗑 deleting ticket", ephemeral=True)
        await interaction.channel.delete(reason="Ticket deleted")
        return


@client.event
async def on_interaction(interaction: discord.Interaction) -> None:
    if interaction.type != discord.InteractionType.component:
        return
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return

    custom_id = interaction.data.get("custom_id") if interaction.data else None
    if not custom_id:
        return

    guild = interaction.guild
    config = get_guild_config(state, guild.id)

    if custom_id == "ticket_open":
        required = (config["setup"]["panel_channel_id"], config["setup"]["ticket_category_id"], config["setup"]["logs_channel_id"])
        if not all(required):
            await interaction.response.send_message("System not configured. Run setup first.", ephemeral=True)
            return

        last_open = open_rate_limit.get(interaction.user.id, 0)
        if time.time() - last_open < 7:
            await interaction.response.send_message("Wait 7 seconds before opening another ticket.", ephemeral=True)
            return

        if count_open_tickets(config, interaction.user.id) >= int(config["setup"]["ticket_limit"]):
            await interaction.response.send_message("Ticket limit reached.", ephemeral=True)
            return

        open_rate_limit[interaction.user.id] = time.time()
        channel = await create_ticket_channel(guild, interaction.user, config)
        await interaction.response.send_message(f"✅ ticket created: {channel.mention}", ephemeral=True)
        await send_log(guild, config, {
            "title": "Ticket Opened",
            "description": "New ticket opened",
            "user": interaction.user,
            "moderator": None,
            "channel": channel,
            "ticket_number": int(config["ticket_counter"]),
            "guild_name": guild.name,
        })
        return

    if not isinstance(interaction.channel, discord.TextChannel):
        await interaction.response.send_message("Invalid channel", ephemeral=True)
        return

    ticket = find_ticket_by_channel(config, interaction.channel.id)
    if not ticket:
        await interaction.response.send_message("Not a ticket channel", ephemeral=True)
        return

    if not can_access(interaction.user, ticket, config):
        await interaction.response.send_message("Not allowed", ephemeral=True)
        return

    if custom_id == "ticket_claim":
        if not can_moderate(interaction.user, config):
            await interaction.response.send_message("Only support/admin", ephemeral=True)
            return
        ticket["claimed_by"] = str(interaction.user.id)
        save_state(state)
        await interaction.response.send_message(f"👤 {interaction.user.mention} claimed ticket")
        return

    if custom_id == "ticket_close":
        ticket["closed"] = True
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner:
            await interaction.channel.set_permissions(owner, send_messages=False, view_channel=True)
        save_state(state)
        await interaction.response.send_message("🔒 ticket closed", ephemeral=True)
        return

    if custom_id == "ticket_reopen":
        ticket["closed"] = False
        owner = guild.get_member(int(ticket["owner_id"]))
        if owner:
            await interaction.channel.set_permissions(owner, send_messages=True, view_channel=True)
        save_state(state)
        await interaction.response.send_message("🔁 ticket reopened", ephemeral=True)
        return

    if custom_id == "ticket_transcript":
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await send_log(guild, config, {
            "title": "Ticket Transcript",
            "description": "Transcript generated",
            "user": guild.get_member(int(ticket["owner_id"])),
            "moderator": interaction.user,
            "channel": interaction.channel,
            "ticket_number": int(ticket["ticket_number"]),
            "guild_name": guild.name,
        }, transcript)
        await interaction.response.send_message("📁 transcript sent", ephemeral=True)
        return

    if custom_id == "ticket_delete":
        if not can_moderate(interaction.user, config):
            await interaction.response.send_message("Only support/admin", ephemeral=True)
            return
        transcript = await create_ticket_transcript(interaction.channel, int(ticket["ticket_number"]))
        await send_log(guild, config, {
            "title": "Ticket Deleted",
            "description": "Ticket deleted",
            "user": guild.get_member(int(ticket["owner_id"])),
            "moderator": interaction.user,
            "channel": interaction.channel,
            "ticket_number": int(ticket["ticket_number"]),
            "guild_name": guild.name,
        }, transcript)
        del config["open_tickets"][str(interaction.channel.id)]
        save_state(state)
        await interaction.response.send_message("🗑 deleting ticket", ephemeral=True)
        await interaction.channel.delete(reason="Ticket deleted")


@client.event
async def on_guild_channel_delete(channel: discord.abc.GuildChannel) -> None:
    if not isinstance(channel, discord.TextChannel) or not channel.guild:
        return
    config = get_guild_config(state, channel.guild.id)
    if str(channel.id) in config["open_tickets"]:
        del config["open_tickets"][str(channel.id)]
        save_state(state)


def main() -> None:
    client.run(TOKEN)


if __name__ == "__main__":
    main()
