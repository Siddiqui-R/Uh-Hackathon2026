"""Run a database-free local rehearsal on port 3001 with explicitly temporary data."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from dotenv import load_dotenv


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    env = os.environ.copy()
    env.update(NOACH_DEMO_MODE="true", NOACH_DEMO_STORAGE="memory", NOACH_ENV="development",
               HOSTING_PROVIDER="local temporary demo", API_BASE_URL="http://127.0.0.1:8000")
    commands = [([sys.executable, "-m", "apps.api.run"], root),
                ([node, str(root / "node_modules/next/dist/bin/next"), "dev", "--port", "3001"], root / "apps/web")]
    processes: list[subprocess.Popen] = []
    try:
        for command, cwd in commands:
            processes.append(subprocess.Popen(command, cwd=cwd, env=env))
        print("Noach temporary local rehearsal: http://localhost:3001 (API: 8000)", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        raise RuntimeError("A rehearsal service exited; inspect its output")
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
