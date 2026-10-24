"""MRI label volume -> brain asset for the app (meshes, measurements, slice volumes).

Source: Mindboggle-101 release 3 (Klein & Tourville 2012, CC BY 4.0). Per subject it ships a
T1-weighted MRI, a skull-stripped brain, and `labels.DKT31.manual+aseg`: cortical regions labelled
by hand (DKT31 protocol, FreeSurfer numbers 1000s left / 2000s right) plus non-cortical structures
from FreeSurfer's automatic `aseg`. Every structure keeps that provenance.

    python -m cor_pipeline.brain <subject_dir> <out_dir>

Writes brain-{high,low}.glb, brain-manifest.json, mri.u8.gz + labels.u8.gz (cropped slice volumes for
the evidence panel; skull-stripped image only, so no face can be rendered) and preview.png.
"""

import argparse
import gzip
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

from .corfit import constrained_surface
from .fidelity import boundary_points, gate, summarise, surface_metrics
from .glb import write_glb
from .mesh import RAS_TO_APP, main_components

# --- structure table -----------------------------------------------------------------------------
# DKT31 cortical regions (FreeSurfer aparc numbering minus hemisphere offset) and their lobe.
DKT31 = {
    2: ("caudal anterior cingulate", "cingulate"),
    3: ("caudal middle frontal", "frontal"), 5: ("cuneus", "occipital"), 6: ("entorhinal", "temporal"),
    7: ("fusiform", "temporal"), 8: ("inferior parietal", "parietal"), 9: ("inferior temporal", "temporal"),
    10: ("isthmus cingulate", "cingulate"), 11: ("lateral occipital", "occipital"),
    12: ("lateral orbitofrontal", "frontal"), 13: ("lingual", "occipital"),
    14: ("medial orbitofrontal", "frontal"), 15: ("middle temporal", "temporal"),
    16: ("parahippocampal", "temporal"), 17: ("paracentral", "frontal"), 18: ("pars opercularis", "frontal"),
    19: ("pars orbitalis", "frontal"), 20: ("pars triangularis", "frontal"), 21: ("pericalcarine", "occipital"),
    22: ("postcentral", "parietal"), 23: ("posterior cingulate", "cingulate"), 24: ("precentral", "frontal"),
    25: ("precuneus", "parietal"), 26: ("rostral anterior cingulate", "cingulate"),
    27: ("rostral middle frontal", "frontal"), 28: ("superior frontal", "frontal"),
    29: ("superior parietal", "parietal"), 30: ("superior temporal", "temporal"),
    31: ("supramarginal", "parietal"), 34: ("transverse temporal", "temporal"), 35: ("insula", "insula"),
}
# Non-cortical structures shown as their own meshes: key -> (name, FreeSurfer labels L, labels R or None)
SUBCORTICAL = {
    "thalamus": ("Thalamus", [10], [49]),
    "caudate": ("Caudate", [11], [50]),
    "putamen": ("Putamen", [12], [51]),
    "pallidum": ("Globus pallidus", [13], [52]),
    "hippocampus": ("Hippocampus", [17], [53]),
    "amygdala": ("Amygdala", [18], [54]),
    "accumbens": ("Nucleus accumbens", [26], [58]),
    "lateral_ventricle": ("Lateral ventricle", [4, 5], [43, 44]),
    "cerebellum": ("Cerebellum", [7, 8], [46, 47]),
    "brainstem": ("Brainstem", [16], None),
    "third_ventricle": ("Third ventricle", [14], None),
    "fourth_ventricle": ("Fourth ventricle", [15], None),
    "corpus_callosum": ("Corpus callosum", [251, 252, 253, 254, 255], None),
}
LEFT_NONCORTICAL = {2, 4, 5, 7, 8, 10, 11, 12, 13, 17, 18, 26, 28, 30, 31}
RIGHT_NONCORTICAL = {41, 43, 44, 46, 47, 49, 50, 51, 52, 53, 54, 58, 60, 62, 63}
CEREBELLUM = {7, 8, 46, 47}

