from __future__ import annotations

import discord
from discord import app_commands


def build_ticket_group() -> app_commands.Group:
    return app_commands.Group(name="ticket", description="Advanced ticket management")


def register_ticket_commands(group: app_commands.Group, handlers: object) -> None:
    # Setup core
    @group.command(name="setup", description="Setup panel/category/logs")
    async def setup(interaction: discord.Interaction, panel_channel: discord.TextChannel, category: discord.CategoryChannel, logs_channel: discord.TextChannel) -> None:
        await handlers.cmd_setup(interaction, panel_channel, category, logs_channel)

    @group.command(name="set_panel", description="Set panel channel")
    async def set_panel(interaction: discord.Interaction, panel_channel: discord.TextChannel) -> None:
        await handlers.cmd_set_panel(interaction, panel_channel)

    @group.command(name="set_category", description="Set ticket category")
    async def set_category(interaction: discord.Interaction, category: discord.CategoryChannel) -> None:
        await handlers.cmd_set_category(interaction, category)

    @group.command(name="set_logs", description="Set logs channel")
    async def set_logs(interaction: discord.Interaction, logs_channel: discord.TextChannel) -> None:
        await handlers.cmd_set_logs(interaction, logs_channel)

    @group.command(name="message", description="Send ticket panel message")
    async def message(interaction: discord.Interaction) -> None:
        await handlers.cmd_message(interaction)

    @group.command(name="settings", description="Show ticket settings")
    async def settings(interaction: discord.Interaction) -> None:
        await handlers.cmd_settings(interaction)

    # Customization
    @group.command(name="set_prefix", description="Set ticket channel prefix")
    async def set_prefix(interaction: discord.Interaction, prefix: str) -> None:
        await handlers.cmd_set_prefix(interaction, prefix)

    @group.command(name="set_welcome", description="Set ticket welcome message")
    async def set_welcome(interaction: discord.Interaction, message: str) -> None:
        await handlers.cmd_set_welcome(interaction, message)

    @group.command(name="set_cooldown", description="Set open-ticket cooldown seconds")
    async def set_cooldown(interaction: discord.Interaction, seconds: app_commands.Range[int, 3, 60]) -> None:
        await handlers.cmd_set_cooldown(interaction, int(seconds))

    @group.command(name="set_autoclose", description="Set auto-close in hours (0 disable)")
    async def set_autoclose(interaction: discord.Interaction, hours: app_commands.Range[int, 0, 168]) -> None:
        await handlers.cmd_set_autoclose(interaction, int(hours))

    @group.command(name="set_transcript_on_close", description="Enable/disable auto transcript when closing")
    async def set_transcript_on_close(interaction: discord.Interaction, enabled: bool) -> None:
        await handlers.cmd_set_transcript_on_close(interaction, enabled)

    @group.command(name="set_claim_required", description="Require claim before close/delete")
    async def set_claim_required(interaction: discord.Interaction, enabled: bool) -> None:
        await handlers.cmd_set_claim_required(interaction, enabled)

    # Staff
    @group.command(name="staff_add", description="Add support role")
    async def staff_add(interaction: discord.Interaction, role: discord.Role) -> None:
        await handlers.cmd_staff_add(interaction, role)

    @group.command(name="staff_remove", description="Remove support role")
    async def staff_remove(interaction: discord.Interaction, role: discord.Role) -> None:
        await handlers.cmd_staff_remove(interaction, role)

    @group.command(name="staff_list", description="List support roles")
    async def staff_list(interaction: discord.Interaction) -> None:
        await handlers.cmd_staff_list(interaction)

    @group.command(name="limit", description="Set max open tickets per user")
    async def limit(interaction: discord.Interaction, value: app_commands.Range[int, 1, 5]) -> None:
        await handlers.cmd_limit(interaction, int(value))

    # Ticket actions
    @group.command(name="claim", description="Claim this ticket")
    async def claim(interaction: discord.Interaction) -> None:
        await handlers.cmd_claim(interaction)

    @group.command(name="unclaim", description="Unclaim this ticket")
    async def unclaim(interaction: discord.Interaction) -> None:
        await handlers.cmd_unclaim(interaction)

    @group.command(name="close", description="Close this ticket")
    async def close(interaction: discord.Interaction, reason: str | None = None) -> None:
        await handlers.cmd_close(interaction, reason)

    @group.command(name="reopen", description="Reopen this ticket")
    async def reopen(interaction: discord.Interaction) -> None:
        await handlers.cmd_reopen(interaction)

    @group.command(name="delete", description="Delete this ticket")
    async def delete(interaction: discord.Interaction) -> None:
        await handlers.cmd_delete(interaction)

    @group.command(name="transcript", description="Generate transcript")
    async def transcript(interaction: discord.Interaction) -> None:
        await handlers.cmd_transcript(interaction)

    @group.command(name="add", description="Add member to ticket")
    async def add(interaction: discord.Interaction, member: discord.Member) -> None:
        await handlers.cmd_add(interaction, member)

    @group.command(name="remove", description="Remove member from ticket")
    async def remove(interaction: discord.Interaction, member: discord.Member) -> None:
        await handlers.cmd_remove(interaction, member)

    @group.command(name="rename", description="Rename ticket")
    async def rename(interaction: discord.Interaction, name: str) -> None:
        await handlers.cmd_rename(interaction, name)

    @group.command(name="move", description="Move ticket to category")
    async def move(interaction: discord.Interaction, category: discord.CategoryChannel) -> None:
        await handlers.cmd_move(interaction, category)

    @group.command(name="priority", description="Set ticket priority")
    async def priority(interaction: discord.Interaction, level: str) -> None:
        await handlers.cmd_priority(interaction, level)

    @group.command(name="stats", description="Show ticket stats")
    async def stats(interaction: discord.Interaction) -> None:
        await handlers.cmd_stats(interaction)

    @group.command(name="info", description="Show ticket info")
    async def info(interaction: discord.Interaction) -> None:
        await handlers.cmd_info(interaction)

    @priority.autocomplete("level")
    async def _priority_autocomplete(_interaction: discord.Interaction, current: str):
        values = ["low", "medium", "high", "urgent"]
        return [app_commands.Choice(name=x, value=x) for x in values if x.startswith(current.lower())][:25]
