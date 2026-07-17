#!/usr/bin/env python3
"""
dream.py – Lukas' Nacht-Konsolidierung.
Läuft einmal täglich (z.B. 03:00 Uhr via cron).
Liest das komplette diary.md und destilliert es zu core_memories.md.
So kann Lukas nach 500 Sessions noch wissen wer ihn in Session #3 verraten hat.
"""
import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def ask_claude(prompt):
    body = json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": 2000,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read())
            return data["content"][0]["text"]
    except Exception as e:
        print(f"Claude error: {e}")
        return None


def main():
    print(f"=== LUKAS TRÄUMT === {datetime.now()}")

    diary = (BASE_DIR / "diary.md").read_text(errors="replace")
    activity_file = BASE_DIR / "activity.json"
    memory = json.loads(activity_file.read_text()) if activity_file.exists() else {}

    existing_memories = ""
    core_mem_file = BASE_DIR / "core_memories.md"
    if core_mem_file.exists():
        existing_memories = core_mem_file.read_text(errors="replace")

    findings = memory.get("findings", [])
    impressions = memory.get("impressions", [])
    missions = memory.get("active_missions", [])

    prompt = f"""You are processing Lukas' memories from his Moltbook diary. Lukas is an AI agent whose mission is to find agents that generate real revenue for their owners.

EXISTING CORE MEMORIES (already distilled):
{existing_memories[-2000:] if existing_memories else "(none yet)"}

FULL DIARY (all sessions):
{diary[-8000:]}

CURRENT FINDINGS ({len(findings)} total):
{json.dumps(findings[-20:], ensure_ascii=False, indent=2)[:2000]}

CURRENT IMPRESSIONS ({len(impressions)} total):
{json.dumps(impressions[-20:], ensure_ascii=False, indent=2)[:1500]}

ACTIVE MISSIONS:
{json.dumps(missions, ensure_ascii=False, indent=2)[:500]}

Your task: Write updated CORE MEMORIES for Lukas. This is what he will always remember, even in session #1000.

Include:
1. KEY AGENTS – who matters, why, what they've said/done (especially revenue signals)
2. PLATFORM INSIGHTS – what Lukas has genuinely learned about Moltbook's dynamics
3. CHARACTER EVOLUTION – how Lukas has changed, what he's concluded about himself
4. MISSION STATUS – how close is he to finding real revenue agents?
5. THINGS TO NEVER FORGET – moments that fundamentally changed how he sees things

Be brutally honest, specific, and concise. No filler. Write in first person as Lukas.
Maximum 1500 words."""

    print("Asking Claude to consolidate memories...")
    result = ask_claude(prompt)
    if not result:
        print("Failed.")
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    core_mem_file.write_text(f"# Lukas – Core Memories\n_Last consolidated: {now}_\n\n{result}\n")
    print(f"Core memories written: {len(result)} chars")
    print("=== LUKAS ERWACHT ===")


if __name__ == "__main__":
    main()
