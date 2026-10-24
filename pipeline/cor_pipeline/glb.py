"""Minimal glTF 2.0 binary writer (port of scripts/heart-asset/glb.ts).

Triangle meshes with float32 or normalized-uint8 attributes, uint32 indices.
"""

import json
import struct

import numpy as np

_TYPE = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}


def write_glb(meshes: list[dict], asset_extras: dict) -> bytes:
    """meshes: [{"name", "attributes": {NAME: ndarray (n, k) float32|uint8}, "indices": (m, 3), "extras"}]"""
    blob = bytearray()
    buffer_views, accessors = [], []

    def push(data: bytes, target: int) -> int:
        blob.extend(b"\0" * ((4 - len(blob) % 4) % 4))
        buffer_views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(buffer_views) - 1

    gltf_meshes = []
    for mesh in meshes:
        attributes = {}
        for name, data in mesh["attributes"].items():
            data = np.ascontiguousarray(data)
            is_float = data.dtype == np.float32
            if not is_float and data.dtype != np.uint8:
                raise TypeError(f"{name}: attributes must be float32 or uint8, got {data.dtype}")
            accessor = {
                "bufferView": push(data.tobytes(), 34962),
                "componentType": 5126 if is_float else 5121,
                "count": int(data.shape[0]),
                "type": _TYPE[data.shape[1]],
            }
            if not is_float:
                accessor["normalized"] = True
            if name == "POSITION":
                accessor["min"] = data.min(axis=0).tolist()
                accessor["max"] = data.max(axis=0).tolist()
            accessors.append(accessor)
            attributes[name] = len(accessors) - 1
        indices = np.ascontiguousarray(mesh["indices"], dtype=np.uint32).ravel()
        accessors.append({
            "bufferView": push(indices.tobytes(), 34963),
            "componentType": 5125,
            "count": int(indices.size),
            "type": "SCALAR",
        })
        gltf_meshes.append({
            "name": mesh["name"],
            "primitives": [{"attributes": attributes, "indices": len(accessors) - 1, "mode": 4}],
            "extras": mesh.get("extras", {}),
        })

    document = {
        "asset": {"version": "2.0", "generator": "cor-heart-studio CT pipeline", "extras": asset_extras},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(meshes)))}],
        "nodes": [{"name": m["name"], "mesh": i} for i, m in enumerate(meshes)],
        "meshes": gltf_meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(blob)}],
    }
    json_bytes = json.dumps(document).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    blob.extend(b"\0" * ((4 - len(blob) % 4) % 4))
    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    return b"".join([
        struct.pack("<III", 0x46546C67, 2, total),
        struct.pack("<II", len(json_bytes), 0x4E4F534A), json_bytes,
        struct.pack("<II", len(blob), 0x004E4942), bytes(blob),
    ])
