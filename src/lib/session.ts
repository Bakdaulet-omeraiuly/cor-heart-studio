"use client";
import { useApp } from "@/state/store";
import { entryFromRaw, type PatientEntry } from "./patients";

/** Loads the bundled synthetic sample file (same file offered for download). */
export async function loadSamples() {
  const res = await fetch("/samples/synthetic-patients.json");
  const data = (await res.json()) as { patients: unknown[] };
  const now = Date.now();
  const entries = data.patients
    .map((p, i) => entryFromRaw(p, "sample", now + i))
    .filter((e): e is PatientEntry => !("error" in e));
  const s = useApp.getState();
  s.upsertEntries(entries.filter((e) => !s.entries[e.key]));
  if (!s.selectedKey && entries[0]) s.select(entries[0].key);
}
