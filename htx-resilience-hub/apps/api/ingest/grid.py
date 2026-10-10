"""ERCOT grid conditions ingestion scaffold."""
if __package__ == "ingest":
    from models import SensorReading
else:
    from ..models import SensorReading


async def poll_grid() -> list[SensorReading]:
    # TODO: Fetch ERCOT conditions, parse reserve/capacity metrics, and persist readings.
    return []
