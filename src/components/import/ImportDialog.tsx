"use client";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, CopyX, FileDown, FileUp, Info, ShieldCheck } from "lucide-react";
import { buildImportPreview, IMPORT_LIMITS, type ImportPreview, type PreviewRow, type RowStatus } from "@/domain/import/preview";
import { entryFromNormalized } from "@/lib/patients";
import { useApp } from "@/state/store";
import { Modal } from "../ui/Modal";
import { Button, Pill, Segmented, cx } from "../ui/primitives";

const STATUS: Record<RowStatus, { label: string; tone: "ok" | "warn" | "error" | "info" | "neutral" }> = {
  valid: { label: "valid", tone: "ok" },
  warning: { label: "valid with warnings", tone: "warn" },
  rejected: { label: "rejected", tone: "error" },
  duplicate_in_file: { label: "duplicate in file — skipped", tone: "neutral" },
  duplicate_existing: { label: "already in session", tone: "info" },
};

const TEMPLATES: [string, string][] = [
  ["JSON template", "/samples/template.json"],
  ["CSV template", "/samples/template.csv"],
  ["Synthetic samples (JSON)", "/samples/synthetic-patients.json"],
  ["Synthetic samples (CSV)", "/samples/synthetic-patients.csv"],
  ["Comprehensive example (all namespaces)", "/samples/comprehensive-example.json"],
  ["JSON Schema", "/schema/patient-records.schema.json"],
];

export function ImportDialog() {
  const s = useApp();
  const close = () => s.set({ dialog: null });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, "replace" | "skip">>({});
  const [result, setResult] = useState<{ imported: number; replaced: number; skipped: number; rejected: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const readFile = async (f: File) => {
    setResult(null);
    setDecisions({});
    if (f.size > IMPORT_LIMITS.maxBytes) {
      setPreview(buildImportPreview(f.name, "", new Set(), f.size));
      return;
    }
    const text = await f.text();
    setPreview(buildImportPreview(f.name, text, new Set(Object.keys(useApp.getState().entries)), f.size));
  };

  const dupes = preview?.rows.filter((r) => r.status === "duplicate_existing") ?? [];
  const undecided = dupes.filter((r) => !decisions[r.index]).length;
  const toImport = useMemo(() => preview?.rows.filter((r) => r.patient && (r.status === "valid" || r.status === "warning" || (r.status === "duplicate_existing" && decisions[r.index] === "replace"))) ?? [], [preview, decisions]);
  const blocked = !!preview?.fileIssues.some((i) => i.severity === "error" && i.code !== "csv.unknown_columns" && !i.path.startsWith("row"));

  const commit = () => {
    if (!preview) return;
    const now = Date.now();
    const entries = toImport.map((r, i) => entryFromNormalized(r.patient!, "import", now + i));
    s.upsertEntries(entries);
    if (entries[0]) s.select(entries[0].key);
    setResult({
      imported: entries.length,
      replaced: toImport.filter((r) => r.status === "duplicate_existing").length,
      skipped: preview.rows.filter((r) => r.status === "duplicate_in_file" || (r.status === "duplicate_existing" && decisions[r.index] === "skip")).length,
      rejected: preview.counts.rejected,
    });
  };

  return (
    <Modal title="Import patient records" onClose={close} wide footer={
      result ? <Button variant="primary" onClick={close}>Done</Button> : (
        <>
          <span className="mr-auto text-[12px] text-muted">{preview ? (undecided ? `${undecided} duplicate decision${undecided > 1 ? "s" : ""} required` : `${toImport.length} record${toImport.length === 1 ? "" : "s"} ready`) : "No file selected"}</span>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!preview || blocked || undecided > 0 || toImport.length === 0} onClick={commit} data-testid="commit-import">
            Import {toImport.length} record{toImport.length === 1 ? "" : "s"}
          </Button>
        </>
      )
    }>
      <p className="mb-3 flex items-center gap-1.5 text-[12px] text-muted"><ShieldCheck className="h-3.5 w-3.5 text-ok" /> Files are read inside this browser tab. Nothing is uploaded, stored in the browser, or kept after the tab closes.</p>
      {result ? (
        <div role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-[13px]">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-ok" /> Imported {result.imported} record{result.imported === 1 ? "" : "s"}{result.replaced ? ` (${result.replaced} replaced)` : ""}.</p>
          {(result.skipped > 0 || result.rejected > 0) && <p className="mt-1 text-muted">{result.skipped} skipped as duplicates · {result.rejected} rejected and not imported (see the list above before closing).</p>}
        </div>
      ) : null}
      {!result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void readFile(f); }}
          className={cx("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors", dragging ? "border-accent bg-accent/5" : "border-line-strong bg-panel-2")}
        >
          <FileUp className="h-6 w-6 text-muted" />
          <p className="text-[13px]">Drop a <b>.json</b> or <b>.csv</b> file here, or</p>
          <Button variant="primary" onClick={() => input.current?.click()}>Choose file</Button>
          <input ref={input} type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" aria-label="Choose a JSON or CSV file" data-testid="file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
          <p className="text-[11px] text-faint">Limits: {IMPORT_LIMITS.maxBytes / 1024 / 1024} MB per file, {IMPORT_LIMITS.maxRecords} records per batch (application limits, not clinical ones). One row/record per patient-study; key = (patientId, studyId).</p>
        </div>
      )}
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer font-medium">Templates, samples and schema</summary>
        <div className="mt-2 flex flex-wrap gap-2">{TEMPLATES.map(([label, href]) => <a key={href} href={href} download className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] hover:bg-panel-3"><FileDown className="h-3.5 w-3.5" />{label}</a>)}</div>
        <p className="mt-2 text-faint">CSV: units are fixed by column names (e.g. <code>heart_rate_bpm</code>, <code>lv_edd_mm</code>). Lists use “; ” (escape a literal semicolon as “\;”). Valve findings use <code>&lt;valve&gt;_&lt;condition&gt;</code> columns holding the severity. Labs, waveforms and imaging need JSON.</p>
      </details>
      {preview && <PreviewTable preview={preview} decisions={decisions} setDecisions={setDecisions} />}
    </Modal>
  );
}

