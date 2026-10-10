"""EPA AirNow / TCEQ monitor ingestion scaffold."""
if __package__ == "ingest":
    from models import SensorReading
else:
    from ..models import SensorReading


async def poll_air() -> list[SensorReading]:
    # TODO: Poll EPA AirNow / TCEQ monitors using env credentials and persist normalized AQI readings.
    return []
