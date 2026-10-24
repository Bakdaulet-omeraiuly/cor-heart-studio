"""Centrelines of atlas vessel meshes: voxelise, skeletonise, walk the skeleton graph.

A vessel part is a union of overlapping element meshes (BodyParts3D), so every body is voxelised on its own and
OR-ed into one grid. The longest skeleton path from the end nearest `start_hint` is the vessel; `branches` keeps
peeling off the farthest remaining tip for vessel systems (e.g. the diagonals). Radius = distance to the wall.
"""

from __future__ import annotations

import heapq

import numpy as np
import trimesh
from scipy import ndimage
from skimage.morphology import skeletonize

STEP_MM = 0.5
_OFFSETS = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)])


def _closed(body: trimesh.Trimesh) -> trimesh.Trimesh:
    """Cap every open end with a fan around the loop centroid (atlas vessel elements are open tubes)."""
    body = body.copy()
    body.merge_vertices()
    if body.is_watertight:
        return body
    edges = body.edges_sorted
    uniq, count = np.unique(edges, axis=0, return_counts=True)
    boundary = uniq[count == 1]
    if not len(boundary):
        return body
    import networkx as nx
    g = nx.Graph()
    g.add_edges_from(boundary.tolist())
    verts, faces = [body.vertices], [body.faces]
    n = len(body.vertices)
    for loop in nx.cycle_basis(g):
        c = body.vertices[loop].mean(axis=0)
        verts.append(c[None])
        ring = np.array(loop)
        faces.append(np.c_[ring, np.roll(ring, -1), np.full(len(ring), n)])
        n += 1
    capped = trimesh.Trimesh(np.vstack(verts), np.vstack(faces), process=True)
    trimesh.repair.fix_normals(capped)
    return capped


def _voxelise(mesh: trimesh.Trimesh, pitch: float):
    lo = mesh.bounds[0] - 3 * pitch
    shape = np.ceil((mesh.bounds[1] - mesh.bounds[0]) / pitch).astype(int) + 7
    grid = np.zeros(shape, bool)
    merged = mesh.copy()
    merged.merge_vertices()
    for body in merged.split(only_watertight=False) or [merged]:
        if len(body.faces) < 4:
            continue
        pts = _closed(body).voxelized(pitch).fill().points
        idx = np.rint((pts - lo) / pitch).astype(int)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        grid[tuple(idx[ok].T)] = True
    return grid, lo


def _graph(skel: np.ndarray):
    nodes = np.argwhere(skel)
    index = -np.ones(skel.shape, np.int64)
    index[tuple(nodes.T)] = np.arange(len(nodes))
    adj: list[list[tuple[int, float]]] = [[] for _ in range(len(nodes))]
    for o in _OFFSETS:
        nb = nodes + o
        ok = np.all((nb >= 0) & (nb < skel.shape), axis=1)
        j = np.full(len(nodes), -1)
        j[ok] = index[tuple(nb[ok].T)]
        w = float(np.linalg.norm(o))
        for a in np.nonzero(j >= 0)[0]:
            adj[a].append((int(j[a]), w))
    return nodes, adj


def _dijkstra(adj, sources):
    dist = np.full(len(adj), np.inf)
    prev = np.full(len(adj), -1)
    heap = [(0.0, s) for s in sources]
    for s in sources:
        dist[s] = 0.0
    while heap:
        d, a = heapq.heappop(heap)
        if d > dist[a]:
            continue
        for b, w in adj[a]:
            if d + w < dist[b]:
                dist[b], prev[b] = d + w, a
                heapq.heappush(heap, (d + w, b))
    return dist, prev


def _walk(prev, end):
    path = [end]
    while prev[path[-1]] >= 0:
        path.append(int(prev[path[-1]]))
    return path


