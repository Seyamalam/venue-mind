import { useState } from "react";
import { ClockCounterClockwise, Columns, GitBranch, ListBullets, MapPin, Plus, X } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

export function HistoryPanel({
  open,
  version,
  versionEvents,
  ledger,
  activeBranches,
  branches,
  activeBranch,
  compareLeftBranchId,
  compareRightBranchId,
  branchRevisionSelections,
  planObjects,
  activeLocks,
  lockObjectId,
  lockType,
  lockReason,
  onClose,
  onCompareLeftChange,
  onCompareRightChange,
  onCompareBranches,
  onSwitchBranch,
  onRevisionChange,
  onDuplicateBranch,
  onBranchArchive,
  onRebaseBranch,
  onBranchMetadata,
  onCreateBranch,
  onLockObjectChange,
  onLockTypeChange,
  onLockReasonChange,
  onAddLock,
  onReleaseLock,
}) {
  const [tab, setTab] = useState("versions");

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} modal={false}>
      <SheetContent className="history-drawer" side="right" showOverlay={false} showCloseButton={false} aria-label="Plan history">
        <div className="history-heading"><div><span className="eyebrow">Plan control</span><SheetTitle asChild><strong>v{version}</strong></SheetTitle></div><button type="button" onClick={onClose} aria-label="Close plan history"><X size={18} /></button></div>
        <Tabs className="history-tabs-shell" value={tab} onValueChange={setTab}>
          <TabsList className="history-tabs" aria-label="Plan control views">
            <TabsTrigger value="versions"><ClockCounterClockwise size={15} /> Versions</TabsTrigger>
            <TabsTrigger value="ledger"><ListBullets size={15} /> Ledger</TabsTrigger>
            <TabsTrigger value="branches"><GitBranch size={15} /> Branches</TabsTrigger>
            <TabsTrigger value="locks"><MapPin size={15} /> Locks</TabsTrigger>
          </TabsList>

          {tab === "versions" && <div className="history-list">{versionEvents.map((entry) => {
            const eventVersion = entry.details.toVersion ?? entry.details.version ?? version;
            return <div className="history-row" key={entry.id}><span className="history-node" /><div><strong>v{eventVersion}</strong><small>{entry.type}</small></div><time>{entry.occurredAt.slice(11, 16)}</time></div>;
          })}</div>}

          {tab === "ledger" && <div className="history-list">{ledger.slice().reverse().map((entry) => <div className="ledger-row" key={entry.id}><span className={`actor-badge is-${entry.actor}`}>{entry.actor === "agent" ? "AI" : entry.actor === "human" ? "HU" : "SY"}</span><div><strong>{entry.type}</strong><small>#{String(entry.sequence).padStart(3, "0")}</small></div><time>{entry.occurredAt.slice(11, 16)}</time></div>)}</div>}

          {tab === "branches" && <div className="branch-panel">
            <div className="branch-compare-controls"><label><span>A</span><select aria-label="Comparison branch A" value={compareLeftBranchId} onChange={(event) => onCompareLeftChange(event.target.value)}>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label><span>B</span><select aria-label="Comparison branch B" value={compareRightBranchId} onChange={(event) => onCompareRightChange(event.target.value)}>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><button type="button" disabled={activeBranches.length < 2 || compareLeftBranchId === compareRightBranchId} onClick={onCompareBranches}><Columns size={14} /> Compare</button></div>
            <div className="branch-list">{branches.map((branch) => <div className={`branch-entry ${branch.active ? "active" : ""} ${branch.archived ? "is-archived" : ""}`} key={branch.id}><button type="button" className={`branch-card ${branch.active ? "active" : ""}`} disabled={branch.archived} onClick={() => onSwitchBranch(branch.id)}><span><GitBranch size={15} /><strong>{branch.name}</strong></span><span className={`branch-status is-${branch.stale ? "fail" : branch.validationStatus}`}>{branch.archived ? "ARCH" : branch.decisionStatus ? branch.decisionStatus.toUpperCase() : branch.stale ? "STALE" : branch.validationStatus.toUpperCase()}</span><small>{branch.changedItems} CHG · {branch.revisionCount} REV</small><b>v{branch.baseVersion}</b></button><div className="branch-actions"><select aria-label={`${branch.name} revision`} value={branchRevisionSelections[branch.id] ?? branch.proposalId} onChange={(event) => onRevisionChange(branch.id, event.target.value)}>{branch.revisions.toReversed().map((revision) => <option key={revision.proposalId} value={revision.proposalId}>R{revision.revision}{revision.current ? "·" : ""}</option>)}</select><button type="button" onClick={() => onDuplicateBranch(branch.id)}>DUP</button><button type="button" onClick={() => onBranchArchive(branch)}>{branch.archived ? "RST" : "ARC"}</button>{branch.stale && !branch.archived && <button type="button" onClick={() => onRebaseBranch(branch.id)}>RBS</button>}</div></div>)}</div>
            {activeBranch && <div className="branch-meta"><input key={`${activeBranch.id}-${activeBranch.name}`} aria-label="Branch name" defaultValue={activeBranch.name} onBlur={(event) => onBranchMetadata(activeBranch, { name: event.currentTarget.value })} /><textarea key={`${activeBranch.id}-${activeBranch.notes}`} aria-label="Branch notes" placeholder="NOTES" defaultValue={activeBranch.notes} onBlur={(event) => onBranchMetadata(activeBranch, { notes: event.currentTarget.value })} /></div>}
            <button className="new-branch" type="button" onClick={onCreateBranch}><Plus size={16} /> New branch</button>
          </div>}

          {tab === "locks" && <div className="lock-panel"><form className="lock-form" onSubmit={onAddLock}><select aria-label="Lock object" value={lockObjectId} onChange={(event) => onLockObjectChange(event.target.value)}>{planObjects.map((object) => <option key={object.id} value={object.id}>{object.label}</option>)}</select><select aria-label="Lock type" value={lockType} onChange={(event) => onLockTypeChange(event.target.value)}>{["position", "rotation", "dimension", "deletion", "role"].map((type) => <option key={type}>{type}</option>)}</select><input aria-label="Lock reason code" value={lockReason} onChange={(event) => onLockReasonChange(event.target.value)} required /><button type="submit">Add lock</button></form><div className="lock-list">{activeLocks.map((lock) => <div className={`lock-row is-${lock.source}`} key={lock.id}><span><strong>{lock.label}</strong><small>{lock.objectId}</small></span><b>{lock.type.toUpperCase()}</b><em>{lock.source === "project" ? "PROJECT" : "TEMPLATE"}</em>{lock.source === "project" && <button type="button" onClick={() => onReleaseLock(lock.id)}>Release</button>}</div>)}</div></div>}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
