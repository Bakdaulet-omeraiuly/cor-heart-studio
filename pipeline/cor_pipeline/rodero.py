"""Rodero 2021 healthy four-chamber meshes (CC BY 4.0) -> label volume for the asset builder.

Source: "Virtual cohort of adult healthy four-chamber heart meshes from CT images", zenodo.org/records/4590294,
Rodero et al., PLoS Comput Biol 2021, doi:10.1371/journal.pcbi.1008851. Each case is an ASCII VTK unstructured
grid of tetrahedra (mm, ~1 mm edges) with an element tag per tet and rule-based ventricular fibres.

Element tags (record description): 1 LV, 2 RV, 3 LA, 4 RA myocardium; 5 aorta wall; 6 pulmonary artery wall;
7-10 mitral, tricuspid, aortic, pulmonary valve planes; 11-17 inlet caps (LAA, PVs, SVC, IVC); 18-24 borders.
The valve planes and caps close every cavity, so a blood pool is the space a chamber's walls (plus the planes
around it) enclose.
"""

from __future__ import annotations

import numpy as np

TAG = {"lv": 1, "rv": 2, "la": 3, "ra": 4, "aorta": 5, "pulmonary_artery": 6,
       "mitral_valve": 7, "tricuspid_valve": 8, "aortic_valve": 9, "pulmonary_valve": 10}

DATASET = {
    "name": "Rodero 2021 virtual cohort of adult healthy four-chamber heart meshes from CT",
    "url": "https://zenodo.org/records/4590294",
    "license": "CC BY 4.0",
    "source": "Rodero C, Strocchi M, et al. PLoS Comput Biol 17(4):e1008851, 2021. doi:10.1371/journal.pcbi.1008851",
}


def _section(lines_iter, n: int, dtype) -> np.ndarray:
    """Read whitespace-separated numbers until n values are collected."""
    out = []
    count = 0
    for line in lines_iter:
        vals = np.array(line.split(), dtype=dtype)
        out.append(vals)
        count += vals.size
        if count >= n:
            break
    return np.concatenate(out)[:n]


