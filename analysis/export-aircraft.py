"""Run Blender in background with an aircraft .blend open and this script.

Edit the collection, named pivots, vertex groups and wing shape keys in Blender.
The viewer, collision tests and flight analyses consume the same exported GLB.
"""
import gzip
import json
import struct
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy

scene = bpy.context.scene
name = scene["aircraft_id"]
root = Path(bpy.data.filepath).resolve().parents[1]
assembly = bpy.data.collections[scene["aircraft_collection"]]
bpy.ops.object.select_all(action="DESELECT")
for obj in assembly.all_objects:
    if obj.get("wingSide"):
        keys = obj.data.shape_keys.key_blocks
        if list(keys.keys())[1:] != ["Bend", "Twist", "FoldUp", "FoldDown"]:
            raise ValueError(f"{obj.name}: expected bend, twist and both fold targets")
        if any(abs(key.value) > 1e-6 for key in list(keys)[1:]):
            raise ValueError(f"{obj.name}: save the unloaded wing before export")
    obj.select_set(True)
with TemporaryDirectory() as directory:
    glb = Path(directory) / (name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=str(glb), use_selection=True, export_extras=True, export_animations=False,
        export_morph=True, export_morph_normal=True, export_materials="EXPORT",
        export_vertex_color="ACTIVE", export_all_vertex_colors=False,
    )
    target = root / "assets" / "models" / ("aircraft-" + name + ".glb.gz")
    # Blender stores translations as float32. Express the authored rig datums
    # in micrometres so simulation seeks can reproduce exact decimal stations.
    binary = glb.read_bytes()
    json_size = struct.unpack_from("<I", binary, 12)[0]
    model = json.loads(binary[20:20 + json_size])
    for node in model["nodes"]:
        if "translation" in node:
            node["translation"] = [round(v, 6) for v in node["translation"]]
    document = json.dumps(model, separators=(",", ":"), ensure_ascii=False).encode()
    document += b" " * (-len(document) % 4)
    chunk = binary[20 + json_size:]
    binary = struct.pack("<4sIII4s", b"glTF", 2, 20 + len(document) + len(chunk), len(document), b"JSON") + document + chunk
    target.write_bytes(gzip.compress(binary, compresslevel=9, mtime=0))
    print(f"{target.name}: {target.stat().st_size:,} bytes")
