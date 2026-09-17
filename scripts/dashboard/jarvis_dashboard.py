#!/usr/bin/env python3
"""
jarvis-cc Skills Hub
=====================
A small Tkinter desktop dashboard that visually catalogs everything the
jarvis-cc plugin actually ships: agents, rules, commands, hooks, and skills.

Every number shown is produced by scanning this plugin's own installed
directory tree at launch time. Nothing is hardcoded and nothing is faked --
if a category directory does not exist or is empty, its card simply is not
shown.

Run standalone:
    python jarvis_dashboard.py

Requires only the Python standard library (tkinter, pathlib, json).
"""

from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

# This file lives at <plugin-root>/scripts/dashboard/jarvis_dashboard.py,
# so the plugin root is two levels up. Resolved dynamically so the plugin
# keeps working after being installed on a different machine / path.
SCRIPT_PATH = Path(__file__).resolve()
PLUGIN_ROOT = SCRIPT_PATH.parents[2]

PLUGIN_MANIFEST = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
AGENTS_DIR = PLUGIN_ROOT / "agents"
RULES_DIR = PLUGIN_ROOT / "rules"
COMMANDS_DIR = PLUGIN_ROOT / "commands"
HOOKS_FILE = PLUGIN_ROOT / "hooks" / "hooks.json"
SKILLS_DIR = PLUGIN_ROOT / "skills"

# --------------------------------------------------------------------------
# Theme
# --------------------------------------------------------------------------

BG = "#0d0d0d"
PANEL_BG = "#1a1a1a"
PANEL_BORDER = "#2a2a2a"
ACCENT = "#e8804a"
ACCENT_DIM = "#8a4f30"
TEXT = "#c9c9c9"
TEXT_DIM = "#7a7a7a"
WHITE = "#f5f5f5"

FONT_FAMILY = "Segoe UI"
MAX_VISIBLE_ITEMS = 40  # cap per card before a "+N more" footer kicks in


# --------------------------------------------------------------------------
# Data scanning -- reads jarvis-cc's own installed directory, live.
# --------------------------------------------------------------------------

def read_plugin_meta() -> dict:
    """Read name/version/license out of .claude-plugin/plugin.json."""
    meta = {"name": "jarvis-cc", "version": "", "license": ""}
    if PLUGIN_MANIFEST.is_file():
        try:
            data = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
            meta["name"] = str(data.get("name", meta["name"]))
            meta["version"] = str(data.get("version", ""))
            meta["license"] = str(data.get("license", ""))
        except (json.JSONDecodeError, OSError):
            pass
    return meta


def scan_markdown_files(directory: Path) -> list[str]:
    """Every *.md file directly under `directory`, by stem, sorted."""
    if not directory.is_dir():
        return []
    names = [p.stem for p in directory.glob("*.md") if p.is_file()]
    return sorted(names, key=str.lower)


def scan_rules(rules_dir: Path) -> list[str]:
    """rules/common/*.md plus any other rules/<lang>/*.md subfolders."""
    if not rules_dir.is_dir():
        return []
    items: list[str] = []
    subdirs = sorted((p for p in rules_dir.iterdir() if p.is_dir()), key=lambda p: p.name.lower())
    for sub in subdirs:
        for md in sorted(sub.glob("*.md"), key=lambda p: p.name.lower()):
            items.append(f"{sub.name}/{md.stem}")
    return items