def read_vtk(path: str) -> dict[str, np.ndarray]:
    """points (N,3 mm), tets (M,4), tags (M,), fibres (M,3). Only the sections the builder needs."""
    data: dict[str, np.ndarray] = {}
    with open(path, "r") as f:
        it = iter(f)
        for line in it:
            head = line.split()
            if not head:
                continue
            key = head[0]
            if key == "POINTS":
                n = int(head[1])
                data["points"] = _section(it, 3 * n, np.float64).reshape(n, 3)
            elif key == "CELLS":
                m, total = int(head[1]), int(head[2])
                cells = _section(it, total, np.int64).reshape(m, total // m)
                if not np.all(cells[:, 0] == 4):
                    raise ValueError("expected tetrahedra only")
                data["tets"] = cells[:, 1:]
            elif key == "CELL_TYPES":
                _section(it, int(head[1]), np.int64)
            elif key == "SCALARS" and head[1] == "ID":
                next(it)  # LOOKUP_TABLE
                data["tags"] = _section(it, len(data["tets"]), np.int64)
            elif key == "VECTORS" and head[1] == "fibres":
                data["fibres"] = _section(it, 3 * len(data["tets"]), np.float32).reshape(-1, 3)
            elif key == "POINT_DATA":
                break  # UVCs not needed
    return data


def rasterize(points: np.ndarray, tets: np.ndarray, tags: np.ndarray, voxel_mm: float, margin_mm: float = 6.0, chunk: int = 150_000):
    """Tag volume (uint8, 0 = empty) of the tetrahedra on a regular grid; returns (volume, affine voxel -> mm).

    A voxel takes the tag of the tetrahedron containing its centre (barycentric test). Where tetrahedra share
    a face the later one wins, which only matters on the one-voxel interfaces between tags.
    """
    lo = points.min(axis=0) - margin_mm
    shape = tuple(np.ceil((points.max(axis=0) + margin_mm - lo) / voxel_mm).astype(int) + 1)
    vol = np.zeros(shape, dtype=np.uint8)
    for s in range(0, len(tets), chunk):
        t = tets[s:s + chunk]
        v = points[t]  # (n, 4, 3)
        tg = tags[s:s + chunk]
        imin = np.floor((v.min(axis=1) - lo) / voxel_mm).astype(int)
        imax = np.ceil((v.max(axis=1) - lo) / voxel_mm).astype(int)
        k = int((imax - imin).max()) + 1
        # barycentric inverse per tet
        m = np.stack([v[:, 1] - v[:, 0], v[:, 2] - v[:, 0], v[:, 3] - v[:, 0]], axis=2)  # (n,3,3) columns
        ok = np.abs(np.linalg.det(m)) > 1e-12
        t_ok = np.flatnonzero(ok)
        minv = np.zeros_like(m)
        minv[t_ok] = np.linalg.inv(m[t_ok])
        offs = np.stack(np.meshgrid(*[np.arange(k)] * 3, indexing="ij"), axis=-1).reshape(-1, 3)
        for o in offs:
            idx = imin + o
            inside_box = np.all(idx <= imax, axis=1) & ok
            if not inside_box.any():
                continue
            ii = np.flatnonzero(inside_box)
            c = lo + idx[ii] * voxel_mm
            b = np.einsum("nij,nj->ni", minv[ii], c - v[ii, 0])
            hit = (b >= -1e-6).all(axis=1) & (b.sum(axis=1) <= 1 + 1e-6)
            jj = ii[hit]
            p = idx[jj]
            vol[p[:, 0], p[:, 1], p[:, 2]] = tg[jj]
    affine = np.eye(4)
    affine[:3, :3] *= voxel_mm
    affine[:3, 3] = lo
    return vol, affine


WALL_TAGS = {"lv": 1, "rv": 2, "la": 3, "ra": 4, "aorta": 5, "pulmonary_artery": 6}


def blood_pools(vol: np.ndarray, voxel_mm: float) -> dict[str, np.ndarray]:
    """Blood pool masks per chamber and great artery.

    Chambers: the closed cavities of the tetrahedral solid, each given to the wall tag that borders it most.
    Great arteries end open in the meshes, so their lumen is what a morphological closing of the solid
    encloses, kept inside the convex hull of that artery's wall (so the closing's dome past the cut end is
    dropped).
    """
    from scipy import ndimage
    from scipy.spatial import Delaunay

    solid = vol > 0
    cav = ndimage.binary_fill_holes(solid) & ~solid
    lab, n = ndimage.label(cav)
    pools: dict[str, np.ndarray] = {}
    ring = np.ones((3, 3, 3), bool)
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() * voxel_mm**3 < 5000:  # < 5 mL: interface voids, not a chamber
            continue
        shell = ndimage.binary_dilation(comp, ring) & solid
        tags, counts = np.unique(vol[shell], return_counts=True)
        chamber_tags = {t: c for t, c in zip(tags, counts) if 1 <= t <= 4}
        if not chamber_tags:
            continue
        tag = max(chamber_tags, key=chamber_tags.get)
        role = next(r for r, t in WALL_TAGS.items() if t == tag)
        pools[role] = pools.get(role, np.zeros_like(cav)) | comp

    # per artery, on a 2x coarser grid: close its wall (plus its valve plane) with a ball wider than the vessel
    # radius, fill, and keep what lies inside the wall's convex hull and outside every tissue voxel
    valve_tag = {"aorta": TAG["aortic_valve"], "pulmonary_artery": TAG["pulmonary_valve"]}
    r = int(round(20 / (2 * voxel_mm)))
    zz, yy, xx = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    ball = zz**2 + yy**2 + xx**2 <= r * r
    taken = np.zeros_like(cav)
    for p in pools.values():
        taken |= p
    for role in ("aorta", "pulmonary_artery"):
        wall = (vol == WALL_TAGS[role]) | (vol == valve_tag[role])
        sh = tuple(-(-np.array(wall.shape) // 2))
        coarse = np.zeros(sh, bool)
        for o in np.ndindex(2, 2, 2):
            sub = wall[o[0]::2, o[1]::2, o[2]::2]
            coarse[:sub.shape[0], :sub.shape[1], :sub.shape[2]] |= sub
        closed = ndimage.binary_closing(np.pad(coarse, r), ball)[r:-r, r:-r, r:-r]
        filled = ndimage.binary_fill_holes(closed)
        fine = np.repeat(np.repeat(np.repeat(filled, 2, 0), 2, 1), 2, 2)[:wall.shape[0], :wall.shape[1], :wall.shape[2]]
        cand = np.argwhere(fine & ~solid & ~taken)
        hull = Delaunay(np.argwhere(vol == WALL_TAGS[role]))
        inside = hull.find_simplex(cand) >= 0
        m = np.zeros_like(cav)
        m[tuple(cand[inside].T)] = True
        lab2, n2 = ndimage.label(m)
        if n2:
            sizes = ndimage.sum(m, lab2, range(1, n2 + 1))
            m = lab2 == (1 + int(np.argmax(sizes)))
        pools[role] = m
        taken |= m
    return pools


# label values of labels.RODERO2021
_OUT = {"lv_cavity": 1, "lv_myocardium": 2, "rv": 3, "la": 4, "ra": 5, "aorta": 6, "pulmonary_artery": 7,
        "rv_wall": 8, "la_wall": 9, "ra_wall": 10, "aorta_wall": 11, "pulmonary_artery_wall": 12}
# valve planes join the downstream blood pool (so atrium and ventricle pools touch at the annulus);
# vein inlet caps join their atrium (open vein stumps); the rings around the inlets are atrial wall
_PLANE_TO_POOL = {7: "lv_cavity", 8: "rv", 9: "aorta", 10: "pulmonary_artery",
                  11: "la", 12: "la", 13: "la", 14: "la", 15: "la", 16: "ra", 17: "ra"}
_RING_TO_WALL = {18: "la_wall", 19: "la_wall", 20: "la_wall", 21: "la_wall", 22: "la_wall", 23: "ra_wall", 24: "ra_wall"}

# The meshes are in the CT's LPS millimetres (checked on case 01: right atrium at lower x than the LV, left
# atrium at higher y than the RV, great arteries at higher z than the apex); the builder expects RAS.
LPS_TO_RAS = np.diag([-1.0, -1.0, 1.0, 1.0])


def case_labels(vtk_path: str, voxel_mm: float = 0.75):
    """(label volume in labels.RODERO2021 values, affine voxel -> RAS mm, fibres-per-tet data)."""
    d = read_vtk(vtk_path)
    vol, affine = rasterize(d["points"], d["tets"], d["tags"], voxel_mm)
    pools = blood_pools(vol, voxel_mm)
    out = np.zeros(vol.shape, np.uint8)
    for role, m in pools.items():
        out[m] = _OUT["lv_cavity" if role == "lv" else role]
    for plane, role in _PLANE_TO_POOL.items():
        out[vol == plane] = _OUT[role]
    for role, tag in WALL_TAGS.items():
        out[vol == tag] = _OUT["lv_myocardium" if role == "lv" else f"{role}_wall"]
    for ring, role in _RING_TO_WALL.items():
        out[vol == ring] = _OUT[role]
    return out, LPS_TO_RAS @ affine, d


def build_template(labels: np.ndarray, affine: np.ndarray, case: str = "01", lods=(("high", 300_000), ("low", 120_000))):
    """Atlas-grade Rodero template (docs/atlas-heart.md): (glbs, manifest, proxy, qa, prov)."""
    from .atlas_heart import build_atlas_heart
    dataset = {**DATASET, "knownLimitations": [
        "Healthy adult template (Rodero 2021 case %s), not this patient's anatomy" % case,
        "Great vessels continue past the source mesh cuts as the BodyParts3D atlas fitted to this heart (CC BY-SA), not imaged",
    ]}
    glbs, manifest, proxy, qa, _, prov = build_atlas_heart(labels, affine, "rodero2021", f"rodero-{case}", dataset, lods=lods)
    return glbs, manifest, proxy, qa, prov


def main():
    import argparse
    import json
    from pathlib import Path

    from .asset import build_asset

    ap = argparse.ArgumentParser(description="Rodero 2021 case (.vtk) -> app heart asset")
    ap.add_argument("vtk")
    ap.add_argument("out")
    ap.add_argument("--case", default="01")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "asset").mkdir(parents=True, exist_ok=True)
    cached = out / "labels.npz"
    if cached.exists() and cached.stat().st_mtime > Path(args.vtk).stat().st_mtime:
        z = np.load(cached)
        labels, affine = z["labels"], z["affine"]
    else:
        labels, affine, _ = case_labels(args.vtk)
        np.savez_compressed(cached, labels=labels, affine=affine)
    glbs, manifest, proxy, qa, _ = build_template(labels, affine, args.case)
    manifest["assetId"] = f"cor-template-rodero-{args.case}"
    manifest["provenance"]["geometry"] = f"CT-derived healthy template (Rodero 2021 case {args.case}, CC BY 4.0)"
    for lod, data in glbs.items():
        (out / "asset" / f"heart-{lod}.glb").write_bytes(data)
    (out / "asset" / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "asset" / "lv-cavity-proxy.json").write_text(json.dumps(proxy))
    (out / "asset" / "qa.json").write_text(json.dumps(qa, indent=2))
    print(json.dumps({"qa": qa, "baseline": manifest["baseline"], "fidelity": manifest["fidelity"]["lods"]["high"]["overall"]}, indent=2))


if __name__ == "__main__":
    main()
