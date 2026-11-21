"""Export the reusable assets in biwa-platform.blend, with their materials and lights.

blender -b models/biwa-platform.blend -P analysis/export-platform.py
"""
import gzip
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy

root = Path(bpy.data.filepath).resolve().parents[1]
out = root / 'assets/models'


def export(collection_name, file):
    collection = bpy.data.collections[collection_name]
    scene = next(scene for scene in bpy.data.scenes if collection in scene.collection.children[:])
    bpy.context.window.scene = scene
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.all_objects:
        obj.select_set(True)
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'asset.glb'
        bpy.ops.export_scene.gltf(
            filepath=str(path), use_active_scene=True, use_selection=True, export_apply=True, export_extras=True,
            export_animations=False, export_cameras=False, export_lights=True,
            export_vertex_color='ACTIVE',
        )
        data = path.read_bytes()
        if file.endswith('.gz'):
            data = gzip.compress(data, compresslevel=9, mtime=0)
        (out / file).write_bytes(data)


export('Launch Platform', 'biwa-platform.glb.gz')
# The crew's release calculation also runs without rendering the platform.
crew_layout = {'deck_half_width': bpy.context.scene['deck_half_width']}
(root / 'src/rendering/biwa-platform.json').write_text(json.dumps(crew_layout) + '\n')
export('Practice Buoy', 'practice-buoy.glb')
