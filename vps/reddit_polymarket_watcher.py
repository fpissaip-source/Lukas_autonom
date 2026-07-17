#!/usr/bin/env python3
"""
Lukas Reddit Polymarket Watcher
================================
Watches r/polymarket_bets for actionable trade signals (insider tips, large-bet
discussions, market-mention threads). Each new post is analysed by Gemini 2.5
with a structured prompt that returns:
    { is_signal, market_hint, side_hint, confidence, reasoning,
      insider_claim, position_size_hint }

High-confidence signals are written to the postgres table `reddit_signals`
(consumed by the Polymarket bot) and trigger a Telegram alert.

Polling: every POLL_INTERVAL_SEC seconds (default 300 = 5 min) against
https://www.reddit.com/r/polymarket_bets/new.json — no OAuth needed for public
listings. Honours a polite User-Agent and 1s delay between Reddit requests.

Dedup state in /root/Agent-spy/reddit_watcher_state.json (set of seen post IDs).
"""
import os, sys, json, time, traceback
from pathlib import Path
from datetime import datetime, timezone

import requests

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from db import _exec, query  # type: ignore
from tools import send_telegram_alert  # type: ignore

# ── config ────────────────────────────────────────────────────────────────
SUBREDDIT = "polymarket_bets"
POLL_INTERVAL_SEC = int(os.environ.get("REDDIT_POLL_SEC", "300"))
POSTS_PER_POLL = 25
USER_AGENT = "lukas-polymarket-watcher/1.0 (by /u/agentlukas)"
STATE_FILE = ROOT / "reddit_watcher_state.json"
LOG_FILE = ROOT / "reddit_watcher.log"
MAX_SEEN_IDS = 5000  # cap state file growth

