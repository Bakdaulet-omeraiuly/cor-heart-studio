"use client";
import { useApp } from "@/state/store";
import { entryFromRaw, type PatientEntry } from "./patients";

/** Bundled samples: synthetic records (same file offered for download) and open-dataset CT cases. */
const SAMPLE_FILES = ["/samples/synthetic-patients.json", "/samples/open-ct-patients.json"];

export async function loadSamples() {
  const files = await Promise.all(SAMPLE_FILES.map(async (url) => ((await (await fetch(url)).json()) as { patients: unknown[] }).patients));
  const now = Date.now();
  const entries = files.flat()
    .map((p, i) => entryFromRaw(p, "sample", now + i))
    .filter((e): e is PatientEntry => !("error" in e));
  const s = useApp.getState();
  s.upsertEntries(entries.filter((e) => !s.entries[e.key]));
  if (!s.selectedKey && entries[0]) s.select(entries[0].key);
}
