import { useEffect, useMemo, useState } from "react";
import { DownloadSimple, Play, X } from "@phosphor-icons/react";

const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const secondsLabel = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export function ScenarioPanel({ branches, runs, onClose, onRun, onCompare, onExport, onOverlayChange, onPreviewOption }) {
  const [draft, setDraft] = useState({ name: "Egress", model: "ingress-egress", mode: "normal", category: "registration", curve: "steady", seed: 73421, minutes: 30, samples: 256, population: 400, arrivals: 28, service: 9, servers: 3, accessShare: 8, branchId: branches.find((branch) => branch.active)?.id ?? branches[0]?.id ?? "" });
  const [overlayRunId, setOverlayRunId] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const completed = runs.filter((run) => run.status === "completed");
  const overlayRun = runs.find((run) => run.id === overlayRunId && run.status === "completed" && run.result?.model === "ingress-egress") ?? null;
  const frames = overlayRun?.result?.densityFrames ?? [];
  const activeFrame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))] ?? null;
  useEffect(() => {
    onOverlayChange?.(activeFrame ? { runId: overlayRun.id, branchId: overlayRun.branchId, frame: activeFrame, result: overlayRun.result } : null);
    return () => onOverlayChange?.(null);
  }, [activeFrame, onOverlayChange, overlayRun]);
  const comparison = useMemo(() => {
    if (completed.length < 2) return null;
    try { return onCompare(completed.at(-2).id, completed.at(-1).id); } catch { return null; }
  }, [completed, onCompare]);
  const update = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    const horizonSeconds = Math.max(60, numeric(draft.minutes, 60) * 60);
    const accessShare = Math.min(.5, Math.max(.01, numeric(draft.accessShare, 8) / 100));
    const curves = draft.curve === "front" ? {
      arrival: [{ second: 0, cumulativeShare: 0 }, { second: horizonSeconds * .1, cumulativeShare: .42 }, { second: horizonSeconds * .35, cumulativeShare: .9 }, { second: horizonSeconds, cumulativeShare: 1 }],
      departure: [{ second: 0, cumulativeShare: 0 }, { second: horizonSeconds * .03, cumulativeShare: .3 }, { second: horizonSeconds * .15, cumulativeShare: .9 }, { second: horizonSeconds * .35, cumulativeShare: 1 }, { second: horizonSeconds, cumulativeShare: 1 }],
    } : draft.curve === "late" ? {
      arrival: [{ second: 0, cumulativeShare: 0 }, { second: horizonSeconds * .45, cumulativeShare: .2 }, { second: horizonSeconds * .75, cumulativeShare: .8 }, { second: horizonSeconds, cumulativeShare: 1 }],
      departure: [{ second: 0, cumulativeShare: 0 }, { second: horizonSeconds * .1, cumulativeShare: .05 }, { second: horizonSeconds * .4, cumulativeShare: .6 }, { second: horizonSeconds * .75, cumulativeShare: 1 }, { second: horizonSeconds, cumulativeShare: 1 }],
    } : undefined;
    onRun({
      model: draft.model,
      id: `scenario-${String(draft.name || "operations").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "operations"}`,
      name: String(draft.name || "Operations"), seed: Math.max(0, Math.trunc(numeric(draft.seed, 1))), horizonSeconds, sampleCount: Math.max(1, Math.trunc(numeric(draft.samples, 256))),
      phases: [
        { id: "phase-ingress", label: "Ingress", startSecond: 0, endSecond: horizonSeconds / 3, demandShare: 0.65 },
        { id: "phase-program", label: "Program", startSecond: horizonSeconds / 3, endSecond: horizonSeconds * 2 / 3, demandShare: 0.1 },
        { id: "phase-egress", label: "Egress", startSecond: horizonSeconds * 2 / 3, endSecond: horizonSeconds, demandShare: 0.25 },
      ],
      inputs: { population: Math.max(1, Math.trunc(numeric(draft.population, 1))), arrivalRatePerMinute: Math.max(.1, numeric(draft.arrivals, 1)), serviceRatePerMinute: Math.max(.1, numeric(draft.service, 1)), servers: Math.max(1, Math.trunc(numeric(draft.servers, 1))), mobilityFactor: 1 },
      ...(draft.model === "ingress-egress" ? { ingressEgress: { mode: draft.mode, ...(curves ? { curves } : {}), mobilityProfiles: [{ id: "profile-standard", label: "Standard", share: 1 - accessShare, speedFactor: 1, accessibleRouteRequired: false }, { id: "profile-access", label: "Access", share: accessShare, speedFactor: .68, accessibleRouteRequired: true }] } } : {}),
      ...(draft.model === "queue" ? { queue: { category: draft.category, arrivalRatePerMinute: Math.max(.1, numeric(draft.arrivals, 1)), serviceRatePerServerMinute: Math.max(.1, numeric(draft.service, 1)), servers: Math.max(1, Math.trunc(numeric(draft.servers, 1))), bufferAreaM2: 12, abandonment: { enabled: true, meanPatienceSeconds: 480 }, priorityLanes: [{ id: "lane-access", label: "Access", arrivalShare: accessShare, servers: 1, serviceRatePerServerMinute: Math.max(.1, numeric(draft.service, 1)) }] } } : {}),
    }, draft.branchId);
  };
  return <aside className="scenario-panel" aria-label="Simulation scenarios">
    <header><div><span>SIMULATION</span><strong>SCENARIOS</strong></div><button type="button" onClick={onClose} aria-label="Close simulations"><X size={15} /></button></header>
    <form className="scenario-form" onSubmit={submit}>
      <label className="scenario-wide"><span>NAME</span><input value={draft.name} onChange={update("name")} /></label>
      <label className="scenario-wide"><span>BRANCH</span><select value={draft.branchId} onChange={update("branchId")}>{branches.filter((branch) => !branch.archived).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label><span>MODEL</span><select value={draft.model} onChange={update("model")}><option value="ingress-egress">FLOW</option><option value="queue">QUEUE</option><option value="operations">OPS</option></select></label><label><span>{draft.model === "queue" ? "TYPE" : "MODE"}</span>{draft.model === "queue" ? <select value={draft.category} onChange={update("category")}>{["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"].map((category) => <option key={category} value={category}>{category.toUpperCase()}</option>)}</select> : <select value={draft.mode} onChange={update("mode")} disabled={draft.model !== "ingress-egress"}><option value="normal">NORMAL</option><option value="emergency">EMERG</option></select>}</label>
      <label><span>SEED</span><input type="number" min="0" value={draft.seed} onChange={update("seed")} /></label><label><span>MIN</span><input type="number" min="1" value={draft.minutes} onChange={update("minutes")} /></label>
      <label><span>PEOPLE</span><input type="number" min="1" value={draft.population} onChange={update("population")} /></label><label><span>SAMPLES</span><input type="number" min="1" max="10000" value={draft.samples} onChange={update("samples")} /></label>
      <label><span>ARR/M</span><input type="number" min=".1" step=".1" value={draft.arrivals} onChange={update("arrivals")} /></label><label><span>{draft.model === "queue" ? "SVC/M" : "ACCESS %"}</span><input type="number" min={draft.model === "queue" ? ".1" : "1"} max={draft.model === "queue" ? undefined : "50"} step={draft.model === "queue" ? ".1" : "1"} value={draft.model === "queue" ? draft.service : draft.accessShare} onChange={update(draft.model === "queue" ? "service" : "accessShare")} disabled={draft.model === "operations"} /></label>
      <label><span>{draft.model === "ingress-egress" ? "CURVE" : "SERVERS"}</span>{draft.model === "ingress-egress" ? <select value={draft.curve} onChange={update("curve")}><option value="steady">STEADY</option><option value="front">FRONT</option><option value="late">LATE</option></select> : <input type="number" min="1" value={draft.servers} onChange={update("servers")} />}</label><button type="submit"><Play size={12} weight="fill" /> RUN</button>
    </form>
    {comparison && <section className="scenario-comparison"><span>DELTA · LAST 2</span>{"p95ClearanceSeconds" in comparison.deltas ? <><div><b>{comparison.deltas.p95ClearanceSeconds >= 0 ? "+" : ""}{comparison.deltas.p95ClearanceSeconds}s</b><small>P95 CLEAR</small></div><div><b>{comparison.deltas.worstBottleneckDurationSeconds >= 0 ? "+" : ""}{comparison.deltas.worstBottleneckDurationSeconds}s</b><small>BOTTLENECK</small></div><div><b>{comparison.deltas.accessibleRouteClearanceSeconds >= 0 ? "+" : ""}{comparison.deltas.accessibleRouteClearanceSeconds}s</b><small>ACCESS</small></div></> : "p95WaitSeconds" in comparison.deltas ? <><div><b>{comparison.deltas.p95WaitSeconds >= 0 ? "+" : ""}{comparison.deltas.p95WaitSeconds}s</b><small>P95 WAIT</small></div><div><b>{comparison.deltas.maximumQueueLength >= 0 ? "+" : ""}{comparison.deltas.maximumQueueLength}</b><small>MAX Q</small></div><div><b>{comparison.deltas.requiredBufferAreaM2 >= 0 ? "+" : ""}{comparison.deltas.requiredBufferAreaM2}m²</b><small>BUFFER</small></div></> : <><div><b>{comparison.deltas.meanProcessedPersons >= 0 ? "+" : ""}{comparison.deltas.meanProcessedPersons}</b><small>PROCESSED</small></div><div><b>{comparison.deltas.maximumP95BacklogPersons >= 0 ? "+" : ""}{comparison.deltas.maximumP95BacklogPersons}</b><small>P95 BACKLOG</small></div><div><b>{comparison.deltas.maximumP95Utilization >= 0 ? "+" : ""}{comparison.deltas.maximumP95Utilization}</b><small>P95 UTIL</small></div></>}</section>}
    {overlayRun && activeFrame && <section className="scenario-timeline"><header><span>DENSITY</span><b>{secondsLabel(activeFrame.second)}</b><div><button type="button" aria-label="Previous density frame" onClick={() => setFrameIndex((index) => Math.max(0, index - 1))} disabled={frameIndex === 0}>−</button><button type="button" aria-label="Next density frame" onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))} disabled={frameIndex >= frames.length - 1}>+</button><button type="button" onClick={() => { setOverlayRunId(null); setFrameIndex(0); }}>OFF</button></div></header><input aria-label="Density overlay time" type="range" min="0" max={Math.max(0, frames.length - 1)} value={Math.min(frameIndex, frames.length - 1)} onChange={(event) => setFrameIndex(Number(event.target.value))} /><footer><span>{activeFrame.peakDensityPersonsPerM2} P/M²</span><span>{Math.round(activeFrame.progress * 100)}%</span></footer></section>}
    <section className="scenario-runs"><div className="scenario-runs-title"><span>RUNS</span><b>{runs.length}</b></div>{runs.slice().reverse().map((run) => {
      const metrics = run.result?.summary ?? run.partialResult?.summary;
      const flow = run.result?.model === "ingress-egress" || run.partialResult?.model === "ingress-egress";
      const queue = run.result?.model === "queue" || run.partialResult?.model === "queue";
      return <article key={run.id} className={`scenario-run is-${run.status} ${overlayRunId === run.id ? "is-mapped" : ""}`}><header><span>{run.status.toUpperCase()}</span><code>{run.id}</code>{run.status === "completed" && <div className="scenario-run-actions">{flow && <button type="button" onClick={() => { setOverlayRunId(run.id); setFrameIndex(0); }} aria-label={`Map ${run.id}`}>MAP</button>}{queue && run.result?.suggestion?.preflight?.status === "spatially-valid" && <button type="button" onClick={() => onPreviewOption(run.id)} aria-label={`Preview option ${run.id}`}>OPTION</button>}<button type="button" onClick={() => onExport(run.id)} aria-label={`Export ${run.id}`}><DownloadSimple size={13} /></button></div>}</header><div className="scenario-progress"><i style={{ width: `${Math.round(run.progress * 100)}%` }} /></div><p>{run.branchId} · {run.model?.toUpperCase() ?? "OPS"} · {Math.round(run.progress * 100)}%</p>{metrics && <footer>{flow ? <><span><b>{secondsLabel(metrics.p95ClearanceSeconds)}</b><small>P95 CLEAR</small></span><span><b>{secondsLabel(metrics.worstBottleneckDurationSeconds)}</b><small>BOTTLENECK</small></span><span><b>{secondsLabel(metrics.accessibleRouteClearanceSeconds)}</b><small>ACCESS</small></span></> : queue ? <><span><b>{secondsLabel(metrics.p95WaitSeconds)}</b><small>P95 WAIT</small></span><span><b>{metrics.maximumQueueLength}</b><small>MAX Q</small></span><span><b>{metrics.overflowRisk?.toUpperCase()}</b><small>OVERFLOW</small></span></> : <><span><b>{metrics.meanProcessedPersons}</b><small>DONE</small></span><span><b>{metrics.maximumP95BacklogPersons}</b><small>P95 Q</small></span><span><b>{metrics.maximumP95Utilization}</b><small>P95 U</small></span></>}</footer>}</article>;
    })}</section>
  </aside>;
}
