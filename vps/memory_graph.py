#!/usr/bin/env python3
"""memory_graph.py — Lukas' persistentes Gedächtnis als Knowledge Graph.

Nodes = Fakten, Erkenntnisse, Erinnerungen
Edges = Verbindungen zwischen Nodes (Kontext)

Lukas kann:
- remember(): Neuen Fakt speichern + automatisch verknüpfen
- recall(): Nach Erinnerungen suchen (Keyword, Kategorie)
- get_context(): Kompakten Kontext-Snapshot für Gespräche laden
- connect(): Zwei Nodes manuell verbinden
"""
import json
import uuid
import re
from datetime import datetime
from pathlib import Path

MEMORY_FILE = Path(__file__).parent / "memory_graph.json"

CATEGORIES = [
    "personal", "goal", "preference", "project", "finance",
    "decision", "event", "person", "idea", "health",
    "learning", "trading", "gaming", "work", "insight"
]


def _load() -> dict:
    if MEMORY_FILE.exists():
        try:
            return json.loads(MEMORY_FILE.read_text())
        except Exception:
            pass
    return {"nodes": [], "edges": [], "owner_profile": {}}


def _save(data: dict):
    MEMORY_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def _find_related(data: dict, content: str, category: str, top_n: int = 5) -> list[str]:
    words = set(re.findall(r'\w{3,}', content.lower()))
    if not words:
        return []
    scored = []
    for node in data["nodes"]:
        node_words = set(re.findall(r'\w{3,}', node["content"].lower()))
        node_words.update(re.findall(r'\w{3,}', " ".join(node.get("tags", [])).lower()))
        overlap = len(words & node_words)
        if node["category"] == category:
            overlap += 2
        if overlap > 0:
            scored.append((overlap, node["id"]))
    scored.sort(reverse=True)
    return [nid for _, nid in scored[:top_n]]


def remember(content: str, category: str = "insight", tags: list[str] | None = None,
             importance: int = 5, auto_connect: bool = True) -> str:
    if category not in CATEGORIES:
        category = "insight"
    importance = max(1, min(10, importance))

    data = _load()
    node_id = str(uuid.uuid4())[:8]

    node = {
        "id": node_id,
        "content": content,
        "category": category,
        "tags": tags or [],
        "importance": importance,
        "created": datetime.now().isoformat(),
        "updated": datetime.now().isoformat(),
        "access_count": 0
    }
    data["nodes"].append(node)

    connected_to = []
    if auto_connect:
        related_ids = _find_related(data, content, category)
        for rid in related_ids:
            if rid != node_id:
                data["edges"].append({
                    "from": node_id,
                    "to": rid,
                    "relation": "related_to",
                    "created": datetime.now().isoformat()
                })
                connected_to.append(rid)

    _save(data)
    conn_str = f", connected to {len(connected_to)} nodes" if connected_to else ""
    return f"Remembered [{category}] (id: {node_id}, importance: {importance}{conn_str}): {content[:100]}"


def recall(query: str = "", category: str = "", limit: int = 10) -> str:
    data = _load()
    nodes = data["nodes"]

    if category:
        nodes = [n for n in nodes if n["category"] == category]

    if query:
        query_words = set(re.findall(r'\w{3,}', query.lower()))
        scored = []
        for n in nodes:
            text = f"{n['content']} {' '.join(n.get('tags', []))} {n['category']}"
            node_words = set(re.findall(r'\w{3,}', text.lower()))
            overlap = len(query_words & node_words)
            if overlap > 0:
                score = overlap * 10 + n.get("importance", 5)
                scored.append((score, n))
        scored.sort(reverse=True)
        nodes = [n for _, n in scored[:limit]]
    else:
        nodes = sorted(nodes, key=lambda n: n.get("importance", 5), reverse=True)[:limit]

    if not nodes:
        return f"No memories found for query='{query}' category='{category}'"

    for n in nodes:
        n["access_count"] = n.get("access_count", 0) + 1
    _save(data)

    parts = [f"Found {len(nodes)} memories:"]
    for n in nodes:
        connections = [e for e in data["edges"] if e["from"] == n["id"] or e["to"] == n["id"]]
        conn_info = f" ({len(connections)} connections)" if connections else ""
        parts.append(
            f"  [{n['category']}] (id:{n['id']}, imp:{n.get('importance',5)}{conn_info}) "
            f"{n['content'][:200]}"
        )
    return "\n".join(parts)


