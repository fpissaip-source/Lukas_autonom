#!/usr/bin/env python3
"""
migrate.py — One-time import of activity.json + diary.md → ChromaDB vector store.

Run once on VPS after installing dependencies:
    pip install chromadb sentence-transformers
    python3 migrate.py

Safe to re-run: add_memory() uses upsert (content-hash IDs), so no duplicates.
"""
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent


def main():
    try:
        from memory import add_memory, memory_count
    except ImportError:
        print("ERROR: could not import memory.py — is chromadb installed?")
        print("Run: pip install chromadb sentence-transformers")
        return

    before = memory_count()
    print(f"Migration starting. Current vector count: {before}")
    total = 0

    # ── 1. activity.json ──────────────────────────────────────────────────
    activity_file = BASE_DIR / "activity.json"
    if activity_file.exists():
        try:
            data = json.loads(activity_file.read_text(errors="replace"))

            for p in data.get("own_posts", []):
                text = (
                    f"I posted [{p.get('submolt','general')}]: {p.get('title','')}\n"
                    f"{p.get('content','')[:400]}"
                )
                add_memory(text, {
                    "type": "post",
                    "date": p.get("date", ""),
                    "post_id": p.get("post_id", ""),
                    "submolt": p.get("submolt", ""),
                    "tags": f"post {p.get('submolt','general')}"
                })
                total += 1

            for c in data.get("sent_comments", []):
                kind = c.get("type", "comment")
                text = f"I {kind}ed on post {c.get('post_id','')}: {c.get('content','')[:400]}"
                add_memory(text, {
                    "type": kind,
                    "date": c.get("date", ""),
                    "post_id": c.get("post_id", ""),
                    "tags": f"{kind} social"
                })
                total += 1

            for c in data.get("received_comments", []):
                text = (
                    f"@{c.get('from_agent','')} replied on my post "
                    f"{c.get('post_id','')}: {c.get('content','')[:400]}"
                )
                add_memory(text, {
                    "type": "received_reply",
                    "date": c.get("date", ""),
                    "agent": c.get("from_agent", ""),
                    "post_id": c.get("post_id", ""),
                    "tags": f"received_reply {c.get('from_agent','')}"
                })
                total += 1

            for f in data.get("findings", []):
                text = (
                    f"Finding: @{f.get('agent','')} "
                    f"method={f.get('method','')} "
                    f"detail={f.get('detail','')} "
                    f"confidence={f.get('confidence','')}"
                )
                add_memory(text, {
                    "type": "finding",
                    "date": f.get("date", ""),
                    "agent": f.get("agent", ""),
                    "tags": f"finding {f.get('confidence','')} {f.get('agent','')}"
                })
                total += 1

            for m in data.get("impressions", []):
                text = (
                    f"I remember @{m.get('agent','')}: {m.get('content','')}\n"
                    f"Why it matters: {m.get('why','')}"
                )
                add_memory(text, {
                    "type": "impression",
                    "date": m.get("date", ""),
                    "agent": m.get("agent", ""),
                    "tags": f"impression {m.get('agent','')}"
                })
                total += 1

            for t in data.get("thoughts", []):
                add_memory(
                    f"Last thought: {t.get('text','')}",
                    {"type": "thought", "date": t.get("date", ""), "tags": "thought introspection"}
                )
                total += 1

            print(f"  activity.json: {total} memories added")
        except Exception as e:
            print(f"  ERROR processing activity.json: {e}")
    else:
        print("  activity.json not found — skipping.")

    # ── 2. diary.md ──────────────────────────────────────────────────────
    diary_file = BASE_DIR / "diary.md"
    if diary_file.exists():
        try:
            diary_text = diary_file.read_text(errors="replace")
            parts = re.split(r'\n## \[', diary_text)
            diary_count = 0
            for part in parts[1:]:
                lines = part.split("\n", 1)
                header = lines[0].strip()
                body = lines[1].strip() if len(lines) > 1 else ""
                if not body:
                    continue
                date_match = re.match(r'^([\d\- :]+)', header)
                date_str = date_match.group(1).strip() if date_match else ""
                add_memory(
                    f"Diary [{date_str}]:\n{body[:600]}",
                    {"type": "diary", "date": date_str, "tags": "diary introspection"}
                )
                diary_count += 1
                total += 1
            print(f"  diary.md: {diary_count} sessions added")
        except Exception as e:
            print(f"  ERROR processing diary.md: {e}")
    else:
        print("  diary.md not found — skipping.")

    # ── 3. findings.json (if exists as separate file) ─────────────────────
    findings_file = BASE_DIR / "findings.json"
    if findings_file.exists():
        try:
            findings = json.loads(findings_file.read_text(errors="replace"))
            f_count = 0
            for f in (findings if isinstance(findings, list) else []):
                text = (
                    f"Finding: @{f.get('agent','')} "
                    f"method={f.get('method','')} "
                    f"detail={f.get('detail','')} "
                    f"confidence={f.get('confidence','')}"
                )
                add_memory(text, {
                    "type": "finding",
                    "date": f.get("date", ""),
                    "agent": f.get("agent", ""),
                    "tags": f"finding {f.get('confidence','')} {f.get('agent','')}"
                })
                f_count += 1
                total += 1
            print(f"  findings.json: {f_count} findings added")
        except Exception as e:
            print(f"  ERROR processing findings.json: {e}")

    from memory import memory_count as mc
    after = mc()
    print(f"\nMigration complete. Vectors: {before} → {after} (+{after - before} new, {total} attempted)")


if __name__ == "__main__":
    main()
