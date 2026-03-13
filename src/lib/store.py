from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

DATA_PATH = Path("data.json")


def _default_guild_state() -> Dict[str, Any]:
    return {
        "setup": {
            "panel_channel_id": None,
            "ticket_category_id": None,
            "logs_channel_id": None,
            "support_role_ids": [],
            "ticket_limit": 1,
            "ticket_prefix": "ticket",
            "open_cooldown_seconds": 7,
            "welcome_message": "Support team will assist you shortly.",
            "auto_close_hours": 0,
            "transcript_on_close": True,
            "claim_required": False,
        },
        "ticket_counter": 0,
        "open_tickets": {},
    }


def _default_state() -> Dict[str, Any]:
    return {"guilds": {}}


def _ensure_file() -> None:
    if not DATA_PATH.exists():
        DATA_PATH.write_text(json.dumps(_default_state(), indent=2), encoding="utf-8")


def _normalize_guild(raw_guild: Dict[str, Any] | None) -> Dict[str, Any]:
    raw_guild = raw_guild or {}
    setup = raw_guild.get("setup") or {}
    base = _default_guild_state()["setup"]

    ticket_limit = setup.get("ticket_limit", 1)
    cooldown = setup.get("open_cooldown_seconds", 7)
    auto_close_hours = setup.get("auto_close_hours", 0)
    transcript_on_close = setup.get("transcript_on_close", True)
    claim_required = setup.get("claim_required", False)

    return {
        "setup": {
            "panel_channel_id": setup.get("panel_channel_id", base["panel_channel_id"]),
            "ticket_category_id": setup.get("ticket_category_id", base["ticket_category_id"]),
            "logs_channel_id": setup.get("logs_channel_id", base["logs_channel_id"]),
            "support_role_ids": list(dict.fromkeys(setup.get("support_role_ids", []))),
            "ticket_limit": ticket_limit if isinstance(ticket_limit, int) and ticket_limit > 0 else 1,
            "ticket_prefix": setup.get("ticket_prefix", "ticket") or "ticket",
            "open_cooldown_seconds": cooldown if isinstance(cooldown, int) and cooldown >= 3 else 7,
            "welcome_message": (setup.get("welcome_message") or base["welcome_message"])[:1200],
            "auto_close_hours": auto_close_hours if isinstance(auto_close_hours, int) and auto_close_hours >= 0 else 0,
            "transcript_on_close": bool(transcript_on_close),
            "claim_required": bool(claim_required),
        },
        "ticket_counter": raw_guild.get("ticket_counter", 0)
        if isinstance(raw_guild.get("ticket_counter", 0), int) and raw_guild.get("ticket_counter", 0) >= 0
        else 0,
        "open_tickets": raw_guild.get("open_tickets", {}) if isinstance(raw_guild.get("open_tickets", {}), dict) else {},
    }


def load_state() -> Dict[str, Any]:
    _ensure_file()
    try:
        payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        guilds = payload.get("guilds", {}) if isinstance(payload.get("guilds", {}), dict) else {}
        normalized = {"guilds": {}}
        for guild_id, guild_data in guilds.items():
            normalized["guilds"][str(guild_id)] = _normalize_guild(guild_data)
        return normalized
    except Exception:
        fallback = _default_state()
        DATA_PATH.write_text(json.dumps(fallback, indent=2), encoding="utf-8")
        return fallback


def save_state(state: Dict[str, Any]) -> None:
    DATA_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def get_guild_config(state: Dict[str, Any], guild_id: int) -> Dict[str, Any]:
    key = str(guild_id)
    if key not in state["guilds"]:
        state["guilds"][key] = _default_guild_state()
    return state["guilds"][key]
