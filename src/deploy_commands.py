from __future__ import annotations

import os

import discord
from dotenv import load_dotenv

from lib.commands_py import build_ticket_group, register_ticket_commands

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = os.getenv("GUILD_ID")

if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN is required in .env")


class _NoopHandlers:
    def __getattr__(self, _name):
        async def _noop(*_args, **_kwargs):
            return None

        return _noop


class DeployClient(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.none())
        self.tree = discord.app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        group = build_ticket_group()
        register_ticket_commands(group, _NoopHandlers())
        self.tree.add_command(group)

        if GUILD_ID:
            guild = discord.Object(id=int(GUILD_ID))
            synced = await self.tree.sync(guild=guild)
            print(f"Synced {len(synced)} guild command(s)")
        else:
            synced = await self.tree.sync()
            print(f"Synced {len(synced)} global command(s)")

        await self.close()


def main() -> None:
    DeployClient().run(TOKEN)


if __name__ == "__main__":
    main()
