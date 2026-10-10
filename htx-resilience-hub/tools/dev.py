"""Run local web, API and workers together; secrets stay in the ignored root .env."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

def main() -> None:
    root=Path(__file__).resolve().parents[1]
    node=shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    commands=[
        ([sys.executable,"-m","apps.api.run"],root),
        ([sys.executable,"-m","apps.api.workers"],root),
        ([node,str(root/"node_modules/next/dist/bin/next"),"dev","--port","3000"],root/"apps/web")]
    processes=[]
    try:
        for command,cwd in commands:
            processes.append(subprocess.Popen(command,cwd=cwd,creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0))
        print("noach.select: http://localhost:3000 (API: 8000; supervised local workers)",flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        raise RuntimeError("A service exited; inspect its output")
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

if __name__=="__main__":
    main()
