from __future__ import annotations

import discord
from discord import app_commands


def build_ticket_group() -> app_commands.Group:
    return app_commands.Group(name="ticket", description="Advanced ticket management")


def register_ticket_commands(group: app_commands.Group, handlers: object) -> None:
    @group.command(name="setup", description="Setup panel/category/logs")
    @app_commands.describe(panel_channel="Channel for open-ticket panel", category="Category for ticket channels", logs_channel="Channel for ticket logs")
    async def setup(
        interaction: discord.Interaction,
        panel_channel: discord.TextChannel,
        category: discord.CategoryChannel,
        logs_channel: discord.TextChannel,
    ) -> None:
        await handlers.cmd_setup(interaction, panel_channel, category, logs_channel)

    @group.command(name="message", description="Send ticket panel message")
    async def message(interaction: discord.Interaction) -> None:
        await handlers.cmd_message(interaction)

    @group.command(name="settings", description="Show current ticket settings")
    async def settings(interaction: discord.Interaction) -> None:
        await handlers.cmd_settings(interaction)

    @group.command(name="set_prefix", description="Set ticket channel name prefix")
    async def set_prefix(interaction: discord.Interaction, prefix: str) -> None:
        await handlers.cmd_set_prefix(interaction, prefix)

    @group.command(name="set_welcome", description="Set welcome message inside each ticket")
    async def set_welcome(interaction: discord.Interaction, message: str) -> None:
        await handlers.cmd_set_welcome(interaction, message)

    @group.command(name="set_cooldown", description="Set open-ticket cooldown (seconds)")
    async def set_cooldown(interaction: discord.Interaction, seconds: app_commands.Range[int, 3, 60]) -> None:
        await handlers.cmd_set_cooldown(interaction, int(seconds))

    @group.command(name="set_autoclose", description="Auto-close tickets after X hours (0 disables)")
    async def set_autoclose(interaction: discord.Interaction, hours: app_commands.Range[int, 0, 168]) -> None:
        await handlers.cmd_set_autoclose(interaction, int(hours))

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

    @group.command(name="claim", description="Claim this ticket")
    async def claim(interaction: discord.Interaction) -> None:
        await handlers.cmd_claim(interaction)

    @group.command(name="unclaim", description="Remove claim from this ticket")
    async def unclaim(interaction: discord.Interaction) -> None:
        await handlers.cmd_unclaim(interaction)

    @group.command(name="close", description="Close this ticket")
    @app_commands.describe(reason="Reason for closing (optional)")
    async def close(interaction: discord.Interaction, reason: str | None = None) -> None:
        await handlers.cmd_close(interaction, reason)

    @group.command(name="reopen", description="Reopen this ticket")
    async def reopen(interaction: discord.Interaction) -> None:
        await handlers.cmd_reopen(interaction)

    @group.command(name="delete", description="Delete this ticket")
    async def delete(interaction: discord.Interaction) -> None:
        await handlers.cmd_delete(interaction)

    @group.command(name="transcript", description="Generate transcript for this ticket")
    async def transcript(interaction: discord.Interaction) -> None:
        await handlers.cmd_transcript(interaction)

    @group.command(name="add", description="Add member to ticket")
    async def add(interaction: discord.Interaction, member: discord.Member) -> None:
        await handlers.cmd_add(interaction, member)

    @group.command(name="remove", description="Remove member from ticket")
    async def remove(interaction: discord.Interaction, member: discord.Member) -> None:
        await handlers.cmd_remove(interaction, member)

    @group.command(name="rename", description="Rename ticket channel")
    async def rename(interaction: discord.Interaction, name: str) -> None:
        await handlers.cmd_rename(interaction, name)

    @group.command(name="move", description="Move ticket to another category")
    async def move(interaction: discord.Interaction, category: discord.CategoryChannel) -> None:
        await handlers.cmd_move(interaction, category)

    @group.command(name="priority", description="Set ticket priority")
    async def priority(interaction: discord.Interaction, level: str) -> None:
        await handlers.cmd_priority(interaction, level)

    @group.command(name="stats", description="Show ticket stats for this server")
    async def stats(interaction: discord.Interaction) -> None:
        await handlers.cmd_stats(interaction)

    @group.command(name="info", description="Show current ticket info")
    async def info(interaction: discord.Interaction) -> None:
        await handlers.cmd_info(interaction)

    priority.autocomplete("level")(
        lambda _interaction, current: [
            app_commands.Choice(name=x, value=x)
            for x in ["low", "medium", "high", "urgent"]
            if x.startswith(current.lower())
        ][:25]
    )
