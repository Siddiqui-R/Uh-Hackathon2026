"""Run local web, API and workers together; secrets stay in the ignored root .env."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from dotenv import load_dotenv

def main() -> None:
    root=Path(__file__).resolve().parents[1]
    load_dotenv(root/".env")
    node=shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    web_port=os.getenv("HTX_WEB_PORT","3000")
    commands=[
        ("api",[sys.executable,"-m","apps.api.run"],root),
        ("workers",[sys.executable,"-m","apps.api.workers"],root),
        ("web",[node,str(root/"node_modules/next/dist/bin/next"),"dev","--port",web_port],root/"apps/web")]
    processes=[]
    try:
        for name,command,cwd in commands:
            processes.append((name,subprocess.Popen(command,cwd=cwd)))
        print(f"Noach Select: http://localhost:{web_port} (API: 8000; supervised local workers)",flush=True)
        while all(process.poll() is None for _,process in processes):
            time.sleep(1)
        failed=[f"{name} (exit {process.returncode})" for name,process in processes if process.poll() is not None]
        raise RuntimeError("Service exited: "+", ".join(failed))
    except KeyboardInterrupt:
        pass
    finally:
        for _,process in processes:
            process.terminate()
        for _,process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

if __name__=="__main__":
    main()
