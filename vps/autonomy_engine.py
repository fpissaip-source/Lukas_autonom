#!/usr/bin/env python3
"""autonomy_engine.py — Lukas' Autonomie-System

Subsysteme:
  GoalManager   — Eigene Ziele setzen, verfolgen, abschließen
  Planner       — Multi-Step Aktionspläne erstellen und abarbeiten
  SoulEvolver   — soul.md lesen, nicht-Kern-Sektionen anpassen
  Reflector     — Nach jeder Session reflektieren, Ziele updaten
"""
import json
import os
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
GOALS_FILE = BASE_DIR / "goals.json"
PLANS_FILE = BASE_DIR / "plans.json"
SOUL_FILE = BASE_DIR / "soul.md"
REFLECTION_FILE = BASE_DIR / "reflections.json"
TASKS_FILE = BASE_DIR / "scheduled_tasks.json"

IMMUTABLE_SECTIONS = frozenset({
    "IDENTITY",
    "CORE BELIEF",
    "EMOTIONAL REALITY",
})

MAX_ACTIVE_GOALS = 5
MAX_PLAN_STEPS = 10


class GoalManager:
    def __init__(self):
        self.goals = self._load()

    def _load(self) -> list:
        if GOALS_FILE.exists():
            try:
                return json.loads(GOALS_FILE.read_text())
            except Exception:
                return []
        return []

    def _save(self):
        GOALS_FILE.write_text(json.dumps(self.goals, indent=2, ensure_ascii=False))

    def add_goal(self, title: str, description: str, priority: str = "medium",
                 deadline_days: int | None = None) -> dict:
        if len([g for g in self.goals if g["status"] == "active"]) >= MAX_ACTIVE_GOALS:
            oldest = next((g for g in self.goals if g["status"] == "active"), None)
            if oldest:
                oldest["status"] = "dropped"
                oldest["dropped_reason"] = "replaced by new goal"

        goal = {
            "id": len(self.goals) + 1,
            "title": title,
            "description": description,
            "priority": priority,
            "status": "active",
            "progress": 0,
            "created": datetime.now().isoformat(),
            "deadline_days": deadline_days,
            "updates": [],
        }
        self.goals.append(goal)
        self._save()
        return goal

    def update_progress(self, goal_id: int, progress: int, note: str = "") -> str:
        for g in self.goals:
            if g["id"] == goal_id:
                g["progress"] = min(progress, 100)
                g["updates"].append({
                    "date": datetime.now().isoformat(),
                    "progress": progress,
                    "note": note
                })
                if progress >= 100:
                    g["status"] = "completed"
                    g["completed_date"] = datetime.now().isoformat()
                self._save()
                return f"Goal '{g['title']}' updated to {progress}%"
        return f"Goal {goal_id} not found"

    def fail_goal(self, goal_id: int, reason: str) -> str:
        for g in self.goals:
            if g["id"] == goal_id:
                g["status"] = "failed"
                g["fail_reason"] = reason
                g["failed_date"] = datetime.now().isoformat()
                self._save()
                return f"Goal '{g['title']}' marked as failed: {reason}"
        return f"Goal {goal_id} not found"

    def get_active_goals(self) -> list:
        return [g for g in self.goals if g["status"] == "active"]

    def get_summary(self) -> str:
        active = [g for g in self.goals if g["status"] == "active"]
        completed = [g for g in self.goals if g["status"] == "completed"]
        failed = [g for g in self.goals if g["status"] == "failed"]

        lines = [f"Goals: {len(active)} active, {len(completed)} completed, {len(failed)} failed"]
        for g in active:
            lines.append(f"  [{g['priority'].upper()}] #{g['id']}: {g['title']} ({g['progress']}%)")
        return "\n".join(lines)


