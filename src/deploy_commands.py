from __future__ import annotations

import os

import discord
from discord import app_commands
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
CLIENT_ID = os.getenv("CLIENT_ID")
GUILD_ID = os.getenv("GUILD_ID")

if not TOKEN or not CLIENT_ID:
    raise RuntimeError("DISCORD_TOKEN and CLIENT_ID are required in .env")


class DeployClient(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.none())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        @self.tree.command(name="ticket", description="Ticket management")
        @app_commands.describe(action="ticket action")
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
        async def ticket(interaction: discord.Interaction, action: app_commands.Choice[str]) -> None:  # pragma: no cover
            await interaction.response.send_message(f"Action: {action.value}", ephemeral=True)

        if GUILD_ID:
            guild_obj = discord.Object(id=int(GUILD_ID))
            self.tree.copy_global_to(guild=guild_obj)
            synced = await self.tree.sync(guild=guild_obj)
            print(f"Synced {len(synced)} guild commands.")
        else:
            synced = await self.tree.sync()
            print(f"Synced {len(synced)} global commands.")

        await self.close()


def main() -> None:
    client = DeployClient()
    client.run(TOKEN)


if __name__ == "__main__":
    main()
