"""Harris County rainfall and bayou gauge ingestion scaffold."""
if __package__ == "ingest":
    from models import SensorReading
else:
    from ..models import SensorReading


async def poll_flood() -> list[SensorReading]:
    # TODO: Poll Harris County rain/bayou gauges, normalize units, and persist readings.
    return []