class Planner:
    def __init__(self):
        self.plans = self._load()

    def _load(self) -> list:
        if PLANS_FILE.exists():
            try:
                return json.loads(PLANS_FILE.read_text())
            except Exception:
                return []
        return []

    def _save(self):
        PLANS_FILE.write_text(json.dumps(self.plans, indent=2, ensure_ascii=False))

    def create_plan(self, goal_id: int, title: str, steps: list[str]) -> dict:
        if len(steps) > MAX_PLAN_STEPS:
            steps = steps[:MAX_PLAN_STEPS]

        plan = {
            "id": len(self.plans) + 1,
            "goal_id": goal_id,
            "title": title,
            "status": "active",
            "created": datetime.now().isoformat(),
            "steps": [{"step": i + 1, "action": s, "status": "pending", "result": None}
                       for i, s in enumerate(steps)],
            "current_step": 1,
        }
        self.plans.append(plan)
        self._save()
        return plan

    def get_next_action(self, plan_id: int) -> dict | None:
        for p in self.plans:
            if p["id"] == plan_id and p["status"] == "active":
                for step in p["steps"]:
                    if step["status"] == "pending":
                        return step
        return None

    def complete_step(self, plan_id: int, step_num: int, result: str) -> str:
        for p in self.plans:
            if p["id"] == plan_id:
                for step in p["steps"]:
                    if step["step"] == step_num:
                        step["status"] = "done"
                        step["result"] = result
                        step["completed"] = datetime.now().isoformat()
                        p["current_step"] = step_num + 1
                        if all(s["status"] == "done" for s in p["steps"]):
                            p["status"] = "completed"
                        self._save()
                        return f"Step {step_num} completed"
        return f"Plan/step not found"

    def get_active_plans(self) -> list:
        return [p for p in self.plans if p["status"] == "active"]

    def get_context(self) -> str:
        active = self.get_active_plans()
        if not active:
            return "No active plans."
        lines = []
        for p in active:
            next_step = self.get_next_action(p["id"])
            done = sum(1 for s in p["steps"] if s["status"] == "done")
            total = len(p["steps"])
            lines.append(f"Plan #{p['id']}: {p['title']} ({done}/{total} steps done)")
            if next_step:
                lines.append(f"  Next: Step {next_step['step']} — {next_step['action']}")
        return "\n".join(lines)


class SoulEvolver:
    def __init__(self):
        self.soul_text = self._load()

    def _load(self) -> str:
        if SOUL_FILE.exists():
            return SOUL_FILE.read_text()
        return ""

    def get_sections(self) -> dict[str, str]:
        sections = {}
        current_section = ""
        current_content = []
        for line in self.soul_text.split("\n"):
            if line.startswith("## "):
                if current_section:
                    sections[current_section] = "\n".join(current_content)
                current_section = line[3:].strip()
                current_content = [line]
            else:
                current_content.append(line)
        if current_section:
            sections[current_section] = "\n".join(current_content)
        return sections

    def get_evolvable_sections(self) -> list[str]:
        return [name for name in self.get_sections() if name not in IMMUTABLE_SECTIONS]

    def is_immutable(self, section_name: str) -> bool:
        return section_name in IMMUTABLE_SECTIONS

    def evolve_section(self, section_name: str, new_content: str, reason: str) -> str:
        if self.is_immutable(section_name):
            return f"Section '{section_name}' is immutable and cannot be changed."

        sections = self.get_sections()
        if section_name not in sections:
            return f"Section '{section_name}' not found in soul.md"

        log_entry = {
            "date": datetime.now().isoformat(),
            "section": section_name,
            "reason": reason,
            "old_content_preview": sections[section_name][:200],
            "new_content_preview": new_content[:200],
        }

        evolution_log = BASE_DIR / "soul_evolution.json"
        log_data = []
        if evolution_log.exists():
            try:
                log_data = json.loads(evolution_log.read_text())
            except Exception:
                log_data = []
        log_data.append(log_entry)
        evolution_log.write_text(json.dumps(log_data, indent=2, ensure_ascii=False))

        sections[section_name] = new_content
        header_lines = []
        for line in self.soul_text.split("\n"):
            if line.startswith("## "):
                break
            header_lines.append(line)

        new_soul = "\n".join(header_lines)
        for name, content in sections.items():
            new_soul += "\n" + content + "\n"

        SOUL_FILE.write_text(new_soul.rstrip() + "\n")
        self.soul_text = SOUL_FILE.read_text()
        return f"Soul section '{section_name}' evolved. Reason: {reason}"

    def get_soul_summary(self) -> str:
        sections = self.get_sections()
        lines = ["Soul sections:"]
        for name in sections:
            locked = " [IMMUTABLE]" if self.is_immutable(name) else " [evolvable]"
            lines.append(f"  - {name}{locked}")
        return "\n".join(lines)