def _resample(pts: np.ndarray, radius: np.ndarray, smooth_mm: float = 2.0, step: float = STEP_MM):
    if len(pts) < 3:
        return pts, radius
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    n = max(int(s[-1] / 0.1), 2)
    u = np.linspace(0, s[-1], n)
    dense = np.c_[[np.interp(u, s, pts[:, i]) for i in range(3)]].T
    rad = np.interp(u, s, radius)
    k = max(int(smooth_mm / 0.1), 1)
    pad = np.pad(dense, ((k, k), (0, 0)), mode="reflect", reflect_type="odd")
    kernel = np.ones(2 * k + 1) / (2 * k + 1)
    dense = np.c_[[np.convolve(pad[:, i], kernel, mode="valid") for i in range(3)]].T
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    m = max(int(round(s[-1] / step)), 1)
    v = np.linspace(0, s[-1], m + 1)
    out = np.c_[[np.interp(v, s, dense[:, i]) for i in range(3)]].T
    return out, np.interp(v, s, rad)


def _prepare(mesh, voxel_mm):
    grid, lo = _voxelise(mesh, voxel_mm)
    edt = ndimage.distance_transform_edt(grid) * voxel_mm
    skel = skeletonize(grid)
    nodes, adj = _graph(skel)
    pos = lo + nodes * voxel_mm
    rad = edt[tuple(nodes.T)]
    return nodes, adj, pos, rad


def _start(pos, adj, start_hint):
    if start_hint is not None:
        ends = [i for i, a in enumerate(adj) if len(a) <= 1] or list(range(len(adj)))
        return min(ends, key=lambda i: np.linalg.norm(pos[i] - start_hint))
    dist, _ = _dijkstra(adj, [0])
    return int(np.argmax(np.where(np.isfinite(dist), dist, -1)))


def centreline(mesh: trimesh.Trimesh, voxel_mm: float = 0.25, start_hint: np.ndarray | None = None):
    """Ordered centreline points (N×3, mm, every 0.5 mm) and lumen radius per point (mm)."""
    paths = branches(mesh, min_length_mm=np.inf, voxel_mm=voxel_mm, start_hint=start_hint)
    return paths[0]


def branches(mesh: trimesh.Trimesh, min_length_mm: float = 8.0, voxel_mm: float = 0.25,
             start_hint: np.ndarray | None = None) -> list[tuple[np.ndarray, np.ndarray]]:
    """The main path from the start, then every side branch ≥ min_length_mm (each ordered from its junction)."""
    nodes, adj, pos, rad = _prepare(mesh, voxel_mm)
    if not len(nodes):
        return []
    start = _start(pos, adj, None if start_hint is None else np.asarray(start_hint, float))
    dist, prev = _dijkstra(adj, [start])
    end = int(np.argmax(np.where(np.isfinite(dist), dist, -1)))
    main = _walk(prev, end)[::-1]
    out = [main]
    taken = set(main)
    while True:
        d, p = _dijkstra(adj, list(taken))
        d = np.where(np.isfinite(d), d, -1)
        tip = int(np.argmax(d))
        if d[tip] * voxel_mm < min_length_mm:
            # a separate body (vessel elements need not touch): start it from its end nearest the start
            rest = np.nonzero(d < 0)[0]
            if not len(rest):
                break
            seed = min(rest, key=lambda i: np.linalg.norm(pos[i] - pos[start]))
            dd, pp = _dijkstra(adj, [int(seed)])
            dd = np.where(np.isfinite(dd), dd, -1)
            far = int(np.argmax(dd))
            dd2, pp2 = _dijkstra(adj, [far])
            dd2 = np.where(np.isfinite(dd2), dd2, -1)
            other = int(np.argmax(dd2))
            path = _walk(pp2, other)
            if np.linalg.norm(pos[path[-1]] - pos[start]) > np.linalg.norm(pos[path[0]] - pos[start]):
                path = path[::-1]
            if dd2[other] * voxel_mm >= min_length_mm:
                out.append(path)
            taken.update(path)  # its side branches are found from here on the next rounds
            continue
        path = _walk(p, tip)[::-1]       # junction -> tip
        out.append(path)
        taken.update(path)
    return [_resample(pos[p], rad[p]) for p in out]
