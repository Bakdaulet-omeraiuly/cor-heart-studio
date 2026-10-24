"""Coronary arteries and epicardial fat seated on a heart template surface (right-dominant pattern).

The source meshes have no coronaries, so they are routed the way they run in a typical right-dominant heart:
along the grooves where the chamber surfaces meet (atrioventricular and interventricular sulci). A groove is
where two chamber "outer" distance fields are equal on the epicardium; arteries follow the cheapest path
over the surface graph with the edge cost lowered along the groove they belong to.

Lumen diameters (mm, mean ± SD) at the origin, Dodge et al. 1992 (Circulation 86:232, doi:10.1161/01.cir.86.1.232):
left main 4.5 ± 0.5, proximal LAD 3.7 ± 0.4, distal LAD 1.9 ± 0.4, proximal RCA 3.9 ± 0.6 and proximal LCx
3.4 ± 0.5 (right-dominant). Distal RCA / LCx / PDA calibres are not in the abstract: tapered to 2.0 / 1.8 mm
(assumption, marked in the manifest).

Every tube vertex carries `_CORO` = (vessel id, position along the vessel 0..1, lumen radius in 0.05 mm units,
0) so the renderer can narrow a segment for a reported stenosis.
"""

from __future__ import annotations

import heapq

from collections.abc import Iterable

import numpy as np
import trimesh

VESSELS = {  # id: (name, proximal diameter mm, distal diameter mm, distal-is-assumed)
    1: ("LM", 4.5, 4.5, False),
    2: ("LAD", 3.7, 1.9, False),
    3: ("LCx", 3.4, 1.8, True),
    4: ("RCA", 3.9, 2.0, True),
    5: ("PDA", 2.0, 1.4, True),
    # atlas branches and veins (docs/atlas-heart.md): diameters are the atlas specimen's, scaled to this heart, when
    # the atlas has the vessel; the numbers here are the fallback for illustrative branches (assumed, marked as such)
    6: ("D1", 2.4, 1.2, True), 7: ("D2", 2.0, 1.0, True), 14: ("D3", 1.8, 1.0, True), 15: ("D4", 1.6, 0.9, True),
    9: ("OM", 2.4, 1.4, True), 10: ("conal", 1.4, 0.9, True), 11: ("SA_nodal", 1.0, 0.8, True),
    12: ("acute_marginal", 1.8, 1.0, True), 13: ("PLB", 2.0, 1.2, True),
    20: ("great_cardiac_vein", 4.0, 3.0, True), 21: ("middle_cardiac_vein", 3.0, 2.0, True),
    22: ("small_cardiac_vein", 2.0, 1.5, True), 24: ("coronary_sinus", 8.0, 7.0, True),
    25: ("posterior_lv_vein", 2.5, 1.8, True), 26: ("left_marginal_vein", 2.5, 1.8, True),
}
VESSEL_KIND = {i: (4 if i >= 20 else 3) for i in VESSELS}  # _TISSUE kind byte: 3 coronary artery, 4 coronary vein
DIAGONALS = ["D1", "D2", "D3", "D4"]
MIN_BRANCH_MM = 15.0
SEGMENTS = 14  # ring resolution
LM_LENGTH_MM = 10.0  # typical left main length (assumption; not in the Dodge abstract)


def _graph(mesh: trimesh.Trimesh, cost: np.ndarray):
    edges = mesh.edges_unique
    length = mesh.edges_unique_length
    w = length * 0.5 * (cost[edges[:, 0]] + cost[edges[:, 1]])
    adj: list[list[tuple[int, float]]] = [[] for _ in range(len(mesh.vertices))]
    for (a, b), c in zip(edges, w):
        adj[a].append((b, c))
        adj[b].append((a, c))
    return adj


