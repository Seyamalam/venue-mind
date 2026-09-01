import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, ArrowRight, CheckCircle, CircleNotch, Clock, Copy, DotsThreeVertical, FolderOpen, MagnifyingGlass, PencilSimple, Plus, PushPin, SlidersHorizontal, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { createProjectStore } from "./persistence/project-store.js";
import { browserNavigate, navigateInternalLink } from "./navigation.js";
import "./project-dashboard.css";

const ArchiveBox = Archive;

const projectVersion = (project) => project.snapshot?.plan?.version ?? "—";
const projectEvent = (project) => project.snapshot?.plan?.event ?? { attendeeTarget: 0, date: null };
const projectValidation = (project) => {
  if (!project.snapshot?.plan || !project.snapshot?.proposal) return "SYNC";
  const activeBranch = project.snapshot.branches?.find((branch) => branch.id === project.snapshot.activeBranchId);
  return (activeBranch?.proposal?.validation?.status ?? project.snapshot.proposal.validation?.status ?? "CHECK").toUpperCase();
};

export function ProjectDashboard({ organizationId = "org-local", account, accountStore, navigate = browserNavigate }) {
  const store = useMemo(() => createProjectStore({ organizationId }), [organizationId]);
  const [projects, setProjects] = useState([]);
  const [source, setSource] = useState("SYNC");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [viewFilter, setViewFilter] = useState("ACTIVE");
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const importInput = useRef(null);

  useEffect(() => {
    let cancelled = false;
    store.list().then((result) => {
      if (cancelled) return;
      setProjects(result.projects);
      setSource(result.source === "remote" ? "SYNC" : "LOCAL");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [store]);

  useEffect(() => { document.title = "Projects · VenueMind"; }, []);

  const visibleProjects = useMemo(() => projects
    .filter((project) => viewFilter === "ACTIVE" ? !project.archivedAt && !project.deletedAt : viewFilter === "ARCHIVED" ? project.archivedAt && !project.deletedAt : Boolean(project.deletedAt))
    .filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((project) => statusFilter === "ALL" || projectValidation(project) === statusFilter)
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (sort === "name" ? left.name.localeCompare(right.name) : String(right.lastOpenedAt ?? right.updatedAt).localeCompare(String(left.lastOpenedAt ?? left.updatedAt)))), [projects, query, sort, statusFilter, viewFilter]);

  const replaceProject = (record) => setProjects((current) => current.map((project) => project.id === record.id ? record : project));
  const openProject = async (project) => {
    const result = await store.updateMetadata(project.id, { lastOpenedAt: new Date().toISOString() });
    replaceProject(result.record);
    navigate(`/studio/${encodeURIComponent(project.id)}`);
  };
  const openRename = (project) => {
    setRenameTarget(project);
    setRenameValue(project.name);
  };
  const closeRename = () => {
    if (renaming) return;
    setRenameTarget(null);
    setRenameValue("");
  };
  const renameProject = async (event) => {
    event.preventDefault();
    const project = renameTarget;
    const name = renameValue.trim();
    if (!project || !name || name === project.name || renaming) return;
    setRenaming(true);
    try {
      replaceProject((await store.rename(project.id, name)).record);
      setRenameTarget(null);
      setRenameValue("");
    } catch (error) {
      setImportError(error.code ?? "RENAME_FAILED");
    } finally {
      setRenaming(false);
    }
  };
  const duplicateProject = async (project) => {
    const { duplicateProjectRecord } = await import("./domain/project-lifecycle.js");
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const record = duplicateProjectRecord(project, { projectId: `project-${token}`, name: `${project.name} Copy` });
    const created = await store.importProject(record);
    setProjects((current) => [created.record, ...current]);
  };
  const archiveProject = async (project, archived) => replaceProject((await store.archive(project.id, archived)).record);
  const pinProject = async (project) => replaceProject((await store.pin(project.id, !project.pinned)).record);
  const openDelete = (project) => {
    setDeleteTarget(project);
    setDeleteConfirmation("");
  };
  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteConfirmation("");
  };
  const deleteProject = async (event) => {
    event.preventDefault();
    const project = deleteTarget;
    if (!project || deleteConfirmation !== project.name || deleting) return;
    setDeleting(true);
    try {
      replaceProject((await store.softDelete(project.id, deleteConfirmation)).record);
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (error) {
      setImportError(error.code ?? "DELETE_FAILED");
    } finally {
      setDeleting(false);
    }
  };
  const restoreProject = async (project) => replaceProject((await store.restoreDeleted(project.id)).record);

  const createProject = async () => {
    if (creating) return;
    setCreating(true);
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const projectId = `project-${token}`;
    const name = `Untitled ${String(projects.length + 1).padStart(2, "0")}`;
    const [{ createEmptyVenuePlan }, { createVenuePlanner }] = await Promise.all([
      import("./domain/empty-project.js"),
      import("./domain/venue-planner.js"),
    ]);
    const plan = createEmptyVenuePlan({ projectId, name });
    const planner = createVenuePlanner(plan);
    const saved = await store.save({ id: projectId, name, activePlanId: plan.id, snapshot: planner.getSnapshot() });
    openProject(saved.record);
  };

  const inspectImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    try {
      const { previewProjectImport } = await import("./interchange/venue-package.js");
      const preview = await previewProjectImport(await file.text());
      setImportPreview({ ...preview, idConflict: projects.some((project) => project.id === preview.record.id) });
    } catch (error) {
      setImportPreview(null);
      setImportError(error.code ?? "IMPORT_INVALID");
    } finally {
      event.target.value = "";
    }
  };

  const commitImport = async () => {
    if (!importPreview || importPreview.idConflict || importing) return;
    setImporting(true);
    setImportError("");
    try {
      const result = await store.importProject(importPreview.record);
      openProject(result.record);
    } catch (error) {
      setImportError(error.code ?? "IMPORT_FAILED");
      setImporting(false);
    }
  };

  return (
    <div className="projects-shell">
      <header className="projects-header">
        <a className="projects-brand" href="/" onClick={(event) => navigateInternalLink(event, navigate, "/")}><img src="/assets/venuemind-mark.webp" alt="" /><strong>VenueMind</strong></a>
        <nav><select aria-label="Organization" value={organizationId} onChange={(event) => accountStore?.selectOrganization(event.target.value)}>{account?.organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select><a href="/docs" onClick={(event) => navigateInternalLink(event, navigate, "/docs")}>Docs</a><span>{source}</span><a className="account-chip" href="/settings/organization" onClick={(event) => navigateInternalLink(event, navigate, "/settings/organization")}>{account?.user?.displayName?.slice(0, 2).toUpperCase() || "ID"}</a></nav>
      </header>

      <main className="projects-main">
        <section className="projects-titlebar">
          <div><span className="projects-kicker">Workspace index</span><h1>Projects</h1></div>
          <div className="projects-total"><strong>{projects.length}</strong><span>ACTIVE</span></div>
          <div className="projects-actions"><input ref={importInput} type="file" accept="application/json,.json" onChange={inspectImport} /><button className="import-project" type="button" onClick={() => importInput.current?.click()}><UploadSimple size={18} />IMPORT</button><button className="new-project" type="button" onClick={createProject} disabled={creating}>{creating ? <CircleNotch className="spin" size={18} /> : <Plus size={18} weight="bold" />}NEW PROJECT</button></div>
        </section>

        <section className="projects-controls" aria-label="Project controls">
          <label><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH" aria-label="Search projects" /></label>
          <button type="button" onClick={() => setSort((current) => current === "recent" ? "name" : "recent")}><SlidersHorizontal size={16} />{sort === "recent" ? "RECENT" : "NAME"}</button>
          <button type="button" onClick={() => setStatusFilter((current) => current === "ALL" ? "PASS" : current === "PASS" ? "CHECK" : "ALL")}>{statusFilter}</button>
          <button type="button" onClick={() => setViewFilter((current) => current === "ACTIVE" ? "ARCHIVED" : current === "ARCHIVED" ? "RECOVERY" : "ACTIVE")}>{viewFilter}</button>
          <span>{visibleProjects.length} SHOWN</span>
        </section>

        {loading ? (
          <div className="projects-state"><CircleNotch className="spin" size={22} /><strong>SYNC</strong></div>
        ) : visibleProjects.length === 0 ? (
          <button className="projects-empty" type="button" onClick={createProject}><FolderOpen size={28} /><strong>0 PROJECTS</strong><span>NEW PROJECT</span></button>
        ) : (
          <section className="project-grid" aria-label="Projects">
            {visibleProjects.map((project, index) => {
              const event = projectEvent(project);
              const status = projectValidation(project);
              const projectHref = `/studio/${encodeURIComponent(project.id)}`;
              return (
                <article className={`project-sheet${project.deletedAt ? " is-deleted" : ""}`} key={project.id}>
                  {!project.deletedAt && <a className="project-sheet-link" href={projectHref} aria-label={`Open ${project.name}`} onClick={(eventClick) => navigateInternalLink(eventClick, () => void openProject(project), projectHref)} />}
                  <span className="sheet-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="sheet-version"><small>PLAN</small><strong>v{projectVersion(project)}</strong></span>
                  <span className={`sheet-status is-${status.toLowerCase()}`}>{status}</span>
                  <strong className="sheet-name">{project.name}</strong>
                  <span className="sheet-proposal">{project.snapshot?.proposal?.status?.toUpperCase() ?? "—"}</span>
                  <span className="sheet-meta"><b>{event.attendeeTarget ?? 0}</b> PAX</span>
                  <span className="sheet-meta"><Clock size={13} />{project.updatedAt?.slice(0, 10) ?? "—"}</span>
                  <span className="sheet-open">OPEN <ArrowRight size={15} /></span>
                  <DropdownMenu>
                    <span className="sheet-actions">
                      <DropdownMenuTrigger asChild><button type="button" aria-label={`Project actions: ${project.name}`}><DotsThreeVertical size={16} weight="bold" /></button></DropdownMenuTrigger>
                    </span>
                    <DropdownMenuContent className="project-action-menu" align="end" sideOffset={6}>
                      {project.deletedAt ? (
                        <DropdownMenuItem className="project-action-item" onSelect={() => void restoreProject(project)}><ArrowCounterClockwise />RESTORE</DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem className="project-action-item" onSelect={() => void pinProject(project)}><PushPin weight={project.pinned ? "fill" : "regular"} />{project.pinned ? "UNPIN" : "PIN"}</DropdownMenuItem>
                          <DropdownMenuItem className="project-action-item" onSelect={() => openRename(project)}><PencilSimple />RENAME</DropdownMenuItem>
                          <DropdownMenuItem className="project-action-item" onSelect={() => void duplicateProject(project)}><Copy />DUPLICATE</DropdownMenuItem>
                          <DropdownMenuItem className="project-action-item" onSelect={() => void archiveProject(project, !project.archivedAt)}>{project.archivedAt ? <ArrowCounterClockwise /> : <ArchiveBox />}{project.archivedAt ? "RESTORE" : "ARCHIVE"}</DropdownMenuItem>
                          <DropdownMenuSeparator className="project-action-separator" />
                          <DropdownMenuItem className="project-action-item is-destructive" variant="destructive" onSelect={() => openDelete(project)}><Trash />DELETE</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="sheet-rail" aria-hidden="true"><i /><i /><i /></span>
                </article>
              );
            })}
          </section>
        )}
      </main>
      <Sheet open={Boolean(importPreview)} onOpenChange={(open) => { if (!open && !importing) setImportPreview(null); }}>
        {importPreview && <SheetContent className="import-preview !h-auto !gap-0 !p-0 sm:!max-w-none" side="right" showOverlay={false} showCloseButton={false} aria-label="Import Preview">
          <div className="import-preview-heading"><div><span className="projects-kicker">IMPORT</span><SheetTitle asChild><strong>{importPreview.packageId}</strong></SheetTitle><SheetDescription className="sr-only">Project package validation and import controls</SheetDescription></div><Button variant="ghost" size="icon" type="button" onClick={() => setImportPreview(null)} disabled={importing} aria-label="Close Import Preview"><X size={19} /></Button></div>
          <div className="import-preview-status"><CheckCircle size={24} weight="fill" /><div><strong>{importPreview.idConflict ? "ID CONFLICT" : "READY"}</strong><small>{importPreview.integrity.checksum.toUpperCase()} · {importPreview.integrity.ledger.toUpperCase()} · {importPreview.integrity.replay.toUpperCase()}</small></div></div>
          <div className="import-preview-project"><span>PROJECT</span><strong>{importPreview.summary.projectName}</strong><code>{importPreview.summary.projectId}</code></div>
          <div className="import-preview-grid"><div><small>PLAN</small><strong>v{importPreview.summary.planVersion}</strong></div><div><small>OBJECTS</small><strong>{importPreview.summary.objects}</strong></div><div><small>CONSTRAINTS</small><strong>{importPreview.summary.constraints}</strong></div><div><small>BRANCHES</small><strong>{importPreview.summary.branches}</strong></div><div><small>LEDGER</small><strong>{importPreview.summary.ledgerEntries}</strong></div><div><small>VALIDATION</small><strong>{importPreview.summary.validationStatus.toUpperCase()}</strong></div></div>
          <div className="import-migration"><span>MIGRATION</span><strong>v{importPreview.migration.fromSchemaVersion} → v{importPreview.migration.toSchemaVersion}</strong><small>{importPreview.migration.actions.join(" · ") || "NONE"}</small></div>
          <div className="import-preview-integrity"><code>{importPreview.integrity.planFingerprint}</code><code>{importPreview.integrity.ledgerHeadHash}</code></div>
          <Button className="import-commit" type="button" disabled={importPreview.idConflict || importing} onClick={commitImport}>{importing ? <CircleNotch className="spin" size={17} /> : <UploadSimple size={17} />}IMPORT PROJECT</Button>
        </SheetContent>}
      </Sheet>
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => { if (!open) closeRename(); }}>
        <DialogContent className="project-dialog" showCloseButton={false}>
          <form className="project-dialog-form" onSubmit={renameProject}>
            <DialogHeader className="project-dialog-header"><span>PROJECT</span><DialogTitle>RENAME</DialogTitle><DialogDescription>{renameTarget?.id}</DialogDescription></DialogHeader>
            <div className="project-dialog-field"><Label htmlFor="project-rename-name">NAME</Label><Input id="project-rename-name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoComplete="off" /></div>
            <DialogFooter className="project-dialog-footer"><Button className="project-dialog-button is-secondary" type="button" variant="outline" disabled={renaming} onClick={closeRename}>CANCEL</Button><Button className="project-dialog-button" type="submit" disabled={renaming || !renameValue.trim() || renameValue.trim() === renameTarget?.name}>{renaming ? "SAVING" : "RENAME"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) closeDelete(); }}>
        <AlertDialogContent className="project-dialog project-delete-dialog">
          <AlertDialogHeader className="project-dialog-header"><span>PROJECT</span><AlertDialogTitle>DELETE</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.id}</AlertDialogDescription></AlertDialogHeader>
          <div className="project-dialog-field"><Label htmlFor="project-delete-name">CONFIRM NAME</Label><code>{deleteTarget?.name}</code><Input id="project-delete-name" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></div>
          <AlertDialogFooter className="project-dialog-footer"><AlertDialogCancel className="project-dialog-button is-secondary" disabled={deleting}>CANCEL</AlertDialogCancel><AlertDialogAction className="project-dialog-button is-destructive" variant="destructive" disabled={deleting || deleteConfirmation !== deleteTarget?.name} onClick={deleteProject}>{deleting ? "DELETING" : "DELETE"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {importError && <div className="project-toast" role="status"><strong>{importError}</strong><button type="button" onClick={() => setImportError("")} aria-label="Dismiss import status"><X size={15} /></button></div>}
    </div>
  );
}
