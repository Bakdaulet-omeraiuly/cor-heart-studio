/** The jury demo uses one open CT study whose full COR asset is already bundled. */
const OPEN_CT_S0270_SHA256 = "0c5fe2191421eb24f2b8b058fc1bfb2a35d4916d6656b8cdc12ddb91bb5bcba8";
const OPEN_LABELS_GZ_SHA256 = "339546405888d455453846ccc18a1b41301349d1de25ce2125651e899186ae6e";
const OPEN_LABELS_NII_SHA256 = "430efd0e1bef1540d5bfec390df457ab891e9fd9dc49db4fd3c03be02a63238e";

export async function identifyOpenCtDemo(file: File): Promise<{ patientId: "OPEN-CT-s0270"; kind: "dicom" | "nifti" }> {
  const name = file.name.toLowerCase();
  const kind = name.endsWith(".zip") ? "dicom" : name.endsWith(".nii") || name.endsWith(".nii.gz") ? "nifti" : null;
  if (!kind) throw new Error("Select a CT DICOM ZIP or NIfTI (.nii / .nii.gz) file.");
  if (file.size > 400 * 1024 * 1024) throw new Error("The file exceeds the 400 MB demo limit.");
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (kind === "dicom" && (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b)) throw new Error("This is not a valid DICOM ZIP file.");
  if (name.endsWith(".nii.gz") && (signature.length < 2 || signature[0] !== 0x1f || signature[1] !== 0x8b)) throw new Error("This is not a valid compressed NIfTI file.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (kind === "dicom" && hex !== OPEN_CT_S0270_SHA256) {
    throw new Error("This live demo supports the supplied open CT ZIP. Other DICOM studies need the imaging server before a patient-specific model can be generated.");
  }
  if (kind === "nifti" && hex !== OPEN_LABELS_GZ_SHA256 && hex !== OPEN_LABELS_NII_SHA256) {
    throw new Error("This live demo supports the supplied open CT NIfTI segmentation. Other NIfTI scans need a matching 3D asset.");
  }
  return { patientId: "OPEN-CT-s0270", kind };
}