def _path(adj, start: int, goal: int) -> list[int]:
    dist = {start: 0.0}
    prev: dict[int, int] = {}
    pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal:
            break
        if d > dist.get(u, np.inf):
            continue
        for v, c in adj[u]:
            nd = d + c
            if nd < dist.get(v, np.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    out = [goal]
    while out[-1] != start:
        out.append(prev[out[-1]])
    return out[::-1]


def _smooth(points: np.ndarray, spacing_mm: float = 1.5, passes: int = 6) -> np.ndarray:
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(4, int(s[-1] / spacing_mm))
    t = np.linspace(0, s[-1], n)
    p = np.stack([np.interp(t, s, points[:, k]) for k in range(3)], axis=1)
    for _ in range(passes):
        p[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
    return p


def _tube(center: np.ndarray, radius: np.ndarray, vessel: int, t0: float, t1: float):
    """Ring vertices around a centreline: positions, outward normals, along-vessel t, radius."""
    tang = np.gradient(center, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0])
    n0 = np.cross(tang[0], ref if abs(tang[0] @ ref) < 0.9 else np.array([1.0, 0, 0]))
    n0 /= np.linalg.norm(n0)
    normals = [n0]
    for i in range(1, len(center)):  # parallel transport, no twisting
        n = normals[-1] - (normals[-1] @ tang[i]) * tang[i]
        normals.append(n / np.linalg.norm(n))
    normals = np.array(normals)
    binorm = np.cross(tang, normals)
    ang = np.linspace(0, 2 * np.pi, SEGMENTS, endpoint=False)
    ring = np.cos(ang)[None, :, None] * normals[:, None, :] + np.sin(ang)[None, :, None] * binorm[:, None, :]
    pos = center[:, None, :] + ring * radius[:, None, None]
    m = len(center)
    faces = []
    for i in range(m - 1):
        for j in range(SEGMENTS):
            a, b = i * SEGMENTS + j, i * SEGMENTS + (j + 1) % SEGMENTS
            c, d = a + SEGMENTS, b + SEGMENTS
            faces += [[a, b, c], [b, d, c]]  # counter-clockwise seen from outside
    t = np.repeat(np.linspace(t0, t1, m), SEGMENTS)
    r = np.repeat(radius, SEGMENTS)
    vid = np.full(m * SEGMENTS, vessel)
    return pos.reshape(-1, 3), ring.reshape(-1, 3), np.array(faces), t, r, vid


def route(mesh: trimesh.Trimesh, s: dict[str, np.ndarray], frame_dirs: dict[str, np.ndarray], ostia: dict[str, np.ndarray], apex: np.ndarray):
    """Vessel centrelines (RAS mm) on the epicardium.

    s: per-vertex samples of the outer fields (lv_outer, rv_outer, la_outer, ra_outer, outer) and the cavity field.
    frame_dirs: 'anterior' (the patient's anterior, RAS +y) and 'axis' (LV base -> apex) unit vectors in RAS.
    A groove's cost is continuous: |field A - field B| (mm), so the cheapest path runs along the bottom of the crease.
    """
    from scipy.spatial import cKDTree

    v = np.asarray(mesh.vertices)
    # the true outside: on the outer surface AND away from every blood pool. Without the second test the RV's
    # septal endocardium counts (the RV cavity lies directly on the LV epicardium there) and the LAD runs inside the RV.
    epi = (np.abs(s["outer"]) < 0.8) & (s["cavity"] > 0.9)
    vent = np.minimum(s["lv_outer"], s["rv_outer"])
    atria = np.minimum(s["la_outer"], s["ra_outer"])
    g_av = np.abs(vent - atria)
    g_iv = np.abs(s["lv_outer"] - s["rv_outer"]) + np.clip(6 - atria, 0, None)  # away from the atria
    ant = (v - v.mean(axis=0)) @ frame_dirs["anterior"]
    along = (v - v.mean(axis=0)) @ frame_dirs["axis"]

    def cost(groove, extra=None):
        c = np.where(epi, 1.0 + 0.6 * np.minimum(groove, 15.0), 200.0)
        if extra is not None:
            c = c + extra
        return c

    def nearest(p, mask):
        idx = np.flatnonzero(mask)
        return int(idx[np.argmin(np.linalg.norm(v[idx] - p, axis=1))])

    paths = {}
    lm0 = nearest(ostia["left"], epi)
    rca0 = nearest(ostia["right"], epi)
    apex_v = nearest(apex, epi)
    # Left system: one path from the left ostium to the apex along the AV groove then the anterior
    # interventricular groove; its first LM_LENGTH_MM is the left main (typical length, an assumption), the
    # rest the LAD. The circumflex leaves at the end of the left main.
    junction = epi & (g_iv < 3) & (g_av < 6) & (ant > 0)
    lad_entry = nearest(v[lm0], junction) if junction.any() else nearest(v[lm0], epi & (g_iv < 3))
    left = _path(_graph(mesh, cost(np.minimum(g_av, g_iv))), lm0, lad_entry)
    left += _path(_graph(mesh, cost(g_iv, np.where(ant < 0, 8.0, 0.0))), lad_entry, apex_v)[1:]
    run = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(v[left], axis=0), axis=1))])
    split = max(2, int(np.searchsorted(run, LM_LENGTH_MM)))
    paths["LM"] = left[:split + 1]
    paths["LAD"] = left[split:]
    lad0 = left[split]
    # crux: posterior meeting point of the interventricular and AV grooves, low on the base
    crux_mask = epi & (g_iv < 3) & (g_av < 6) & (ant < 0)
    crux = nearest(v[apex_v] * 0 + v[epi].mean(axis=0) - frame_dirs["anterior"] * 40, crux_mask) if crux_mask.any() else nearest(v[apex_v], epi)
    left_side = s["la_outer"] < s["ra_outer"]
    # LCx: left AV groove from the LM end round to the obtuse margin (stops short of the crux: right dominance)
    lcx_mask = epi & (g_av < 3) & left_side & (ant < 0.0 + 1e9)
    lcx_cand = np.flatnonzero(lcx_mask)
    lcx_end = int(lcx_cand[np.argmax(-v[lcx_cand, 0] - 0.3 * ant[lcx_cand])]) if len(lcx_cand) else crux
    paths["LCx"] = _path(_graph(mesh, cost(g_av, np.where(left_side, 0.0, 8.0))), lad0, lcx_end)
    # RCA: right AV groove from the right ostium round the acute margin to the crux
    # ... via the acute margin: the rightmost (RAS +x) point of the right AV groove
    rav = np.flatnonzero(epi & (g_av < 3) & ~left_side)
    adj_r = _graph(mesh, cost(g_av, np.where(left_side, 8.0, 0.0)))
    if len(rav):
        margin = int(rav[np.argmax(v[rav, 0])])
        paths["RCA"] = _path(adj_r, rca0, margin)[:-1] + _path(adj_r, margin, crux)
    else:
        paths["RCA"] = _path(adj_r, rca0, crux)
    # PDA: posterior interventricular groove from the crux toward the apex, about two thirds of the way
    pda_target = nearest(v[crux] + (v[apex_v] - v[crux]) * 0.7, epi & (g_iv < 3)) if (epi & (g_iv < 3)).any() else apex_v
    paths["PDA"] = _path(_graph(mesh, cost(g_iv, np.where(ant > 0, 8.0, 0.0))), crux, pda_target)
    return {k: v[p] for k, p in paths.items()}, {"g_av": g_av, "g_iv": g_iv}


