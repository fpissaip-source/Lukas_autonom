#!/usr/bin/env python3
"""
training_logger.py — Automatic training-data logger for LoRA fine-tuning.

Every agent session writes one JSONL record in the OpenAI messages format,
compatible with: Axolotl, Unsloth, LLaMA Factory, TRL SFTTrainer.

Public API
----------
    log_session(system, user_prompt, completion, metadata={})
    get_stats()  → dict with total pairs, total tokens estimate, etc.

Output
------
    training_data/YYYY-MM/session_YYYYMMDD_HHMMSS.jsonl   (1 record per file)
    training_data/_index.jsonl                              (cumulative index)
"""
import json
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
TRAINING_DIR = BASE_DIR / "training_data"


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def log_session(
    system: str,
    user_prompt: str,
    completion: str,
    metadata: dict = None,
) -> Path:
    """
    Write one LoRA training pair to disk.

    Returns the path of the written file (or None on error).
    The pair is written in OpenAI chat format plus a flat prompt/completion
    variant so it works with any LoRA framework:

    {
      "messages": [
          {"role": "system",    "content": "..."},
          {"role": "user",      "content": "..."},
          {"role": "assistant", "content": "..."}
      ],
      "prompt":     "<system>\\n<user>",   # flat for frameworks that need it
      "completion": "...",
      "meta": { "date": "...", "session": N, ... }
    }
    """
    if not completion or not completion.strip():
        return None
    try:
        now = datetime.now()
        month_dir = TRAINING_DIR / now.strftime("%Y-%m")
        month_dir.mkdir(parents=True, exist_ok=True)

        fname = f"session_{now.strftime('%Y%m%d_%H%M%S')}.jsonl"
        fpath = month_dir / fname

        meta = {
            "date": now.strftime("%Y-%m-%d %H:%M:%S"),
            **(metadata or {})
        }

        record = {
            "messages": [
                {"role": "system",    "content": system.strip()},
                {"role": "user",      "content": user_prompt.strip()},
                {"role": "assistant", "content": completion.strip()},
            ],
            "prompt":     f"{system.strip()}\n\n{user_prompt.strip()}",
            "completion": completion.strip(),
            "meta":       meta,
        }

        fpath.write_text(json.dumps(record, ensure_ascii=False) + "\n")

        # Append to cumulative index (one JSON line per session)
        index_path = TRAINING_DIR / "_index.jsonl"
        with index_path.open("a") as idx:
            idx.write(json.dumps({
                "file":   str(fpath.relative_to(TRAINING_DIR)),
                "date":   meta["date"],
                "tokens": _estimate_tokens(system + user_prompt + completion),
                **{k: v for k, v in meta.items() if k != "date"},
            }, ensure_ascii=False) + "\n")

        print(f"  [training] Saved: {fpath.name} (~{_estimate_tokens(completion)} completion tokens)")
        return fpath

    except Exception as e:
        print(f"  [training] log_session error: {e}")
        return None


def get_stats() -> dict:
    """Return summary statistics about collected training data."""
    index_path = TRAINING_DIR / "_index.jsonl"
    if not index_path.exists():
        return {"total_pairs": 0, "total_tokens": 0, "oldest": None, "newest": None}
    try:
        records = [json.loads(l) for l in index_path.read_text().splitlines() if l.strip()]
        dates = [r.get("date", "") for r in records if r.get("date")]
        total_tokens = sum(r.get("tokens", 0) for r in records)
        return {
            "total_pairs":  len(records),
            "total_tokens": total_tokens,
            "oldest":       min(dates) if dates else None,
            "newest":       max(dates) if dates else None,
        }
    except Exception as e:
        return {"error": str(e), "total_pairs": 0, "total_tokens": 0}
