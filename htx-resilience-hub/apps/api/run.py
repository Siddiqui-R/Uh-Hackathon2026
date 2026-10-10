"""Portable local server launcher, including psycopg's Windows selector loop."""
import asyncio
import os
import uvicorn
from .main import app

def loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop()

def main() -> None:
    uvicorn.run(app,host="127.0.0.1",port=int(os.getenv("PORT","8000")),loop="apps.api.run:loop_factory")

if __name__ == "__main__":
    main()
