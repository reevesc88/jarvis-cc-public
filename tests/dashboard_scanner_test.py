"""Behavioural tests for the scanner half of scripts/dashboard/jarvis_dashboard.py.

The dashboard imports tkinter at module level, but the scanners and
build_categories() never touch it. A minimal stub lets these tests run on
headless machines and CI runners without a Tk install.

Run: python3 -m unittest tests/dashboard_scanner_test.py
"""
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "dashboard" / "jarvis_dashboard.py"


def load_dashboard():
    stub = types.ModuleType("tkinter")
    stub.Frame = type("Frame", (), {})
    stub.Tk = type("Tk", (), {})
    previous = sys.modules.get("tkinter")
    sys.modules["tkinter"] = stub
    try:
        spec = importlib.util.spec_from_file_location("jarvis_dashboard_under_test", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("tkinter", None)
        else:
            sys.modules["tkinter"] = previous


dash = load_dashboard()


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class ScannerFallbackTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def test_missing_paths_yield_empty_results(self):
        missing = self.root / "nope"
        self.assertEqual(dash.scan_markdown_files(missing), [])
        self.assertEqual(dash.scan_rules(missing), [])
        self.assertEqual(dash.scan_hooks(missing / "hooks.json"), [])
        self.assertEqual(dash.scan_skills(missing), [])

    def test_skill_name_prefers_frontmatter_and_falls_back_to_directory(self):
        write(self.root / "skills" / "dir-a" / "SKILL.md", "---\nname: \"Named Skill\"\n---\nbody\n")
        write(self.root / "skills" / "dir-b" / "SKILL.md", "no frontmatter here\n")
        write(self.root / "skills" / "dir-c" / "SKILL.md", "---\ndescription: no name\n---\n")
        write(self.root / "skills" / "dir-d" / "SKILL.md", "---\nname: unterminated\n")
        (self.root / "skills" / "dir-e").mkdir()  # no SKILL.md: skipped
        self.assertEqual(
            dash.scan_skills(self.root / "skills"),
            ["dir-b", "dir-c", "dir-d", "Named Skill"],
        )

    def test_malformed_or_oddly_shaped_hooks_file_is_skipped(self):
        bad = write(self.root / "bad.json", "{not json")
        self.assertEqual(dash.scan_hooks(bad), [])
        listy = write(self.root / "list.json", json.dumps(["x"]))
        self.assertEqual(dash.scan_hooks(listy), [])
        odd = write(self.root / "odd.json", json.dumps({"hooks": {"PreToolUse": "nope"}}))
        self.assertEqual(dash.scan_hooks(odd), [])

    def test_hooks_list_matchers_with_wildcard_default(self):
        hooks = write(
            self.root / "hooks.json",
            json.dumps({"hooks": {"PreToolUse": [{"matcher": "Edit|Write"}, {}], "SessionStart": [{}]}}),
        )
        self.assertEqual(
            dash.scan_hooks(hooks),
            ["PreToolUse: Edit|Write", "PreToolUse: *", "SessionStart: *"],
        )

    def test_rules_are_listed_per_subfolder_and_ignore_top_level_files(self):
        write(self.root / "rules" / "common" / "style.md", "x")
        write(self.root / "rules" / "python" / "tests.md", "x")
        write(self.root / "rules" / "README.md", "x")
        self.assertEqual(dash.scan_rules(self.root / "rules"), ["common/style", "python/tests"])

    def test_plugin_meta_defaults_survive_a_broken_manifest(self):
        original = dash.PLUGIN_MANIFEST
        self.addCleanup(setattr, dash, "PLUGIN_MANIFEST", original)
        dash.PLUGIN_MANIFEST = write(self.root / "plugin.json", "{broken")
        self.assertEqual(dash.read_plugin_meta(), {"name": "jarvis-cc", "version": "", "license": ""})
        dash.PLUGIN_MANIFEST = write(
            self.root / "plugin.json", json.dumps({"name": "x", "version": "1.2.3", "license": "MIT"})
        )
        self.assertEqual(dash.read_plugin_meta(), {"name": "x", "version": "1.2.3", "license": "MIT"})


class BuildCategoriesTests(unittest.TestCase):
    NAMES = ("AGENTS_DIR", "RULES_DIR", "COMMANDS_DIR", "HOOKS_FILE", "SKILLS_DIR")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for name in self.NAMES:
            self.addCleanup(setattr, dash, name, getattr(dash, name))
        dash.AGENTS_DIR = self.root / "agents"
        dash.RULES_DIR = self.root / "rules"
        dash.COMMANDS_DIR = self.root / "commands"
        dash.HOOKS_FILE = self.root / "hooks" / "hooks.json"
        dash.SKILLS_DIR = self.root / "skills"

    def test_empty_install_has_no_categories(self):
        self.assertEqual(dash.build_categories(), [])

    def test_only_populated_categories_appear_in_fixed_order(self):
        write(self.root / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        write(self.root / "agents" / "b.md", "x")
        write(self.root / "agents" / "A.md", "x")
        write(self.root / "commands" / "run.md", "x")
        self.assertEqual(
            dash.build_categories(),
            [("Agents", ["A", "b"]), ("Commands", ["run"]), ("Skills", ["s"])],
        )


if __name__ == "__main__":
    unittest.main()
