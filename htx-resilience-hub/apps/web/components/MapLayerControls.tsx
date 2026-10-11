import type { AreaConditions, GridStatus, HazardReading } from "@/lib/types";
import { forecastFreshness, forecastTime } from "@/lib/forecastPresentation";
import { gridAvailable, layerAvailable, layerValidTime, modelLayers, type ModelLayer } from "@/lib/mapLayers";

export interface MapLayerControlProps {
  area: AreaConditions | null; readings: HazardReading[]; grid?: GridStatus; gaugeMode?: string; timezone: string;
  layers: Record<ModelLayer, boolean>; shade: ModelLayer; gauges: boolean; places: boolean; showGrid: boolean;
  onLayer: (layer: ModelLayer, enabled: boolean) => void; onShade: (layer: ModelLayer) => void;
  onGauges: (enabled: boolean) => void; onPlaces: (enabled: boolean) => void; onGrid: (enabled: boolean) => void;
}

export default function MapLayerControls(props: MapLayerControlProps) {
  const { area, layers, grid, timezone, readings } = props;
  const enabled = (Object.keys(modelLayers) as ModelLayer[]).filter((key) => layers[key] && layerAvailable(area, key));
  const gaugeRows = readings.filter((row) => row.metric.toLowerCase().includes("gage height") && Number.isFinite(row.value));
  const simulated = props.gaugeMode === "demo" || (gaugeRows.length > 0 && gaugeRows.every((row) => /demo/i.test(row.station_name)));
  return <div className="layer-desk">
    <fieldset className="layer-controls"><legend>Map layers <span>Toggle independently</span></legend>
      {(Object.keys(modelLayers) as ModelLayer[]).map((key) => {
        const available = layerAvailable(area, key), layer = modelLayers[key];
        return <label className={`layer-toggle${available && layers[key] ? " is-selected" : ""}`} key={key}>
          <input type="checkbox" checked={available && layers[key]} disabled={!available} onChange={(event) => props.onLayer(key, event.target.checked)} />
          <span><strong>{layer.label}</strong><small>{available ? area?.source_status[layer.source] === "demo" ? "Illustrative demo" : "Modeled forecast" : area ? "Unavailable · no validated values" : "Awaiting model data"}</small></span>
        </label>;
      })}
      <label className={`layer-toggle${props.gauges && gaugeRows.length ? " is-selected" : ""}`}><input type="checkbox" checked={props.gauges && Boolean(gaugeRows.length)} disabled={!gaugeRows.length} onChange={(event) => props.onGauges(event.target.checked)} /><span><strong>Bayou gauges</strong><small>{!gaugeRows.length ? "Unavailable · no readings" : simulated ? "Simulated data" : "USGS observations"}</small></span></label>
      <label className={`layer-toggle${props.showGrid && gridAvailable(grid) ? " is-selected" : ""}`}><input type="checkbox" checked={props.showGrid && gridAvailable(grid)} disabled={!gridAvailable(grid)} onChange={(event) => props.onGrid(event.target.checked)} /><span><strong>Power grid</strong><small>{gridAvailable(grid) ? forecastFreshness(grid?.updated).startsWith("Stale") ? "ERCOT · stale statewide report" : "ERCOT statewide report" : grid?.status === "demo" ? "Unavailable · simulation only" : grid?.status === "live" ? "Unavailable · report time missing" : "Unavailable · no report available"}</small></span></label>
      <label className={`layer-toggle${props.places ? " is-selected" : ""}`}><input type="checkbox" checked={props.places} onChange={(event) => props.onPlaces(event.target.checked)} /><span><strong>Saved places</strong><small>Your planning locations</small></span></label>
    </fieldset>
    <div className="layer-tools">{enabled.length > 0 && <label>Color fill<select value={enabled.includes(props.shade) ? props.shade : enabled[0]} onChange={(event) => props.onShade(event.target.value as ModelLayer)}>{enabled.map((key) => <option key={key} value={key}>{modelLayers[key].label}</option>)}</select></label>}<span className="tiny">{enabled.length ? "Other enabled layers appear as labeled values." : "Base map and available markers remain visible."}</span></div>
    <details className="layer-sources"><summary>Layer sources and times</summary>
      {(Object.keys(modelLayers) as ModelLayer[]).map((key) => <p key={key}><strong>{modelLayers[key].label}</strong> / {area?.source_status[modelLayers[key].source] === "demo" ? "Illustrative demo values" : `${modelLayers[key].provider} · modeled forecast`} · {layerValidTime(area, key, timezone)} · retrieved {forecastTime(area?.generated_at, timezone)} · {forecastFreshness(area?.generated_at)}</p>)}
      <p><strong>Bayou gauges</strong> / {simulated ? "Simulation" : "USGS observed gage height"} · ft · {gaugeRows.length ? "Observed times are shown on each gauge." : "No readings available."} No road-safety assessment.</p>
      <p><strong>Power grid</strong> / {grid?.status === "demo" ? "Simulation only" : "ERCOT statewide report"} · reported {forecastTime(grid?.updated, timezone)} · {gridAvailable(grid) ? forecastFreshness(grid?.updated) : "Unavailable"}. No local outages or geographic grid readings.</p>
      {grid?.source_url && <a href={grid.source_url} target="_blank" rel="noreferrer">ERCOT source ↗</a>}
      <p>Model cells cover about 11 km. A selected color fill represents one layer; enabled value labels stay separate. Address search uses OpenStreetMap Nominatim. Your device location places a temporary pin.</p>
      {area?.cells.filter((cell) => cell.data_quality_notes?.length).length ? <details><summary>Model data-quality notes</summary>{area.cells.filter((cell) => cell.data_quality_notes?.length).map((cell) => <p key={`${cell.lat},${cell.lon}`}>{cell.lat}, {cell.lon} · air valid {forecastTime(cell.valid_at?.air, timezone)} · weather valid {forecastTime(cell.valid_at?.weather, timezone)} · {cell.data_quality_notes?.join(" ")}</p>)}</details> : null}
    </details>
  </div>;
}
