"""Fit the BodyParts3D atlas onto a target heart, and seat vessel centrelines on its epicardium.

All work happens in the app frame in millimetres (+X patient left, +Y superior, +Z anterior); manifests store the
same frame in centimetres. The warp is a similarity transform from five landmarks (apex and the four valve
centres, Umeyama 1991) followed by a thin-plate spline over those landmarks plus closest-point surface pairs
(3 ICP rounds). Landmarks are interpolated exactly; surface pairs are smoothed.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
import trimesh
from scipy.interpolate import RBFInterpolator

LandmarkKey = Literal["apex", "aortic", "mitral", "tricuspid", "pulmonary"]
Landmarks = dict[str, np.ndarray]
KEYS: tuple[str, ...] = ("apex", "aortic", "mitral", "tricuspid", "pulmonary")
VALVE_KEYS = {"aortic": "aortic_valve", "mitral": "mitral_valve", "tricuspid": "tricuspid_valve", "pulmonary": "pulmonary_valve"}


class FitError(Exception):
    pass


def bp3d_to_app_mm(pts: np.ndarray) -> np.ndarray:
    """BodyParts3D (+X left, +Y posterior, +Z superior, mm) -> app frame in mm."""
    p = np.asarray(pts, float)
    return np.c_[p[:, 0], p[:, 2], -p[:, 1]]


def atlas_landmarks(parts: dict[str, trimesh.Trimesh]) -> Landmarks:
    """Valve centres (centroid of each valve part) and the LV apex (LV point farthest from the mitral centre)."""
    lm = {k: bp3d_to_app_mm(parts[v].vertices).mean(axis=0) for k, v in VALVE_KEYS.items()}
    lv = bp3d_to_app_mm(parts["left_ventricle"].vertices)
    lm["apex"] = lv[np.argmax(np.linalg.norm(lv - lm["mitral"], axis=1))]
    return lm


def target_landmarks(manifest: dict) -> Landmarks:
    v = manifest["valves"]
    lm = {k: np.asarray(v[name]["center"], float) * 10 for k, name in VALVE_KEYS.items()}
    lv = manifest["deformation"]["lv"]
    lm["apex"] = (np.asarray(lv["base"], float) + np.asarray(lv["axis"], float) * lv["epiApexAlong"]) * 10
    return lm


def _similarity(a: np.ndarray, b: np.ndarray):
    """Least-squares s, R, t with b ≈ s R a + t (no reflection)."""
    ma, mb = a.mean(0), b.mean(0)
    A, B = a - ma, b - mb
    U, S, Vt = np.linalg.svd(B.T @ A / len(a))
    D = np.eye(3)
    D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (A ** 2).sum(axis=1).mean()
    return s, R, mb - s * R @ ma


class Warp:
    def __init__(self, s, R, t, rbf: RBFInterpolator | None):
        self.s, self.R, self.t, self.rbf = s, R, t, rbf

    def similarity(self, pts: np.ndarray) -> np.ndarray:
        return self.s * np.asarray(pts, float) @ self.R.T + self.t

    def __call__(self, pts: np.ndarray) -> np.ndarray:
        p = self.similarity(pts)
        return p if self.rbf is None else p + self.rbf(p)


def outer_shell(mesh: trimesh.Trimesh, pitch_mm: float = 1.5) -> trimesh.Trimesh:
    """Outer surface of the union of the atlas chambers: septa and chamber-contact faces have no epicardium to pair
    with, so closest-point pairs from them pull the fit the wrong way."""
    vox = mesh.voxelized(pitch_mm).fill()
    shell = vox.marching_cubes
    shell.apply_transform(vox.transform)
    return shell


def fit(atlas_epi: trimesh.Trimesh, target_epi: trimesh.Trimesh, a: Landmarks, b: Landmarks,
        n_surface: int = 300, rounds: int = 3, smoothing: float = 5.0, seed: int = 0,
        surface: Literal["all", "shell"] = "all") -> Warp:
    """surface="shell": surface pairs from the atlas's outer shell only (Tier B hearts, docs/atlas-heart.md)."""
    if surface == "shell":
        atlas_epi = outer_shell(atlas_epi)
    la = np.array([a[k] for k in KEYS])
    lb = np.array([b[k] for k in KEYS])
    s, R, t = _similarity(la, lb)
    warp = Warp(s, R, t, None)
    rng = np.random.default_rng(seed)
    src = atlas_epi.vertices[rng.choice(len(atlas_epi.vertices), size=min(n_surface, len(atlas_epi.vertices)), replace=False)]
    src_sim = warp.similarity(src)
    la_sim = warp.similarity(la)
    for _ in range(rounds):
        moved = warp(src)
        closest = target_epi.nearest.on_surface(moved)[0]
        ctrl = np.vstack([la_sim, src_sim])
        disp = np.vstack([lb - la_sim, closest - src_sim])
        smooth = np.r_[np.zeros(len(la_sim)), np.full(len(src_sim), smoothing)]
        warp = Warp(s, R, t, RBFInterpolator(ctrl, disp, kernel="thin_plate_spline", smoothing=smooth))
    return warp


def snap_to_surface(pts: np.ndarray, radius: np.ndarray, target_epi: trimesh.Trimesh, lift: float = 1.9,
                    max_shift_mm: float = 6.0) -> tuple[np.ndarray, dict]:
    """Project a centreline onto the epicardium and lift it by radius*lift (the vessel rides on the groove fat).

    Raises FitError when a point needs a shift above max_shift_mm: the registered path does not follow this heart's
    surface (e.g. it cuts through a chamber), and must not ship.
    """
    pts = np.asarray(pts, float)
    radius = np.asarray(radius, float)
    closest, dist, tri = target_epi.nearest.on_surface(pts)
    if dist.max() > max_shift_mm:
        worst = int(np.argmax(dist))
        raise FitError(f"centreline point {worst} is {dist[worst]:.1f} mm from the epicardium (limit {max_shift_mm} mm)")
    out = closest + target_epi.face_normals[tri] * (radius * lift)[:, None]
    signed = trimesh.proximity.signed_distance(target_epi, out)  # positive = inside the tissue
    height = target_epi.nearest.on_surface(out)[1]
    within = np.abs(height - radius * lift) <= 1.0
    report = {"withinMm1Percent": round(float(within.mean() * 100), 1), "maxInsideMm": round(float(max(signed.max(), 0.0)), 2)}
    if report["maxInsideMm"] > 0.5:
        raise FitError(f"vessel passes {report['maxInsideMm']} mm inside the tissue")
    return out, report
