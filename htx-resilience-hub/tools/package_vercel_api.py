"""Package only backend source for a separate Vercel FastAPI project."""
import shutil
import sys
import json
from pathlib import Path

source = Path(__file__).resolve().parents[1]
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=True)
shutil.copytree(source / "apps" / "api", target / "apps" / "api", dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".env*", "tests"))
shutil.copytree(source / "db", target / "db", dirs_exist_ok=True)
shutil.copyfile(source / "deploy" / "vercel-api-entrypoint.py", target / "app.py")
shutil.copyfile(source / "deploy" / "vercel-api.json", target / "vercel.json")
shutil.copyfile(source / "apps" / "api" / "requirements.txt", target / "requirements.txt")
dependencies = (source / "apps" / "api" / "requirements.txt").read_text().splitlines()
(target / "pyproject.toml").write_text('[project]\nname = "noach-api"\nversion = "0.2.0"\nrequires-python = ">=3.12,<3.13"\ndependencies = ' + json.dumps(dependencies) + '\n', encoding="utf-8")
print(f"Backend packaged at {target}")
