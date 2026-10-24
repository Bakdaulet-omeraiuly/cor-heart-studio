"""Render structures.glb to a PNG (anterior and left views) for a quick visual check.

    python -m cor_pipeline.preview <out_dir>
"""

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import trimesh  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

COLOURS = {
    "lv": "#c0392b", "rv": "#2e86c1", "la": "#e67e22", "ra": "#8e44ad",
    "aorta": "#e74c3c", "pulmonary_artery": "#3498db",
}


def render(out_dir: Path) -> Path:
    scene = trimesh.load(out_dir / "structures.glb")
    meshes = json.loads((out_dir / "report.json").read_text())["meshes"]
    # App frame -> matplotlib (x right on screen when viewed from the front): plot (X, Z, Y) with Y up.
    fig = plt.figure(figsize=(12, 6))
    for col, (title, azim) in enumerate([("anterior", -90), ("left lateral", 0)]):
        ax = fig.add_subplot(1, 2, col + 1, projection="3d")
        for name, mesh in scene.geometry.items():
            wall = meshes[name]["kind"] == "wall"
            colour = "#f5b7b1" if wall else COLOURS.get(meshes[name]["region"], "#999")
            alpha = 0.25 if wall else 0.9
            tris = mesh.vertices[mesh.faces][:, :, [0, 2, 1]]
            ax.add_collection3d(Poly3DCollection(tris, facecolors=colour, edgecolor="none", alpha=alpha, shade=True))
        lim = max(abs(scene.bounds).max(), 1)
        ax.set_xlim(-lim, lim), ax.set_ylim(-lim, lim), ax.set_zlim(-lim, lim)
        ax.view_init(elev=10, azim=azim)
        ax.set_title(f"{out_dir.name}: {title}")
        ax.set_xlabel("X (left)"), ax.set_ylabel("Z (anterior)"), ax.set_zlabel("Y (superior)")
    path = out_dir / "preview.png"
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    return path





REGION_COLOURS = ["#c0392b", "#2e86c1", "#e67e22", "#8e44ad", "#e74c3c", "#3498db"]


def view_along(direction) -> tuple[float, float]:
    """matplotlib (elev, azim) for a camera placed on the +direction side (app axes; plot axes X, Z, Y)."""
    import numpy as np

    x, z, y = direction[0], direction[2], direction[1]
    return float(np.degrees(np.arcsin(np.clip(y, -1, 1)))), float(np.degrees(np.arctan2(z, x)))


def render_asset(asset_dir: Path) -> Path:
    """Check the attribute contract: regions (anterior view) and wall depth on a cut through the LV."""
    import numpy as np

    manifest = json.loads((asset_dir / "manifest.json").read_text())
    mesh = next(iter(trimesh.load(asset_dir / "heart-low.glb").geometry.values()))
    tissue = np.asarray(mesh.vertex_attributes["_TISSUE"])
    region = tissue[mesh.faces[:, 0], 3]
    depth = tissue[mesh.faces, 0].mean(axis=1) / 255
    tris = mesh.vertices[mesh.faces]
    lv = manifest["deformation"]["lv"]
    base, ant = np.array(lv["base"]), np.array(lv["anteriorDir"])

    fig = plt.figure(figsize=(12, 6))
    panels = [
        ("regions, anterior", np.ones(len(tris), bool), [REGION_COLOURS[min(r, 5)] for r in region], (10, -90)),
        # keep the posterior half of a cut along the LV long axis (septal-lateral plane), seen from the front
        ("wall depth (0 epi yellow .. 1 endo purple), cut", (tris.mean(axis=1) - base) @ ant < 0, plt.cm.viridis_r(depth), view_along(ant)),
    ]
    for col, (title, keep, colours, (elev, azim)) in enumerate(panels):
        ax = fig.add_subplot(1, 2, col + 1, projection="3d")
        colours = np.asarray(colours, dtype=object if isinstance(colours, list) else float)[keep]
        ax.add_collection3d(Poly3DCollection(tris[keep][:, :, [0, 2, 1]], facecolors=list(colours), edgecolor="none", shade=True))
        valves = manifest["valves"]
        for v in valves.values():
            c, n = np.array(v["center"]), np.array(v["normal"])
            ax.quiver(c[0], c[2], c[1], n[0], n[2], n[1], length=2, color="black")
        lim = np.abs(mesh.bounds).max()
        ax.set_xlim(-lim, lim), ax.set_ylim(-lim, lim), ax.set_zlim(-lim, lim)
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(f"{asset_dir.parent.name}: {title}")
    path = asset_dir / "preview.png"
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1])
    print(render_asset(target) if (target / "manifest.json").exists() else render(target))