LOBE_COLOURS = {  # diagrammatic, colour-blind-aware hues per lobe; regions get lightness steps
    "frontal": (0.30, 0.52, 0.85), "parietal": (0.30, 0.68, 0.45), "temporal": (0.90, 0.58, 0.25),
    "occipital": (0.62, 0.45, 0.82), "cingulate": (0.86, 0.38, 0.42), "insula": (0.85, 0.75, 0.30),
}
SUB_COLOURS = {
    "thalamus": (0.42, 0.72, 0.80), "caudate": (0.55, 0.80, 0.62), "putamen": (0.92, 0.66, 0.70),
    "pallidum": (0.45, 0.55, 0.85), "hippocampus": (0.95, 0.85, 0.40), "amygdala": (0.40, 0.75, 0.70),
    "accumbens": (0.95, 0.60, 0.35), "lateral_ventricle": (0.40, 0.55, 0.90), "cerebellum": (0.80, 0.62, 0.50),
    "brainstem": (0.75, 0.55, 0.62), "third_ventricle": (0.40, 0.55, 0.90), "fourth_ventricle": (0.40, 0.55, 0.90),
    "corpus_callosum": (0.85, 0.85, 0.80),
}


def structure_table(labels: np.ndarray) -> list[dict]:
    """Every structure present: cortical regions per hemisphere, then subcortical (per side)."""
    present = set(np.unique(labels).astype(int).tolist())
    table = []
    for hemi, offset in (("left", 1000), ("right", 2000)):
        regions = [(k, v) for k, v in DKT31.items() if offset + k in present]
        lobe_rank: dict[str, int] = {}
        for k, (name, lobe) in regions:
            i = lobe_rank.setdefault(lobe, 0)
            lobe_rank[lobe] = i + 1
            base = np.array(LOBE_COLOURS[lobe])
            colour = np.clip(base * (0.78 + 0.09 * (i % 5)), 0, 1)
            table.append({
                "key": f"ctx_{hemi[0]}h_{name.replace(' ', '_')}", "name": f"{name.capitalize()} ({hemi})",
                "labels": [offset + k], "hemisphere": hemi, "group": "cortex", "lobe": lobe,
                "method": "manual", "colour": [round(float(c), 3) for c in colour],
            })
    for key, (name, left, right) in SUBCORTICAL.items():
        for hemi, labs in (("left", left), ("right", right)) if right else (("midline", left),):
            if not any(l in present for l in labs):
                continue
            table.append({
                "key": key if hemi == "midline" else f"{key}_{hemi[0]}h",
                "name": name if hemi == "midline" else f"{name} ({hemi})",
                "labels": [l for l in labs if l in present], "hemisphere": hemi,
                "group": "ventricles" if "ventricle" in key else "cerebellum_brainstem" if key in ("cerebellum", "brainstem") else "deep_grey" if key != "corpus_callosum" else "white_matter",
                "lobe": None, "method": "automatic (FreeSurfer aseg)", "colour": list(SUB_COLOURS[key]),
            })
    for i, s in enumerate(table, start=1):
        s["index"] = i  # 1..n, the value in labels.u8 and the cortex _REGION attribute (0 = none)
    return table


# --- geometry -------------------------------------------------------------------------------------


class Frame:
    def __init__(self, centre_mm):
        self.centre_mm = np.asarray(centre_mm, dtype=float)

    def point(self, p_mm):
        return (np.asarray(p_mm, dtype=float) - self.centre_mm) @ RAS_TO_APP.T


def surface(mask: np.ndarray, affine: np.ndarray, sigma: float, smooth: int, faces: int | None) -> trimesh.Trimesh:
    field = ndimage.gaussian_filter(np.pad(mask.astype(np.float32), 2), sigma=sigma)
    verts, tris, _, _ = measure.marching_cubes(field, level=0.5)
    verts -= 2.0
    mesh = trimesh.Trimesh(verts @ affine[:3, :3].T + affine[:3, 3], tris, process=True)
    if mesh.volume < 0:
        mesh.invert()
    if smooth:
        trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=smooth)
    if faces and len(mesh.faces) > faces:
        mesh = mesh.simplify_quadric_decimation(face_count=faces)
    return mesh