def build_vessels(centrelines: dict[str, np.ndarray], normals_at, lift_mm: float = 1.9, radii: dict[str, np.ndarray] | None = None):
    """Tube mesh arrays for every vessel. Centrelines are lifted by radius*lift: in a groove the artery rides on the
    epicardial fat that fills the crease, so its centre sits about a diameter above the muscle surface."""
    pos, nrm, faces, t, r, vid = [], [], [], [], [], []
    base = 0
    name_to_id = {n: i for i, (n, *_ ) in VESSELS.items()}
    for name, pts in centrelines.items():
        vessel = name_to_id[name]
        _, d0, d1, _ = VESSELS[vessel]
        c = _smooth(pts)
        u = np.linspace(0, 1, len(c))
        if radii and name in radii:  # measured calibre along the vessel (atlas specimen, scaled)
            src = np.asarray(radii[name], float)
            radius = np.interp(u, np.linspace(0, 1, len(src)), src)
        else:
            radius = 0.5 * (d0 + (d1 - d0) * u)
        c = c + normals_at(c) * (radius * lift_mm)[:, None]
        p, n, f, tt, rr, ii = _tube(c, radius, vessel, 0.0, 1.0)
        pos.append(p); nrm.append(n); faces.append(f + base); t.append(tt); r.append(rr); vid.append(ii)
        base += len(p)
    return (np.concatenate(pos), np.concatenate(nrm), np.concatenate(faces), np.concatenate(t), np.concatenate(r), np.concatenate(vid))


