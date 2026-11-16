#!/usr/bin/env python3
"""互換用: `python3 scripts/update_gemini.py [--context ...] [--dry-run]` = update_picks.py gemini"""
import runpy, sys
from pathlib import Path
sys.argv = [sys.argv[0], "gemini", *sys.argv[1:]]
runpy.run_path(str(Path(__file__).with_name("update_picks.py")), run_name="__main__")
