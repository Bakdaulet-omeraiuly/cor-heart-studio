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


if __name__ == "__main__":
    print(render(Path(sys.argv[1])))