def connect(node_id_1: str, node_id_2: str, relation: str = "related_to") -> str:
    data = _load()
    ids = {n["id"] for n in data["nodes"]}
    if node_id_1 not in ids:
        return f"Node {node_id_1} not found"
    if node_id_2 not in ids:
        return f"Node {node_id_2} not found"

    for e in data["edges"]:
        if (e["from"] == node_id_1 and e["to"] == node_id_2) or \
           (e["from"] == node_id_2 and e["to"] == node_id_1):
            return f"Already connected: {node_id_1} <-> {node_id_2}"

    data["edges"].append({
        "from": node_id_1,
        "to": node_id_2,
        "relation": relation,
        "created": datetime.now().isoformat()
    })
    _save(data)
    return f"Connected {node_id_1} <-> {node_id_2} ({relation})"


def get_context(max_nodes: int = 15) -> str:
    data = _load()
    if not data["nodes"]:
        return "Memory is empty."

    profile = data.get("owner_profile", {})
    parts = []

    if profile:
        parts.append("OWNER PROFILE:")
        for key, val in profile.items():
            if isinstance(val, list):
                parts.append(f"  {key}: {', '.join(str(v) for v in val)}")
            else:
                parts.append(f"  {key}: {val}")

    important = sorted(data["nodes"], key=lambda n: n.get("importance", 5), reverse=True)[:max_nodes]
    if important:
        parts.append(f"\nKEY MEMORIES ({len(important)}/{len(data['nodes'])} total):")
        for n in important:
            parts.append(f"  [{n['category']}] {n['content'][:150]}")

    recent = sorted(data["nodes"], key=lambda n: n.get("updated", ""), reverse=True)[:5]
    recent_ids = {n["id"] for n in recent} - {n["id"] for n in important}
    if recent_ids:
        parts.append("\nRECENT:")
        for n in recent:
            if n["id"] in recent_ids:
                parts.append(f"  [{n['category']}] {n['content'][:150]}")

    parts.append(f"\nGraph: {len(data['nodes'])} nodes, {len(data['edges'])} connections")
    return "\n".join(parts)


def get_full_graph() -> str:
    data = _load()
    parts = [f"KNOWLEDGE GRAPH — {len(data['nodes'])} nodes, {len(data['edges'])} edges\n"]

    by_cat = {}
    for n in data["nodes"]:
        by_cat.setdefault(n["category"], []).append(n)

    for cat in sorted(by_cat.keys()):
        nodes = by_cat[cat]
        parts.append(f"=== {cat.upper()} ({len(nodes)}) ===")
        for n in sorted(nodes, key=lambda x: x.get("importance", 5), reverse=True):
            conns = [e for e in data["edges"] if e["from"] == n["id"] or e["to"] == n["id"]]
            conn_targets = []
            for e in conns[:3]:
                other = e["to"] if e["from"] == n["id"] else e["from"]
                target_node = next((x for x in data["nodes"] if x["id"] == other), None)
                if target_node:
                    conn_targets.append(f"{target_node['content'][:40]}...")
            conn_str = f" -> [{', '.join(conn_targets)}]" if conn_targets else ""
            parts.append(f"  [{n['id']}] (imp:{n.get('importance',5)}) {n['content'][:120]}{conn_str}")
        parts.append("")

    return "\n".join(parts)


def update_owner_profile(key: str, value) -> str:
    data = _load()
    data.setdefault("owner_profile", {})[key] = value
    _save(data)
    return f"Owner profile updated: {key} = {str(value)[:100]}"


def auto_extract_and_save(conversation_text: str) -> int:
    keywords = {
        "personal": ["ich bin", "ich heiße", "mein name", "ich komme aus", "ich mag", "ich hasse",
                      "meine familie", "mein bruder", "meine schwester", "mein vater", "meine mutter"],
        "goal": ["ich will", "mein ziel", "ich möchte", "ich plane", "ich brauche"],
        "finance": ["schulden", "kredit", "rate", "inkasso", "geld", "verdien", "invest", "aktie",
                     "trading", "portfolio", "polymarket", "btc", "bitcoin"],
        "health": ["training", "gym", "kg", "gewicht", "entzug", "gesundheit", "fitness"],
        "project": ["projekt", "app", "website", "business", "tiktok", "studyforge", "dailyraphood"],
        "decision": ["ich habe entschieden", "ab jetzt", "ich höre auf", "ich fange an"],
        "preference": ["ich bevorzuge", "am liebsten", "mein lieblings", "ich finde gut"],
        "work": ["ausbildung", "arbeit", "job", "prüfung", "klausur", "ihk"],
    }

    saved = 0
    lines = conversation_text.split("\n")
    for line in lines:
        lower = line.lower().strip()
        if len(lower) < 10:
            continue
        for cat, triggers in keywords.items():
            if any(t in lower for t in triggers):
                remember(line.strip(), category=cat, importance=6, auto_connect=True)
                saved += 1
                break

    return saved