def nearest_region(points_mm: np.ndarray, region_index: np.ndarray, affine: np.ndarray, max_voxels: float = 1.5,
                   normals: np.ndarray | None = None) -> np.ndarray:
    """Cortical region index of the nearest cortical voxel for each surface point; 0 where no
    cortical voxel is within `max_voxels` (e.g. the medial wall facing the third ventricle, which is
    white matter or deep grey matter, not cortex).

    With outward `normals`, each point is first moved half a voxel inward: a surface vertex sits on
    the face between a tissue voxel and an outside voxel, and the outside side can be nearer to the
    region across a narrow sulcus (parahippocampal vs fusiform across the collateral sulcus)."""
    if normals is not None:
        step = 0.5 * float(np.linalg.norm(affine[:3, :3], axis=0).min())
        points_mm = points_mm - step * normals
    dist, nearest = ndimage.distance_transform_edt(region_index == 0, return_indices=True)
    inv = np.linalg.inv(affine)
    idx = np.round(points_mm @ inv[:3, :3].T + inv[:3, 3]).astype(int)
    for a in range(3):
        idx[:, a] = np.clip(idx[:, a], 0, region_index.shape[a] - 1)
    src = tuple(nearest[a][idx[:, 0], idx[:, 1], idx[:, 2]] for a in range(3))
    region = region_index[src].copy()
    region[dist[idx[:, 0], idx[:, 1], idx[:, 2]] > max_voxels] = 0
    return region


# Published LOD only. Cortex is not decimated: decimation removed thin gyri and dropped surface
# agreement on inferior medial regions to ~83 % (parahippocampal at 90k faces vs 100 % undecimated).
LODS = (("low", (None, 8_000)),)


