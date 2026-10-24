# Describe the features and functionality of your Project

COR Studio turns a structured patient record into a guideline-graded, explainable view of the heart and brain.

- **3D anatomy from open data.** An animated **3D heart**: a procedural model plus CT-derived hearts from the open
  TotalSegmentator dataset, with measured agreement with their source labels. A **3D brain** from a labelled MRI in the
  open Mindboggle-101 dataset, with linked MRI slices. Record values change what you see, and every visual change traces
  back to its record field and rule.
- **The diagnosis engine.** Plain, deterministic TypeScript with no AI involved, covering:
  - aortic stenosis, including discordant low-gradient cases (ACC/AHA 2020);
  - valve regurgitation and prolapse;
  - LV function, size, hypertrophy and wall motion (ASE/EACVI 2015, ESC 2021, AHA/ACC/HFSA 2022);
  - the other chambers;
  - coronary stenosis (CAD-RADS 2.0);
  - ECG and QTc;
  - brain atrophy against published ageing and Alzheimer's ranges.

  It outputs **findings, a differential, missing data and red flags**. Every statement carries the record field, the
  value, a rule id and a guideline **DOI**. Red flags only ever say "urgent specialist review".
- **The Claude assistant** explains that result to the clinician and moves the 3D view to the finding being discussed.
  It never sees the raw record, so injected text in notes can't reach it, and code checks every number and citation
  before a reply is shown. On our tests, engine plus Claude got **100 % of grades right with 0 invented numbers**,
  against 0 % for Claude alone.
- **Outlook** projects aortic stenosis, LV hypertrophy and brain atrophy forward using cited, group-average rates with
  uncertainty ranges, never an individual forecast.

**Beyond the hospital, lab researchers can use the same engine:**
- grade whole cohorts of echo, CT angiography or ECG records the same way every time, with an audit trail per value;
- benchmark or audit their own AI models against **102 open, sourced test cases**, scored on grade accuracy, invented
  numbers, citations and prompt-injection resistance;
- flag incomplete datasets automatically, since the engine lists each missing field and why it matters;
- explore hypotheses with cited group-level projections, such as how an atrophy rate compares with published ageing and
  Alzheimer's ranges;
- teach guideline grading with an interactive 3D view where every threshold is visible and cited.