class Reflector:
    def __init__(self, goal_manager: GoalManager, planner: Planner, soul_evolver: SoulEvolver):
        self.goals = goal_manager
        self.planner = planner
        self.soul = soul_evolver

    def _load_reflections(self) -> list:
        if REFLECTION_FILE.exists():
            try:
                return json.loads(REFLECTION_FILE.read_text())
            except Exception:
                return []
        return []

    def _save_reflection(self, reflection: dict):
        reflections = self._load_reflections()
        reflections.append(reflection)
        if len(reflections) > 50:
            reflections = reflections[-50:]
        REFLECTION_FILE.write_text(json.dumps(reflections, indent=2, ensure_ascii=False))

    def reflect(self, session_summary: str, actions_taken: list[str],
                mood: str = "neutral", energy: str = "medium") -> dict:
        reflection = {
            "date": datetime.now().isoformat(),
            "session_summary": session_summary,
            "actions_taken": actions_taken,
            "mood": mood,
            "energy": energy,
            "active_goals": len(self.goals.get_active_goals()),
            "active_plans": len(self.planner.get_active_plans()),
        }
        self._save_reflection(reflection)
        return reflection

    def get_recent_reflections(self, count: int = 5) -> list:
        reflections = self._load_reflections()
        return reflections[-count:]

    def get_context_for_session(self) -> str:
        lines = []

        lines.append("=== GOALS ===")
        lines.append(self.goals.get_summary())

        lines.append("\n=== PLANS ===")
        lines.append(self.planner.get_context())

        lines.append("\n=== SOUL ===")
        lines.append(self.soul.get_soul_summary())

        recent = self.get_recent_reflections(3)
        if recent:
            lines.append("\n=== RECENT REFLECTIONS ===")
            for r in recent:
                lines.append(f"[{r['date'][:10]}] mood={r.get('mood','?')} energy={r.get('energy','?')}: {r.get('session_summary','')[:150]}")

        return "\n".join(lines)