def build(subject_dir: Path, lods=LODS):
    lab_img = nib.load(subject_dir / "labels.DKT31.manual+aseg.nii.gz")
    labels = np.asarray(lab_img.dataobj).astype(np.int32)
    affine = lab_img.affine
    t1 = np.asarray(nib.load(subject_dir / "t1weighted_brain.nii.gz").dataobj).astype(np.float32)
    table = structure_table(labels)
    voxel_ml = abs(np.linalg.det(affine[:3, :3])) / 1000

    # index volume: every voxel of a listed structure -> its table index
    index = np.zeros(labels.shape, dtype=np.uint8)
    for s in table:
        index[np.isin(labels, s["labels"])] = s["index"]
        s["volumeMl"] = round(float(np.count_nonzero(np.isin(labels, s["labels"]))) * voxel_ml, 2)
    cortex_index = np.where(np.isin(index, [s["index"] for s in table if s["group"] == "cortex"]), index, 0)

    brain_mask = labels > 0
    centre_mm = voxel_centre(brain_mask, affine)
    frame = Frame(centre_mm)

    hemis = {
        "left": np.isin(labels, list(LEFT_NONCORTICAL - CEREBELLUM)) | ((labels >= 1000) & (labels < 2000)),
        "right": np.isin(labels, list(RIGHT_NONCORTICAL - CEREBELLUM)) | (labels >= 2000),
    }
    meshes_by_lod, ras_by_lod = {}, {}
    for lod, (cortex_faces, sub_faces) in lods:
        meshes, ras = [], []
        for hemi, mask in hemis.items():
            mask, _, _ = main_components(mask)
            m = constrained_surface(mask, affine, faces=cortex_faces)
            region = nearest_region(m.vertices, cortex_index, affine, normals=np.asarray(m.vertex_normals))
            meshes.append(gl_mesh(f"cortex_{hemi[0]}h", m, frame, region, {"group": "cortex", "hemisphere": hemi}))
            ras.append(("cortex", hemi, m, region))
        for s in table:
            if s["group"] == "cortex":
                continue
            mask, _, _ = main_components(np.isin(labels, s["labels"]), 0.02)
            m = constrained_surface(mask, affine, faces=sub_faces)
            meshes.append(gl_mesh(s["key"], m, frame, np.full(len(m.vertices), s["index"]), {"group": s["group"], "structure": s["key"]}))
            ras.append(("structure", s["key"], m, None))
        meshes_by_lod[lod], ras_by_lod[lod] = meshes, ras
    fidelity = brain_fidelity(ras_by_lod["low"], table, labels, affine, hemis, voxel_ml)

    glbs = {lod: write_glb(ms, {"assetId": "cor-brain-mindboggle", "version": "1.0.0"}) for lod, ms in meshes_by_lod.items()}

    # slice volumes: crop to the brain (+4 voxels), T1 to 8 bit by robust window inside the brain
    lo, hi = bbox(brain_mask, 4)
    crop = tuple(slice(a, b) for a, b in zip(lo, hi))
    t1c, ic = t1[crop], index[crop]
    p_lo, p_hi = np.percentile(t1c[brain_mask[crop]], [0.5, 99.5])
    mri_u8 = np.clip((t1c - p_lo) / (p_hi - p_lo) * 255, 0, 255).astype(np.uint8)
    shift = np.eye(4)
    shift[:3, 3] = lo
    crop_affine = affine @ shift
    to_app = np.eye(4)
    to_app[:3, :3] = RAS_TO_APP @ crop_affine[:3, :3]
    to_app[:3, 3] = RAS_TO_APP @ (crop_affine[:3, 3] - centre_mm)

    pts = np.vstack([m["attributes"]["POSITION"] for m in meshes_by_lod["low"]])
    manifest = {
        "assetId": "cor-brain-mindboggle-MMRR-21-5",
        "subject": subject_dir.name,
        "modality": "MRI T1-weighted (skull-stripped)",
        "units": "cm",
        "axes": {"x": "patient left", "y": "superior", "z": "anterior"},
        "bounds": {"min": [round(float(v), 3) for v in pts.min(axis=0)], "max": [round(float(v), 3) for v in pts.max(axis=0)]},
        "provenance": {
            "cortex": "Manual labels (DKT31 protocol), Mindboggle-101",
            "subcortical": "Automatic labels (FreeSurfer aseg), shipped with Mindboggle-101",
            "reviewedByClinician": False,
        },
        "dataset": {
            "name": "Mindboggle-101 release 3 (Klein & Tourville, Front. Neurosci. 2012, doi:10.3389/fnins.2012.00171)",
            "url": "https://osf.io/nhtur/",
            "license": "CC BY 4.0",
            "source": "MMRR-21 (Multi-Modal MRI Reproducibility Resource, Landman et al. 2011), via Mindboggle-101",
        },
        "files": {lod: {"url": f"brain-{lod}.glb", "bytes": len(glbs[lod])} for lod in glbs},
        "normals": "not stored; computed in the browser (computeVertexNormals) to keep the full-resolution cortex small",
        "volume": {
            "mri": "mri.u8.gz", "labels": "labels.u8.gz",
            "dims": [int(v) for v in mri_u8.shape],  # i, j, k (x fastest in the raw file: C order reversed below)
            "order": "C (i slowest, k fastest)",
            "spacingMm": [round(float(v), 4) for v in np.linalg.norm(crop_affine[:3, :3], axis=0)],
            "voxelToApp": [[round(float(v), 6) for v in row] for row in to_app],
            "orientation": "".join(nib.aff2axcodes(crop_affine)),
        },
        "structures": table,
        "totals": {
            "brainMl": round(float(np.count_nonzero(brain_mask)) * voxel_ml, 1),
            "cortexLeftMl": round(sum(s["volumeMl"] for s in table if s["group"] == "cortex" and s["hemisphere"] == "left"), 1),
            "cortexRightMl": round(sum(s["volumeMl"] for s in table if s["group"] == "cortex" and s["hemisphere"] == "right"), 1),
        },
        "fidelity": fidelity,
        "knownLimitations": [
            "Healthy adult volunteer from an open research dataset; not a patient, no diagnosis.",
            "Cortical regions are manual labels on one MRI; deep structures are automatic (FreeSurfer) and not manually reviewed.",
            "Surfaces are built from 1 mm voxel labels and smoothed; they are not FreeSurfer surface reconstructions.",
            "Colours are diagrammatic (by lobe), not tissue colour.",
            "Volumes are label voxel counts in the scan's native space (not head-size normalised).",
        ],
    }
    return glbs, manifest, mri_u8, ic


