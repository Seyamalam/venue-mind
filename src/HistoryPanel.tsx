import { useState, type SyntheticEvent } from "react";
import {
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  ColumnsIcon as Columns,
  GitBranchIcon as GitBranch,
  ListBulletsIcon as ListBullets,
  MapPinIcon as MapPin,
  PlusIcon as Plus,
  XIcon as X,
} from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import type { ActivityLedgerEntry } from "./domain/activity-ledger";
import type { VenueObject } from "./domain/geometry";
import type { ObjectLock } from "./domain/locks";
import type { ProposalBranch } from "./domain/venue-planner";
import type { ValueCallback, VoidCallback } from "./ui-types";

export type BranchView = Omit<ProposalBranch, "revisions"> & {
  active: boolean;
  stale: boolean;
  validationStatus: "pass" | "fail";
  changedItems: number;
  revisionCount: number;
  proposalId: string;
  baseVersion: string;
  revisions: Array<{ proposalId: string; revision: number; current: boolean }>;
};
export type LockView = ObjectLock & { label?: string };

type HistoryPanelProps = {
  open: boolean;
  version: string;
  versionEvents: ActivityLedgerEntry[];
  ledger: ActivityLedgerEntry[];
  activeBranches: BranchView[];
  branches: BranchView[];
  activeBranch?: BranchView | null;
  compareLeftBranchId: string;
  compareRightBranchId: string;
  branchRevisionSelections: Record<string, string>;
  planObjects: VenueObject[];
  activeLocks: LockView[];
  lockObjectId: string;
  lockType: string;
  lockReason: string;
  onClose: VoidCallback;
  onCompareLeftChange: ValueCallback;
  onCompareRightChange: ValueCallback;
  onCompareBranches: VoidCallback;
  onSwitchBranch: ValueCallback;
  onRevisionChange: (branchId: string, proposalId: string) => void;
  onDuplicateBranch: ValueCallback;
  onBranchArchive: (branch: BranchView) => void;
  onRebaseBranch: ValueCallback;
  onBranchMetadata: (branch: BranchView, changes: Partial<Pick<ProposalBranch, "name" | "notes">>) => void;
  onCreateBranch: VoidCallback;
  onLockObjectChange: ValueCallback;
  onLockTypeChange: ValueCallback;
  onLockReasonChange: ValueCallback;
  onAddLock: (event: SyntheticEvent<HTMLFormElement>) => void;
  onReleaseLock: ValueCallback;
};

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
}: HistoryPanelProps) {
  const [tab, setTab] = useState("versions");

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      modal={false}
    >
      <SheetContent
        className="history-drawer"
        side="right"
        showOverlay={false}
        showCloseButton={false}
        aria-label="Plan history"
      >
        <div className="history-heading">
          <div>
            <span className="eyebrow">Plan control</span>
            <SheetTitle asChild>
              <strong>v{version}</strong>
            </SheetTitle>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close plan history">
            <X />
          </Button>
        </div>
        <Tabs className="history-tabs-shell" value={tab} onValueChange={setTab}>
          <TabsList className="history-tabs" aria-label="Plan control views">
            <TabsTrigger value="versions">
              <ClockCounterClockwise /> Versions
            </TabsTrigger>
            <TabsTrigger value="ledger">
              <ListBullets /> Ledger
            </TabsTrigger>
            <TabsTrigger value="branches">
              <GitBranch /> Branches
            </TabsTrigger>
            <TabsTrigger value="locks">
              <MapPin /> Locks
            </TabsTrigger>
          </TabsList>

          {tab === "versions" && (
            <div className="history-list">
              {versionEvents.map((entry) => {
                const eventVersion = entry.details.toVersion ?? entry.details.version ?? version;
                return (
                  <div className="history-row" key={entry.id}>
                    <span className="history-node" />
                    <div>
                      <strong>v{eventVersion}</strong>
                      <small>{entry.type}</small>
                    </div>
                    <time>{entry.occurredAt.slice(11, 16)}</time>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "ledger" && (
            <div className="history-list">
              {ledger
                .slice()
                .reverse()
                .map((entry) => (
                  <div className="ledger-row" key={entry.id}>
                    <span className={`actor-badge is-${entry.actor}`}>
                      {entry.actor === "agent" ? "AI" : entry.actor === "human" ? "HU" : "SY"}
                    </span>
                    <div>
                      <strong>{entry.type}</strong>
                      <small>#{String(entry.sequence).padStart(3, "0")}</small>
                    </div>
                    <time>{entry.occurredAt.slice(11, 16)}</time>
                  </div>
                ))}
            </div>
          )}

          {tab === "branches" && (
            <div className="branch-panel">
              <div className="branch-compare-controls">
                <label>
                  <span>A</span>
                  <Select value={compareLeftBranchId} onValueChange={onCompareLeftChange}>
                    <SelectTrigger aria-label="Comparison branch A">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="history-select-content" position="popper">
                      <SelectGroup>
                        {activeBranches.map((branch) => (
                          <SelectItem value={branch.id} key={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>B</span>
                  <Select value={compareRightBranchId} onValueChange={onCompareRightChange}>
                    <SelectTrigger aria-label="Comparison branch B">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="history-select-content" position="popper">
                      <SelectGroup>
                        {activeBranches.map((branch) => (
                          <SelectItem value={branch.id} key={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <Button
                  variant="outline"
                  type="button"
                  disabled={activeBranches.length < 2 || compareLeftBranchId === compareRightBranchId}
                  onClick={onCompareBranches}
                >
                  <Columns data-icon="inline-start" /> Compare
                </Button>
              </div>
              <div className="branch-list">
                {branches.map((branch) => (
                  <div
                    className={`branch-entry ${branch.active ? "active" : ""} ${branch.archived ? "is-archived" : ""}`}
                    key={branch.id}
                  >
                    <Button
                      variant="outline"
                      type="button"
                      className={`branch-card ${branch.active ? "active" : ""}`}
                      disabled={branch.archived}
                      onClick={() => onSwitchBranch(branch.id)}
                    >
                      <span>
                        <GitBranch data-icon="inline-start" />
                        <strong>{branch.name}</strong>
                      </span>
                      <span className={`branch-status is-${branch.stale ? "fail" : branch.validationStatus}`}>
                        {branch.archived
                          ? "ARCH"
                          : branch.decisionStatus
                            ? branch.decisionStatus.toUpperCase()
                            : branch.stale
                              ? "STALE"
                              : branch.validationStatus.toUpperCase()}
                      </span>
                      <small>
                        {branch.changedItems} CHG · {branch.revisionCount} REV
                      </small>
                      <b>v{branch.baseVersion}</b>
                    </Button>
                    <div className="branch-actions">
                      <Select
                        value={branchRevisionSelections[branch.id] ?? branch.proposalId}
                        onValueChange={(value) => onRevisionChange(branch.id, value)}
                      >
                        <SelectTrigger aria-label={`${branch.name} revision`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="history-select-content is-revision" position="popper">
                          <SelectGroup>
                            {branch.revisions.toReversed().map((revision) => (
                              <SelectItem key={revision.proposalId} value={revision.proposalId}>
                                R{revision.revision}
                                {revision.current ? "·" : ""}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="xs" type="button" onClick={() => onDuplicateBranch(branch.id)}>
                        DUP
                      </Button>
                      <Button variant="outline" size="xs" type="button" onClick={() => onBranchArchive(branch)}>
                        {branch.archived ? "RST" : "ARC"}
                      </Button>
                      {branch.stale && !branch.archived && (
                        <Button variant="outline" size="xs" type="button" onClick={() => onRebaseBranch(branch.id)}>
                          RBS
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {activeBranch && (
                <div className="branch-meta">
                  <Input
                    key={`${activeBranch.id}-${activeBranch.name}`}
                    aria-label="Branch name"
                    defaultValue={activeBranch.name}
                    onBlur={(event) => onBranchMetadata(activeBranch, { name: event.currentTarget.value })}
                  />
                  <Textarea
                    key={`${activeBranch.id}-${activeBranch.notes}`}
                    aria-label="Branch notes"
                    placeholder="NOTES"
                    defaultValue={activeBranch.notes}
                    onBlur={(event) => onBranchMetadata(activeBranch, { notes: event.currentTarget.value })}
                  />
                </div>
              )}
              <Button className="new-branch" variant="outline" type="button" onClick={onCreateBranch}>
                <Plus data-icon="inline-start" /> New branch
              </Button>
            </div>
          )}

          {tab === "locks" && (
            <div className="lock-panel">
              <form className="lock-form" onSubmit={onAddLock}>
                <Select value={lockObjectId} onValueChange={onLockObjectChange}>
                  <SelectTrigger aria-label="Lock object">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="history-select-content" position="popper">
                    <SelectGroup>
                      {planObjects.map((object) => (
                        <SelectItem key={object.id} value={object.id}>
                          {object.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Select value={lockType} onValueChange={onLockTypeChange}>
                  <SelectTrigger aria-label="Lock type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="history-select-content" position="popper">
                    <SelectGroup>
                      {["position", "rotation", "dimension", "deletion", "role"].map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Lock reason code"
                  value={lockReason}
                  onChange={(event) => onLockReasonChange(event.target.value)}
                  required
                />
                <Button type="submit">Add lock</Button>
              </form>
              <div className="lock-list">
                {activeLocks.map((lock) => (
                  <div className={`lock-row is-${lock.source}`} key={lock.id}>
                    <span>
                      <strong>{lock.label}</strong>
                      <small>{lock.objectId}</small>
                    </span>
                    <b>{lock.type.toUpperCase()}</b>
                    <em>{lock.source === "project" ? "PROJECT" : "TEMPLATE"}</em>
                    {lock.source === "project" && (
                      <Button variant="ghost" size="xs" type="button" onClick={() => onReleaseLock(lock.id)}>
                        Release
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