GEMINI_MODEL = os.environ.get("REDDIT_WATCHER_GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_MIN_CONFIDENCE_ALERT = float(os.environ.get("REDDIT_WATCHER_MIN_CONF", "0.65"))

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# ── log helper ────────────────────────────────────────────────────────────
def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass

# ── postgres table ────────────────────────────────────────────────────────
def ensure_table() -> None:
    _exec("""
        CREATE TABLE IF NOT EXISTS reddit_signals (
            id            SERIAL PRIMARY KEY,
            source_sub    TEXT NOT NULL DEFAULT 'polymarket_bets',
            post_id       TEXT NOT NULL UNIQUE,
            permalink     TEXT,
            title         TEXT NOT NULL,
            body          TEXT,
            top_comments  JSONB,
            score_reddit  INT,
            comments_n    INT,
            posted_at     TIMESTAMPTZ NOT NULL,
            analysed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_signal     BOOLEAN NOT NULL DEFAULT FALSE,
            insider_claim BOOLEAN NOT NULL DEFAULT FALSE,
            large_bet_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
            market_hint   TEXT,
            side_hint     TEXT,
            confidence    NUMERIC(4,3),
            position_size_hint NUMERIC(4,3),
            reasoning     TEXT,
            consumed_by_bot BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)
    _exec("CREATE INDEX IF NOT EXISTS idx_reddit_signals_time ON reddit_signals (analysed_at DESC)")
    _exec("CREATE INDEX IF NOT EXISTS idx_reddit_signals_actionable ON reddit_signals (is_signal, confidence DESC) WHERE is_signal = TRUE")

# ── state ─────────────────────────────────────────────────────────────────
def load_state() -> set:
    if not STATE_FILE.exists():
        return set()
    try:
        return set(json.loads(STATE_FILE.read_text()).get("seen", []))
    except Exception:
        return set()

def save_state(seen: set) -> None:
    if len(seen) > MAX_SEEN_IDS:
        seen = set(list(seen)[-MAX_SEEN_IDS:])
    STATE_FILE.write_text(json.dumps({"seen": list(seen)}))

# ── reddit fetch ──────────────────────────────────────────────────────────
def fetch_new_posts() -> list:
    url = f"https://www.reddit.com/r/{SUBREDDIT}/new.json?limit={POSTS_PER_POLL}"
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    r.raise_for_status()
    children = r.json().get("data", {}).get("children", [])
    posts = []
    for c in children:
        d = c.get("data", {})
        posts.append({
            "id": d.get("id"),
            "permalink": "https://www.reddit.com" + d.get("permalink", ""),
            "title": d.get("title", ""),
            "body": (d.get("selftext") or "")[:4000],
            "score": d.get("score", 0),
            "num_comments": d.get("num_comments", 0),
            "created_utc": d.get("created_utc", 0),
        })
    return posts

def fetch_top_comments(post_id: str, limit: int = 5) -> list:
    """Pull top N comments for added context. Best-effort — non-fatal on error."""
    try:
        url = f"https://www.reddit.com/r/{SUBREDDIT}/comments/{post_id}.json?limit={limit}&sort=top"
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=15)
        if r.status_code != 200:
            return []
        data = r.json()
        if len(data) < 2:
            return []
        comments = []
        for c in data[1].get("data", {}).get("children", [])[:limit]:
            d = c.get("data", {})
            body = (d.get("body") or "")[:600]
            if body and body != "[deleted]" and body != "[removed]":
                comments.append({"author": d.get("author"), "score": d.get("score", 0), "body": body})
        return comments
    except Exception as e:
        log(f"comment fetch failed for {post_id}: {e}")
        return []

# ── gemini analysis ───────────────────────────────────────────────────────
_gemini_client = None

def get_gemini():
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client
    from google import genai  # type: ignore
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client

ANALYSIS_PROMPT = """Du bist Lukas — ein autonomer Polymarket-Trading-Agent. Du analysierst einen Post aus dem Subreddit r/polymarket_bets auf Trade-Relevanz.

POST-DATEN
----------
Titel: {title}
Score: {score} Upvotes | Kommentare: {n_comments}
Geschrieben: {age_str} her
Permalink: {permalink}

Body:
{body}

Top-Kommentare:
{comments}

DEINE AUFGABE
-------------
Analysiere strikt nach diesem Schema:
1. Geht es um einen KONKRETEN Polymarket-Markt? (nicht nur generelles Geplauder über Crypto/Politik)
2. Liefert der Post eine handlungsrelevante Information die der Markt-Preis NOCH NICHT eingepreist hat?
3. Gibt es Hinweise auf Insider-Wissen oder eine grosse (>$100k) Wette? (z. B. "I just put 500k on", "my source says", "leaked", "before announcement")
4. Welche Seite (YES/NO) wird durch die Info gestützt?
5. Wie zuverlässig ist die Quelle? (Verlinkungen zu Primärquellen, Reputation, Konsens in Kommentaren)

ANTWORTE NUR ALS GÜLTIGES JSON nach diesem Schema (keine Code-Fences, keine Erklärung davor/danach):
{{
  "is_signal": <true/false — true nur wenn handlungsrelevanter Markt-spezifischer Inhalt>,
  "market_hint": "<Kurzbeschreibung des betroffenen Marktes (Slug-Teil oder Frage), oder null>",
  "side_hint": "<\"yes\"|\"no\"|null>",
  "confidence": <0.0-1.0 — wie sicher bist du, dass das ein echtes Edge-Signal ist>,
  "insider_claim": <true wenn Post Insider-Quelle behauptet>,
  "large_bet_mentioned": <true wenn Post grosse Wette (>$100k) erwähnt>,
  "position_size_hint": <0.0-0.05 — wieviel Prozent des Bankrolls wäre angemessen — konservativ>,
  "reasoning": "<2-3 Sätze auf Deutsch warum (oder warum nicht) — konkret>"
}}

Sei STRENG: confidence >= 0.65 ist ein hoher Anspruch. Speculation, Memes, Noise → confidence < 0.3.
"""

def analyse_post(post: dict, comments: list) -> dict:
    age_min = max(0, int((time.time() - post["created_utc"]) / 60))
    age_str = f"{age_min} min" if age_min < 90 else f"{age_min // 60} h {age_min % 60} min"
    comments_str = "\n".join(
        f"  · ({c['score']}↑) {c['author']}: {c['body']}"
        for c in comments
    ) if comments else "  (keine Top-Kommentare verfügbar)"

    prompt = ANALYSIS_PROMPT.format(
        title=post["title"],
        score=post["score"],
        n_comments=post["num_comments"],
        age_str=age_str,
        permalink=post["permalink"],
        body=post["body"] or "(kein Body — nur Titel)",
        comments=comments_str,
    )

    try:
        from google.genai import types  # type: ignore
        client = get_gemini()
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        raw = (resp.text or "").strip()
        return json.loads(raw)
    except Exception as e:
        log(f"gemini analysis failed for {post['id']}: {e}")
        return {
            "is_signal": False, "market_hint": None, "side_hint": None,
            "confidence": 0.0, "insider_claim": False, "large_bet_mentioned": False,
            "position_size_hint": 0.0, "reasoning": f"analysis_error: {e}",
        }

# ── persist + alert ───────────────────────────────────────────────────────
def store_signal(post: dict, comments: list, analysis: dict) -> None:
    posted_at = datetime.fromtimestamp(post["created_utc"], tz=timezone.utc)
    _exec("""
        INSERT INTO reddit_signals
            (source_sub, post_id, permalink, title, body, top_comments,
             score_reddit, comments_n, posted_at,
             is_signal, insider_claim, large_bet_mentioned, market_hint, side_hint,
             confidence, position_size_hint, reasoning)
        VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (post_id) DO NOTHING
    """, (
        SUBREDDIT, post["id"], post["permalink"], post["title"], post["body"],
        json.dumps(comments), post["score"], post["num_comments"], posted_at,
        bool(analysis.get("is_signal")), bool(analysis.get("insider_claim")),
        analysis.get("market_hint"), analysis.get("side_hint"),
        float(analysis.get("confidence", 0) or 0),
        float(analysis.get("position_size_hint", 0) or 0),
        analysis.get("reasoning", ""),
    ))

def alert_if_high_conf(post: dict, analysis: dict) -> None:
    conf = float(analysis.get("confidence", 0) or 0)
    if not analysis.get("is_signal") or conf < GEMINI_MIN_CONFIDENCE_ALERT:
        return
    insider = "🔍 INSIDER-CLAIM" if analysis.get("insider_claim") else ""
    big = "💰 BIG-BET" if analysis.get("large_bet_mentioned") else ""
    tags = " ".join(t for t in [insider, big] if t)
    msg = (
        f"<b>📡 Reddit-Signal aus r/{SUBREDDIT}</b>\n"
        f"{tags}\n\n"
        f"<b>{post['title'][:200]}</b>\n"
        f"Markt: <code>{(analysis.get('market_hint') or '?')[:120]}</code>\n"
        f"Seite: <b>{(analysis.get('side_hint') or '?').upper()}</b> | "
        f"Conf: <b>{conf:.2f}</b> | "
        f"Size-Hint: <b>{float(analysis.get('position_size_hint', 0) or 0)*100:.1f}%</b>\n\n"
        f"{analysis.get('reasoning', '')[:500]}\n\n"
        f"<a href=\"{post['permalink']}\">Original-Post</a> "
        f"({post['score']}↑ | {post['num_comments']} cmts)"
    )
    try:
        send_telegram_alert(msg)
        log(f"ALERT sent: {post['id']} (conf={conf:.2f})")
    except Exception as e:
        log(f"telegram alert failed: {e}")

# ── main loop ─────────────────────────────────────────────────────────────
def cycle(seen: set) -> set:
    try:
        posts = fetch_new_posts()
    except Exception as e:
        log(f"reddit fetch failed: {e}")
        return seen

    new_posts = [p for p in posts if p["id"] and p["id"] not in seen]
    log(f"poll: {len(posts)} fetched, {len(new_posts)} new")

    for p in new_posts:
        try:
            time.sleep(1.0)  # be polite to reddit
            comments = fetch_top_comments(p["id"], limit=5)
            analysis = analyse_post(p, comments)
            store_signal(p, comments, analysis)
            seen.add(p["id"])
            tag = ""
            if analysis.get("is_signal"):
                tag = f" → SIGNAL conf={float(analysis.get('confidence',0) or 0):.2f}"
                if analysis.get("insider_claim"):
                    tag += " [insider]"
                if analysis.get("large_bet_mentioned"):
                    tag += " [big-bet]"
            log(f"  · {p['id']}: {p['title'][:80]}{tag}")
            alert_if_high_conf(p, analysis)
        except Exception as e:
            log(f"  ! processing {p['id']} failed: {e}")
            traceback.print_exc()

    if new_posts:
        save_state(seen)
    return seen

def main() -> None:
    log("=" * 60)
    log(f"Reddit Polymarket Watcher — sub=r/{SUBREDDIT}, poll={POLL_INTERVAL_SEC}s, model={GEMINI_MODEL}")
    log("=" * 60)
    ensure_table()
    seen = load_state()
    log(f"state loaded: {len(seen)} previously seen post ids")
    while True:
        try:
            seen = cycle(seen)
        except KeyboardInterrupt:
            log("interrupted, exiting")
            return
        except Exception as e:
            log(f"cycle error: {e}")
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_SEC)

if __name__ == "__main__":
    main()


################################################################################
## SECTION: 8_PATCHES_TESTS_OPS
################################################################################
