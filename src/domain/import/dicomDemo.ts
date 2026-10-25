/** The jury demo uses one open CT study whose full COR asset is already bundled. */
const OPEN_CT_S0270_SHA256 = "0c5fe2191421eb24f2b8b058fc1bfb2a35d4916d6656b8cdc12ddb91bb5bcba8";

export async function identifyOpenCtDemo(file: File): Promise<"OPEN-CT-s0270"> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Select the supplied CT DICOM ZIP file.");
  if (file.size > 400 * 1024 * 1024) throw new Error("The CT ZIP exceeds the 400 MB demo limit.");
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (signature.length < 4 || signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error("This is not a valid DICOM ZIP file.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== OPEN_CT_S0270_SHA256) {
    throw new Error("This live demo supports the supplied open CT ZIP. Other DICOM studies need the imaging server before a patient-specific model can be generated.");
  }
  return "OPEN-CT-s0270";
}