function PreviewTable({ preview, decisions, setDecisions }: { preview: ImportPreview; decisions: Record<number, "replace" | "skip">; setDecisions: (d: Record<number, "replace" | "skip">) => void }) {
  const dupes = preview.rows.filter((r) => r.status === "duplicate_existing");
  return (
    <section className="mt-4" aria-label="Import preview">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <b className="mr-1">{preview.fileName}</b>
        <Pill>{preview.format.toUpperCase()}</Pill>
        <Pill tone="ok">{preview.counts.valid} valid</Pill>
        <Pill tone="warn">{preview.counts.warning} with warnings</Pill>
        <Pill tone="error">{preview.counts.rejected} rejected</Pill>
        <Pill tone="info">{preview.counts.duplicate_existing} already in session</Pill>
        <Pill>{preview.counts.duplicate_in_file} duplicate in file</Pill>
        {dupes.length > 1 && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" onClick={() => setDecisions(Object.fromEntries(dupes.map((r) => [r.index, "replace"])))}>Replace all</Button>
            <Button size="sm" onClick={() => setDecisions(Object.fromEntries(dupes.map((r) => [r.index, "skip"])))}>Skip all</Button>
          </span>
        )}
      </div>
      {preview.fileIssues.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-line bg-panel-2 p-2 text-[12px]">
          {preview.fileIssues.map((i, k) => <li key={k} className="flex gap-2"><IssueIcon s={i.severity} /><span><span className="num text-faint">{i.path}</span> {i.message}{i.suggestion && <span className="block text-muted">→ {i.suggestion}</span>}</span></li>)}
        </ul>
      )}
      <div className="mt-2 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead className="bg-panel-2 text-left text-[11px] uppercase tracking-wide text-faint">
            <tr><th className="px-2 py-1.5">Row</th><th className="px-2">patientId</th><th className="px-2">studyId</th><th className="px-2">Status</th><th className="px-2">Details</th></tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => <Row key={r.index} r={r} decision={decisions[r.index]} onDecide={(d) => setDecisions({ ...decisions, [r.index]: d })} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IssueIcon({ s }: { s: "error" | "warning" | "info" }) {
  const I = s === "error" ? Ban : s === "warning" ? AlertTriangle : Info;
  return <I aria-label={s} className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", s === "error" ? "text-error" : s === "warning" ? "text-warn" : "text-info")} />;
}

function Row({ r, decision, onDecide }: { r: PreviewRow; decision?: "replace" | "skip"; onDecide: (d: "replace" | "skip") => void }) {
  const st = STATUS[r.status];
  const shown = r.issues.filter((i) => i.severity !== "info" || r.status === "rejected");
  return (
    <tr className="border-t border-line align-top" data-status={r.status}>
      <td className="num px-2 py-1.5 text-faint">{r.label}</td>
      <td className="num px-2 py-1.5">{r.patientId ?? <span className="text-error">missing</span>}</td>
      <td className="num px-2 py-1.5">{r.studyId ?? <span className="text-error">missing</span>}</td>
      <td className="px-2 py-1.5">
        <Pill tone={st.tone}>{r.status === "duplicate_in_file" ? <CopyX className="h-3 w-3" /> : null}{st.label}</Pill>
        {r.status === "duplicate_existing" && (
          <div className="mt-1"><Segmented<"replace" | "skip"> label={`Duplicate decision for ${r.patientId}`} value={decision ?? ("" as "skip")} onChange={onDecide} options={[{ value: "replace", label: "Replace" }, { value: "skip", label: "Skip" }]} /></div>
        )}
      </td>
      <td className="px-2 py-1.5">
        {shown.length === 0 ? <span className="text-faint">—</span> : (
          <ul className="space-y-0.5">{shown.slice(0, 6).map((i, k) => <li key={k} className="flex gap-1.5"><IssueIcon s={i.severity} /><span>{i.path && <span className="num text-faint">{i.path}: </span>}{i.message}{i.suggestion && <span className="block text-muted">→ {i.suggestion}</span>}</span></li>)}
            {shown.length > 6 && <li className="text-faint">+{shown.length - 6} more</li>}</ul>
        )}
      </td>
    </tr>
  );
}