def scan_hooks(hooks_file: Path) -> list[str]:
    """Parse hooks.json and list every registered matcher entry."""
    if not hooks_file.is_file():
        return []
    try:
        data = json.loads(hooks_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    hooks_block = data.get("hooks", data) if isinstance(data, dict) else {}
    if not isinstance(hooks_block, dict):
        return []

    items: list[str] = []
    for event_name, entries in hooks_block.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            matcher = "*"
            if isinstance(entry, dict) and entry.get("matcher"):
                matcher = str(entry["matcher"])
            items.append(f"{event_name}: {matcher}")
    return items


def extract_skill_name(skill_md: Path) -> str | None:
    """Best-effort read of the `name:` field from a SKILL.md's YAML
    frontmatter, without pulling in a YAML dependency (stdlib only)."""
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError:
        return None
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    for line in text[3:end].splitlines():
        stripped = line.strip()
        if stripped.startswith("name:"):
            value = stripped[len("name:"):].strip().strip('"').strip("'")
            if value:
                return value
    return None


def scan_skills(skills_dir: Path) -> list[str]:
    """skills/<dir>/SKILL.md -- one entry per skill directory that has a
    SKILL.md, using the frontmatter `name:` field when present, falling
    back to the directory name otherwise."""
    if not skills_dir.is_dir():
        return []
    items: list[str] = []
    for sub in sorted((p for p in skills_dir.iterdir() if p.is_dir()), key=lambda p: p.name.lower()):
        skill_md = sub / "SKILL.md"
        if not skill_md.is_file():
            continue
        items.append(extract_skill_name(skill_md) or sub.name)
    return sorted(items, key=str.lower)


def build_categories() -> list[tuple[str, list[str]]]:
    """Scan every known category, skipping any that don't exist / are empty."""
    candidates = [
        ("Agents", scan_markdown_files(AGENTS_DIR)),
        ("Rules", scan_rules(RULES_DIR)),
        ("Commands", scan_markdown_files(COMMANDS_DIR)),
        ("Hooks", scan_hooks(HOOKS_FILE)),
        ("Skills", scan_skills(SKILLS_DIR)),
    ]
    return [(name, items) for name, items in candidates if items]


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------

class CategoryCard(tk.Frame):
    """One dark panel: category name, live count, filterable item list."""

    def __init__(self, master: tk.Widget, name: str, items: list[str]):
        super().__init__(master, bg=PANEL_BG, highlightbackground=PANEL_BORDER,
                          highlightthickness=1, bd=0)
        self.name = name
        self.all_items = items

        header = tk.Frame(self, bg=PANEL_BG)
        header.pack(fill="x", padx=16, pady=(14, 6))

        tk.Label(header, text=name, bg=PANEL_BG, fg=WHITE,
                 font=(FONT_FAMILY, 13, "bold")).pack(side="left")

        self.count_label = tk.Label(header, text=str(len(items)), bg=PANEL_BG,
                                     fg=ACCENT, font=(FONT_FAMILY, 13, "bold"))
        self.count_label.pack(side="right")

        list_frame = tk.Frame(self, bg=PANEL_BG)
        list_frame.pack(fill="both", expand=True, padx=16, pady=(0, 6))

        scrollbar = tk.Scrollbar(list_frame, orient="vertical")
        self.listbox = tk.Listbox(
            list_frame, bg=PANEL_BG, fg=TEXT, selectbackground=ACCENT_DIM,
            selectforeground=WHITE, activestyle="none", relief="flat",
            highlightthickness=0, bd=0, font=(FONT_FAMILY, 10),
            yscrollcommand=scrollbar.set,
        )
        scrollbar.config(command=self.listbox.yview)
        self.listbox.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.more_label = tk.Label(self, text="", bg=PANEL_BG, fg=TEXT_DIM,
                                    font=(FONT_FAMILY, 9, "italic"), anchor="w")
        self.more_label.pack(fill="x", padx=16, pady=(0, 12))

        self.render(items)

    def render(self, items: list[str]) -> None:
        """Repopulate the listbox, count, and '+N more' footer for `items`."""
        self.listbox.delete(0, "end")
        visible = items[:MAX_VISIBLE_ITEMS]
        for item in visible:
            self.listbox.insert("end", f"  {item}")

        self.count_label.config(text=str(len(items)))

        remainder = len(items) - len(visible)
        self.more_label.config(text=f"+{remainder} more" if remainder > 0 else "")

    def apply_filter(self, query: str) -> int:
        """Filter this card's list by case-insensitive substring match.

        Returns the number of matches so the caller can total them up.
        """
        if not query:
            filtered = self.all_items
        else:
            q = query.lower()
            filtered = [item for item in self.all_items if q in item.lower()]
        self.render(filtered)
        return len(filtered)


class SkillsHubApp(tk.Tk):
    """Top-level dashboard window."""

    def __init__(self):
        super().__init__()
        self.meta = read_plugin_meta()
        self.categories = build_categories()
        self.total_items = sum(len(items) for _, items in self.categories)
        self.cards: list[CategoryCard] = []

        self.title("jarvis-cc — Skills Hub")
        self.configure(bg=BG)
        self.geometry("1180x720")
        self.minsize(760, 520)

        self._build_header()
        self._build_search()
        self._build_cards()
        self._build_footer()

    # -- sections ------------------------------------------------------

    def _build_header(self) -> None:
        header = tk.Frame(self, bg=BG)
        header.pack(fill="x", padx=32, pady=(28, 4))

        title_row = tk.Frame(header, bg=BG)
        title_row.pack(fill="x", anchor="w")

        tk.Label(title_row, text="jarvis-cc", bg=BG, fg=WHITE,
                 font=(FONT_FAMILY, 28, "bold")).pack(side="left")

        version = self.meta.get("version") or "0.0.0"
        badge = tk.Label(title_row, text=f" v{version} ", bg=BG, fg=ACCENT,
                          font=(FONT_FAMILY, 10, "bold"),
                          highlightbackground=ACCENT, highlightthickness=1,
                          padx=6, pady=2)
        badge.pack(side="left", padx=(12, 0), pady=(10, 0))

        tk.Label(header, text="Your personal Claude Code setup, packaged.",
                 bg=BG, fg=TEXT, font=(FONT_FAMILY, 12)).pack(anchor="w", pady=(6, 0))

        tk.Label(header, text=f"Scanning {PLUGIN_ROOT}", bg=BG, fg=TEXT_DIM,
                 font=(FONT_FAMILY, 9)).pack(anchor="w", pady=(2, 0))

    def _build_search(self) -> None:
        bar = tk.Frame(self, bg=BG)
        bar.pack(fill="x", padx=32, pady=(18, 12))

        tk.Label(bar, text="Filter:", bg=BG, fg=TEXT_DIM,
                 font=(FONT_FAMILY, 10)).pack(side="left", padx=(0, 8))

        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self._on_search_changed)

        entry = tk.Entry(bar, textvariable=self.search_var, bg=PANEL_BG, fg=WHITE,
                          insertbackground=ACCENT, relief="flat",
                          highlightbackground=PANEL_BORDER, highlightcolor=ACCENT,
                          highlightthickness=1, font=(FONT_FAMILY, 11))
        entry.pack(side="left", fill="x", expand=True, ipady=6, ipadx=6)
        entry.focus_set()

        self.match_label = tk.Label(bar, text="", bg=BG, fg=ACCENT,
                                     font=(FONT_FAMILY, 10, "bold"))
        self.match_label.pack(side="left", padx=(12, 0))

    def _build_cards(self) -> None:
        cards_frame = tk.Frame(self, bg=BG)
        cards_frame.pack(fill="both", expand=True, padx=32, pady=(0, 12))

        if not self.categories:
            tk.Label(cards_frame,
                     text="No agents, rules, commands, hooks, or skills found "
                          "under this plugin's installed directory.",
                     bg=BG, fg=TEXT_DIM, font=(FONT_FAMILY, 11)).pack(pady=40)
            return

        for i, (name, items) in enumerate(self.categories):
            cards_frame.columnconfigure(i, weight=1, uniform="cards")
            card = CategoryCard(cards_frame, name, items)
            card.grid(row=0, column=i, sticky="nsew", padx=(0 if i == 0 else 12, 0))
            self.cards.append(card)
        cards_frame.rowconfigure(0, weight=1)

    def _build_footer(self) -> None:
        footer = tk.Frame(self, bg=BG, highlightbackground=PANEL_BORDER,
                           highlightthickness=1)
        footer.pack(fill="x", padx=32, pady=(0, 24), ipady=10)

        tk.Label(footer, text=f"{self.total_items} items total", bg=BG, fg=TEXT,
                 font=(FONT_FAMILY, 10, "bold")).pack(side="left", padx=16)

        license_name = self.meta.get("license") or "MIT"
        tk.Label(footer, text=f"{license_name} License", bg=BG, fg=TEXT_DIM,
                 font=(FONT_FAMILY, 10)).pack(side="right", padx=16)

    # -- behaviour -------------------------------------------------------

    def _on_search_changed(self, *_args) -> None:
        query = self.search_var.get().strip()
        total_matches = sum(card.apply_filter(query) for card in self.cards)
        self.match_label.config(text=f"{total_matches} match(es)" if query else "")


def main() -> None:
    app = SkillsHubApp()
    app.mainloop()


if __name__ == "__main__":
    main()