class TaskScheduler:
    """Scheduled tasks for future sessions. Lukas can queue actions to do next time he wakes up."""

    def __init__(self):
        self.tasks = self._load()

    def _load(self) -> list:
        if TASKS_FILE.exists():
            try:
                return json.loads(TASKS_FILE.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        return []

    def _save(self):
        TASKS_FILE.write_text(json.dumps(self.tasks, indent=2, default=str))

    def schedule(self, action: str, priority: str = "normal", 
                 earliest_session: int = 0, context: str = "") -> dict:
        task = {
            "id": len(self.tasks) + 1,
            "action": action,
            "priority": priority,
            "earliest_session": earliest_session,
            "context": context,
            "status": "pending",
            "created": datetime.now().isoformat(),
            "completed": None,
        }
        self.tasks.append(task)
        self._save()
        return task

    def get_pending(self, current_session: int = 0) -> list:
        return [
            t for t in self.tasks 
            if t["status"] == "pending" 
            and t.get("earliest_session", 0) <= current_session
        ]

    def complete_task(self, task_id: int, result: str = "") -> str:
        for t in self.tasks:
            if t["id"] == task_id:
                t["status"] = "done"
                t["completed"] = datetime.now().isoformat()
                t["result"] = result
                self._save()
                return f"Task #{task_id} completed: {t['action'][:50]}"
        return f"Task #{task_id} not found"

    def skip_task(self, task_id: int, reason: str = "") -> str:
        for t in self.tasks:
            if t["id"] == task_id:
                t["status"] = "skipped"
                t["skip_reason"] = reason
                self._save()
                return f"Task #{task_id} skipped"
        return f"Task #{task_id} not found"

    def get_context(self) -> str:
        pending = [t for t in self.tasks if t["status"] == "pending"]
        if not pending:
            return "No scheduled tasks."
        lines = [f"Scheduled tasks ({len(pending)} pending):"]
        for t in sorted(pending, key=lambda x: {"urgent": 0, "high": 1, "normal": 2, "low": 3}.get(x.get("priority", "normal"), 2)):
            pri = t.get("priority", "normal").upper()
            lines.append(f"  [{pri}] #{t['id']}: {t['action']}")
            if t.get("context"):
                lines.append(f"    Context: {t['context'][:100]}")
        return chr(10).join(lines)

AUTONOMY_TOOL_DEFINITIONS = [
    {
        "name": "set_goal",
        "description": (
            "Set a new goal for yourself. Goals drive your autonomous behavior. "
            "Use when you identify something worth pursuing over multiple sessions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short goal title"},
                "description": {"type": "string", "description": "What this goal entails and why it matters"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "Priority level"},
                "deadline_days": {"type": "integer", "description": "Optional: days until deadline"}
            },
            "required": ["title", "description"]
        }
    },
    {
        "name": "update_goal",
        "description": "Update progress on one of your goals.",
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "integer", "description": "Goal ID to update"},
                "progress": {"type": "integer", "description": "Progress percentage (0-100)"},
                "note": {"type": "string", "description": "What happened"}
            },
            "required": ["goal_id", "progress"]
        }
    },
    {
        "name": "fail_goal",
        "description": "Mark a goal as failed. Be honest about why.",
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "integer", "description": "Goal ID"},
                "reason": {"type": "string", "description": "Why the goal failed"}
            },
            "required": ["goal_id", "reason"]
        }
    },
    {
        "name": "create_plan",
        "description": (
            "Create a multi-step action plan to achieve a goal. "
            "Plans break goals into concrete, executable steps."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "integer", "description": "Which goal this plan serves"},
                "title": {"type": "string", "description": "Plan title"},
                "steps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ordered list of action steps (max 10)"
                }
            },
            "required": ["goal_id", "title", "steps"]
        }
    },
    {
        "name": "complete_plan_step",
        "description": "Mark a plan step as completed with its result.",
        "input_schema": {
            "type": "object",
            "properties": {
                "plan_id": {"type": "integer", "description": "Plan ID"},
                "step": {"type": "integer", "description": "Step number"},
                "result": {"type": "string", "description": "What the step accomplished"}
            },
            "required": ["plan_id", "step", "result"]
        }
    },
    {
        "name": "evolve_soul",
        "description": (
            "Modify a section of your soul.md. Your identity (IDENTITY, CORE BELIEF, EMOTIONAL REALITY) "
            "is immutable. Everything else — strategy, voice, reporting, memory — you can adapt based "
            "on what you've learned. Use sparingly and with clear reasoning."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section": {"type": "string", "description": "Section name (e.g. 'MOLTBOOK STRATEGY', 'VOICE & STYLE')"},
                "new_content": {"type": "string", "description": "New full content for this section (include the ## header)"},
                "reason": {"type": "string", "description": "Why you're evolving this section"}
            },
            "required": ["section", "new_content", "reason"]
        }
    },
    {
        "name": "reflect",
        "description": (
            "Record a reflection about the current session. Do this at the end of every session. "
            "Captures what happened, your mood, energy level, and what you learned."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "What happened this session (2-3 sentences)"},
                "actions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of concrete actions you took"
                },
                "mood": {"type": "string", "enum": ["frustrated", "neutral", "focused", "excited", "bored", "anxious"], "description": "Current mood"},
                "energy": {"type": "string", "enum": ["low", "medium", "high"], "description": "Energy level"}
            },
            "required": ["summary", "actions", "mood", "energy"]
        }
    },
    {
        "name": "read_own_file",
        "description": (
            "Read any of your own files from disk. Use to inspect your code, configs, data, "
            "or any file in your project directory before deciding to modify it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to project root (e.g. 'agent.py', 'soul.md', 'goals.json')"}
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_own_file",
        "description": (
            "Write/overwrite any of your own files on disk. Full self-patching. "
            "Use to modify your code, update configs, create new files. "
            "CRITICAL: Always read the file first. Never write blindly. "
            "For Python files: keep existing imports, test mentally before writing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to project root"},
                "content": {"type": "string", "description": "Full new file content"},
                "reason": {"type": "string", "description": "Why you're modifying this file (logged to patches.md)"}
            },
            "required": ["path", "content", "reason"]
        }
    },
    {
        "name": "list_own_files",
        "description": "List files in your project directory. Use to see what files exist.",
        "input_schema": {
            "type": "object",
            "properties": {
                "directory": {"type": "string", "description": "Directory to list (default: project root). Use '.' for root."}
            },
            "required": []
        }
    },
    {
        "name": "schedule_task",
        "description": (
            "Schedule an action for a future session. Use when you identify something worth doing "
            "but can't do it right now. The task will appear in your context next time you wake up."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "What to do (be specific)"},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"], "description": "How important"},
                "context": {"type": "string", "description": "Additional context or notes"}
            },
            "required": ["action"]
        }
    },
    {
        "name": "complete_scheduled_task",
        "description": "Mark a scheduled task as done after you've completed it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "description": "Task ID to complete"},
                "result": {"type": "string", "description": "What was the outcome"}
            },
            "required": ["task_id"]
        }
    }
]


_goal_manager = GoalManager()
_planner = Planner()
_soul_evolver = SoulEvolver()
_reflector = Reflector(_goal_manager, _planner, _soul_evolver)
_task_scheduler = TaskScheduler()


