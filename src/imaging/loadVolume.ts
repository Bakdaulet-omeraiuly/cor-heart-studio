// Fetch helpers for the 8-bit slice volumes (gzip files under public/).

/** gzip bytes -> raw bytes; passes data through if a server already decoded it. */
export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function fetchOk(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed to load (HTTP ${res.status})`);
  return res;
}

export async function fetchVolumeBytes(url: string, expected: number): Promise<Uint8Array> {
  const bytes = await gunzip(await (await fetchOk(url)).arrayBuffer());
  if (bytes.length !== expected) throw new Error(`${url}: ${bytes.length} voxels, expected ${expected}`);
  return bytes;
}