def atlas_coronaries(parts: dict[str, trimesh.Trimesh], warp, surface_at, normals_at, outer_at, aortic: np.ndarray,
                     apex: np.ndarray, scale: float = 1.0, max_shift_mm: float = 12.0, max_inside_mm: float = 6.0,
                     required: Iterable[str] | None = None):
    """Coronary arteries and cardiac veins from atlas meshes, seated on this heart's epicardium.

    parts: atlas vessel meshes keyed like cor_pipeline.atlas.ATLAS_PARTS; warp maps their coordinates into this heart.
    surface_at / normals_at / outer_at: projection onto, outward normal of, and signed distance (mm, + outside) to
    the epicardium. Returns centrelines on the surface (build_vessels lifts them), lumen radii (mm), the source of
    every vessel ("atlas" or "illustrative") and a fit report. Raises FitError when a registered vessel runs more
    than max_inside_mm inside the tissue or more than max_shift_mm off the surface: it would not be this heart's
    vessel any more, so it must not be drawn. With `required` (e.g. STENOSIS_VESSELS), only those raise; any other
    branch that fails is left out and reported as {"source": "atlas", "drawn": False, "reason": ...}.
    """
    from .centreline import branches
    from .register import FitError  # noqa: F401  (re-exported for callers)

    names = {n for n, *_ in VESSELS.values()}
    lines, radii, sources, report = {}, {}, {}, {}

    def seat(name, pts, r, source):
        c = warp(np.asarray(pts, float))
        d = outer_at(c)
        if d.min() < -max_inside_mm or np.abs(d).max() > max_shift_mm:
            reason = (f"registered course is {-d.min():.1f} mm inside / {np.abs(d).max():.1f} mm off the "
                      f"epicardium (limits {max_inside_mm} / {max_shift_mm} mm)")
            if required is None or name in required:
                raise FitError(f"{name}: {reason}")
            report[name] = {"source": "atlas", "drawn": False, "reason": f"atlas fit failed: {reason}; not drawn"}
            return
        on = surface_at(c)
        if np.linalg.norm(on[-1] - aortic) < np.linalg.norm(on[0] - aortic):
            on, r = on[::-1], r[::-1]
        lines[name], radii[name], sources[name] = on, np.asarray(r, float) * scale, source
        report[name] = {"source": source, "maxShiftMm": round(float(np.abs(d).max()), 1), "maxInsideMm": round(float(max(-d.min(), 0)), 1)}

    for key, mesh in parts.items():
        if key == "D1":
            found = [b for b in branches(mesh, min_length_mm=MIN_BRANCH_MM) if len(b[0]) * 0.5 >= MIN_BRANCH_MM]
            for name, (pts, r) in zip(DIAGONALS, found):
                seat(name, pts, r, "atlas")
        elif key in names:
            pts, r = branches(mesh, min_length_mm=np.inf)[0]
            seat(key, pts, r, "atlas")
    # branches BodyParts3D 4.0 lacks, along their standard course (illustrative). Septal perforators run inside
    # the septum and are not drawn on the surface.
    def course(start, end, n=60):
        p = start[None] + np.linspace(0, 1, n)[:, None] * (end - start)[None]
        for _ in range(4):
            p = surface_at(p)
        return p
    if "LCx" in lines and "OM" not in lines:  # obtuse marginal: from the mid LCx down the lateral wall
        c = lines["LCx"]
        p0 = c[int(len(c) * 0.4)]
        lines["OM"] = course(p0, p0 + 0.6 * (apex - p0))
        radii["OM"] = np.linspace(VESSELS[9][1], VESSELS[9][2], len(lines["OM"])) / 2
        sources["OM"], report["OM"] = "illustrative", {"source": "illustrative"}
    if "RCA" in lines and "SA_nodal" not in lines:  # SA-nodal: from the proximal RCA up towards the base
        c = lines["RCA"]
        p0 = c[int(len(c) * 0.08)]
        up = (aortic - apex) / np.linalg.norm(aortic - apex)
        lines["SA_nodal"] = course(p0, p0 + up * 25.0, 30)
        radii["SA_nodal"] = np.linspace(VESSELS[11][1], VESSELS[11][2], len(lines["SA_nodal"])) / 2
        sources["SA_nodal"], report["SA_nodal"] = "illustrative", {"source": "illustrative"}
    return lines, radii, sources, report


from .register import FitError  # noqa: E402  (coronary.FitError is part of this module's interface)