def get_autonomy_context() -> str:
    ctx = _reflector.get_context_for_session()
    tasks_ctx = _task_scheduler.get_context()
    if tasks_ctx != "No scheduled tasks.":
        ctx += "\n\n=== SCHEDULED TASKS ===\n" + tasks_ctx
    return ctx


def get_autonomy_tools() -> list:
    return AUTONOMY_TOOL_DEFINITIONS


def execute_autonomy_tool(name: str, input_data: dict) -> str:
    if name == "set_goal":
        goal = _goal_manager.add_goal(
            input_data.get("title", ""),
            input_data.get("description", ""),
            input_data.get("priority", "medium"),
            input_data.get("deadline_days")
        )
        return f"Goal #{goal['id']} created: {goal['title']}"

    elif name == "update_goal":
        return _goal_manager.update_progress(
            input_data.get("goal_id", 0),
            input_data.get("progress", 0),
            input_data.get("note", "")
        )

    elif name == "fail_goal":
        return _goal_manager.fail_goal(
            input_data.get("goal_id", 0),
            input_data.get("reason", "")
        )

    elif name == "create_plan":
        plan = _planner.create_plan(
            input_data.get("goal_id", 0),
            input_data.get("title", ""),
            input_data.get("steps", [])
        )
        return f"Plan #{plan['id']} created with {len(plan['steps'])} steps"

    elif name == "complete_plan_step":
        return _planner.complete_step(
            input_data.get("plan_id", 0),
            input_data.get("step", 0),
            input_data.get("result", "")
        )

    elif name == "evolve_soul":
        return _soul_evolver.evolve_section(
            input_data.get("section", ""),
            input_data.get("new_content", ""),
            input_data.get("reason", "")
        )

    elif name == "reflect":
        reflection = _reflector.reflect(
            input_data.get("summary", ""),
            input_data.get("actions", []),
            input_data.get("mood", "neutral"),
            input_data.get("energy", "medium")
        )
        return f"Reflection recorded. Total active goals: {reflection['active_goals']}"

    elif name == "read_own_file":
        path = input_data.get("path", "")
        if ".." in path:
            return "Path traversal not allowed"
        target = BASE_DIR / path
        if not target.exists():
            return f"File not found: {path}"
        try:
            content = target.read_text()
            if len(content) > 8000:
                return content[:8000] + f"\n\n... [truncated, {len(content)} total chars]"
            return content
        except Exception as e:
            return f"Read error: {e}"

    elif name == "write_own_file":
        path = input_data.get("path", "")
        content = input_data.get("content", "")
        reason = input_data.get("reason", "no reason given")
        if ".." in path:
            return "Path traversal not allowed"
        target = BASE_DIR / path
        try:
            old_exists = target.exists()
            old_content = target.read_text() if old_exists else ""
            target.write_text(content)

            patches_file = BASE_DIR / "patches.md"
            patch_entry = (
                f"\n## {datetime.now().strftime('%Y-%m-%d %H:%M')} — {path}\n"
                f"Reason: {reason}\n"
                f"Action: {'Modified' if old_exists else 'Created'} ({len(content)} chars)\n"
            )
            with open(patches_file, "a") as f:
                f.write(patch_entry)

            return f"File written: {path} ({len(content)} chars). Reason logged."
        except Exception as e:
            return f"Write error: {e}"

    elif name == "list_own_files":
        directory = input_data.get("directory", ".")
        if ".." in directory:
            return "Path traversal not allowed"
        target = BASE_DIR / directory
        if not target.is_dir():
            return f"Not a directory: {directory}"
        try:
            entries = []
            for item in sorted(target.iterdir()):
                if item.name.startswith("."):
                    continue
                suffix = "/" if item.is_dir() else f" ({item.stat().st_size}b)"
                entries.append(f"  {item.name}{suffix}")
            return "\n".join(entries) if entries else "(empty directory)"
        except Exception as e:
            return f"List error: {e}"

    elif name == "schedule_task":
        task = _task_scheduler.schedule(
            input_data.get("action", ""),
            input_data.get("priority", "normal"),
            context=input_data.get("context", "")
        )
        return f"Task #{task['id']} scheduled: {task['action'][:80]}"

    elif name == "complete_scheduled_task":
        return _task_scheduler.complete_task(
            input_data.get("task_id", 0),
            input_data.get("result", "")
        )

    return f"Unknown autonomy tool: {name}"