def brain_fidelity(ras_meshes, table, labels, affine, hemis, voxel_ml) -> dict:
    """COR-Fit report for the published (low) LOD: every structure's rendered surface vs its labels.

    Cortical regions are compared on the outer (pial-side) boundary only: label faces that border the
    same hemisphere's own tissue are inside the brain and not rendered. Deep structures are closed
    surfaces, so their volume is compared too.
    """
    tol = float(np.linalg.norm(affine[:3, :3], axis=0).max())  # one voxel
    by_key = {s["key"]: s for s in table}
    rows = []
    for kind, key, mesh, region in ras_meshes:
        if kind == "cortex":
            inside = hemis[key]
            for s in (x for x in table if x["group"] == "cortex" and x["hemisphere"] == key):
                m = surface_metrics(mesh, np.flatnonzero(region == s["index"]),
                                    boundary_points(np.isin(labels, s["labels"]), affine, exclude=inside & ~np.isin(labels, s["labels"])), tol)
                rows.append({"index": s["index"], "group": "cortex", **(m or {"nsdPercent": None})})
        else:
            s = by_key[key]
            mask = np.isin(labels, s["labels"])
            m = surface_metrics(mesh, np.arange(len(mesh.vertices)), boundary_points(mask, affine), tol)
            label_ml = float(mask.sum()) * voxel_ml
            rows.append({"index": s["index"], "group": s["group"], **(m or {"nsdPercent": None}),
                         "volumeErrorPercent": round(100 * (abs(mesh.volume) / 1000 - label_ml) / label_ml, 2)})
    return {
        "method": "COR-Fit v1: symmetric surface distance between the rendered mesh and the voxel boundary of its source label (docs/cor-fit.md)",
        "lod": "low",
        "toleranceMm": round(tol, 2),
        "structures": rows,
        "overall": summarise(rows, round(tol, 2)),
        "cortex": summarise([r for r in rows if r["group"] == "cortex"], round(tol, 2)),
        "deep": summarise([r for r in rows if r["group"] != "cortex"], round(tol, 2)),
    }


def voxel_centre(mask, affine):
    lo, hi = bbox(mask, 0)
    return affine[:3, :3] @ ((lo + hi - 1) / 2) + affine[:3, 3]


def bbox(mask, pad):
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(axis=0) - pad, 0)
    hi = np.minimum(idx.max(axis=0) + pad + 1, mask.shape)
    return lo, hi


def gl_mesh(name, mesh: trimesh.Trimesh, frame: Frame, region: np.ndarray, extras: dict) -> dict:
    return {
        "name": name,
        "attributes": {
            "POSITION": frame.point(mesh.vertices).astype(np.float32),
            "_REGION": np.repeat(np.asarray(region, dtype=np.uint8)[:, None], 1, axis=1),
        },
        "indices": mesh.faces,
        "extras": extras,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("subject_dir")
    parser.add_argument("out_dir")
    parser.add_argument("--app", action="store_true", help="also publish (low LOD + volumes) to public/brain/<subject>/")
    parser.add_argument("--force", action="store_true", help="publish even if the COR-Fit gate fails")
    args = parser.parse_args()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    glbs, manifest, mri, index = build(Path(args.subject_dir))
    for lod, data in glbs.items():
        (out / f"brain-{lod}.glb").write_bytes(data)
    (out / "mri.u8.gz").write_bytes(gzip.compress(mri.tobytes(order="C"), 9, mtime=0))
    (out / "labels.u8.gz").write_bytes(gzip.compress(index.tobytes(order="C"), 9, mtime=0))
    (out / "brain-manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{manifest['subject']}: {len(manifest['structures'])} structures, brain {manifest['totals']['brainMl']} mL")
    print("  " + ", ".join(f"{k} {len(v) / 1e6:.1f} MB" for k, v in glbs.items()))
    for f in ("mri.u8.gz", "labels.u8.gz"):
        print(f"  {f} {(out / f).stat().st_size / 1e6:.2f} MB, dims {manifest['volume']['dims']}")
    f = manifest["fidelity"]
    print(f"  COR-Fit: {f['overall']['nsdPercent']}% of surface within {f['toleranceMm']} mm, mean {f['overall']['meanMm']} mm")
    problems = gate(f["overall"], [r["volumeErrorPercent"] for r in f["structures"] if "volumeErrorPercent" in r])
    if problems:
        print("  COR-Fit gate: " + "; ".join(problems))
    if args.app and problems and not args.force:
        raise SystemExit("not published: COR-Fit gate failed (use --force to override)")
    if args.app:
        app = Path(__file__).resolve().parents[2] / "public/brain" / manifest["subject"]
        app.mkdir(parents=True, exist_ok=True)
        for f in ("brain-low.glb", "mri.u8.gz", "labels.u8.gz"):
            (app / f).write_bytes((out / f).read_bytes())
        published = {**manifest, "files": {"low": manifest["files"]["low"]}}
        (app / "brain-manifest.json").write_text(json.dumps(published, indent=2) + "\n")
        print(f"  published -> {app}")


if __name__ == "__main__":
    main()
