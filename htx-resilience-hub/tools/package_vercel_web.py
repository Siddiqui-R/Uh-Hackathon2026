"""Package the frontend independently of the npm workspace for Vercel."""
import json
import shutil
import sys
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "apps" / "web"
target = Path(sys.argv[1]).resolve()
shutil.copytree(source, target, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("node_modules", ".next", ".env*", "*.tsbuildinfo", ".vercel"))
package = json.loads((target / "package.json").read_text())
package["engines"] = {"node": "24.x"}
(target / "package.json").write_text(json.dumps(package, indent=2) + "\n")
print(f"Frontend packaged at {target}")
