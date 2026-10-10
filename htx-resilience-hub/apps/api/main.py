"""HTX Resilience Hub API. All data/provider integrations are scaffolds."""
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

if __package__:
    from .config import require_env
    from .models import AskRequest, AskResponse, HazardSummary
else:
    from config import require_env
    from models import AskRequest, AskResponse, HazardSummary


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    require_env("DATABASE_URL")
    yield


app = FastAPI(title="HTX Resilience Hub", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "mode": "scaffold"}


@app.get("/api/hazards", response_model=list[HazardSummary])
async def hazards() -> list[HazardSummary]:
    # TODO: Query latest station readings and history from Tiger Data by hazard.
    return [HazardSummary(hazard="flood"), HazardSummary(hazard="grid"), HazardSummary(hazard="air")]


@app.post("/api/ask", response_model=AskResponse)
async def ask(payload: AskRequest) -> AskResponse:
    # TODO: Send the question, hazard context, and user memory to Gemini.
    try:
        require_env("GEMINI_API_KEY")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    raise HTTPException(status_code=501, detail="Gemini integration is a scaffold; no provider request was sent.")


@app.get("/api/alerts")
async def alerts(request: Request) -> StreamingResponse:
    # TODO: Stream user-scoped alerts from database notifications or an event broker.
    async def events() -> AsyncIterator[str]:
        yield 'event: ready\ndata: {"mode":"scaffold"}\n\n'
        while not await request.is_disconnected():
            yield ": heartbeat\n\n"
            await asyncio.sleep(15)

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })
