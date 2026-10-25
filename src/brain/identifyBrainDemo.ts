/** Identify the open Mindboggle study whose MRI and segmented 3D asset ship with COR Studio. */
const KNOWN = {
  "7c1cfad1ee4c8247c7a240cea01f9c3068c2fec947d41bb419b5aaedf65f3100": "dicom",
  "9d4da166c8984bf702a6424f2b052c784a3e9f42616e256bd70dec0bc58148d6": "mri",
  "21c5c26d4767cd495ad52efa5e201f35bacc77dcf494209c0816cc5ee4950523": "mri",
  "305dc15205627eb3a6105f1b70c646794c9ab2e3471abc744a7b80f5ecf65318": "segmentation",
  "1e20000a1d91b9b04d09f273172b02d2367d2a13b451191d185e9f358034db42": "segmentation",
} as const;

export type BrainDemoKind = "dicom" | "mri" | "segmentation";

export async function identifyBrainDemo(file: File): Promise<BrainDemoKind> {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".zip") && !name.endsWith(".nii") && !name.endsWith(".nii.gz")) {
    throw new Error("Select an MRI DICOM ZIP or NIfTI (.nii / .nii.gz) file.");
  }
  if (file.size > 400 * 1024 * 1024) throw new Error("The file exceeds the 400 MB demo limit.");
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (name.endsWith(".zip") && (signature.length < 2 || signature[0] !== 0x50 || signature[1] !== 0x4b)) throw new Error("This is not a valid DICOM ZIP file.");
  if (name.endsWith(".nii.gz") && (signature.length < 2 || signature[0] !== 0x1f || signature[1] !== 0x8b)) throw new Error("This is not a valid compressed NIfTI file.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const kind = KNOWN[hash as keyof typeof KNOWN];
  if (!kind || (name.endsWith(".zip") !== (kind === "dicom"))) {
    throw new Error("This live demo supports the supplied open brain MRI files. Other studies need the imaging worker to generate their own 3D model.");
  }
  return kind;
}
