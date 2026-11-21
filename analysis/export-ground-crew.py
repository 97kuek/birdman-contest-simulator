"""Export the rig at rest. Run with models/ground-crew.blend open in Blender."""
from pathlib import Path
from struct import pack, unpack_from
from tempfile import TemporaryDirectory
import json
import bpy

root = Path(bpy.data.filepath).resolve().parents[1]
rig = bpy.data.objects['GroundCrewRig']

# Export the complete rig with its original transforms. Alternate hairstyles
# must be evaluated even when a visibility driver has disabled their meshes.
original_pose = rig.data.pose_position
hair = [bpy.data.objects[name] for name in ('HairSwept', 'HairCrop', 'HairTied')]
hidden = {obj.name for obj in hair if obj.hide_viewport}
visibility = [(obj, obj.hide_viewport, obj.hide_render) for obj in hair]
drivers = [(driver, driver.mute) for obj in hair for driver in obj.animation_data.drivers]

with TemporaryDirectory() as directory:
    path = Path(directory) / 'ground-crew.glb'
    try:
        rig.data.pose_position = 'REST'
        for driver, _ in drivers:
            driver.mute = True
        for obj in hair:
            obj.hide_viewport = obj.hide_render = False
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(
            filepath=str(path), collection='Ground Crew', export_animations=False,
            export_texcoords=False, export_extras=True)
    finally:
        rig.data.pose_position = original_pose
        for obj, viewport, render in visibility:
            obj.hide_viewport, obj.hide_render = viewport, render
        for driver, muted in drivers:
            driver.mute = muted
        bpy.context.view_layer.update()
    glb = path.read_bytes()

# glTF core viewers understand zero scale. Store the original glTF scale so
# clients can enable each alternate without losing its authored rotation.
json_length, = unpack_from('<I', glb, 12)
gltf = json.loads(glb[20:20 + json_length])
for node in gltf['nodes']:
    if node['name'] in hidden:
        node.setdefault('extras', {})['crewRestScale'] = node.get('scale', [1, 1, 1])
        node['scale'] = [0, 0, 0]
metadata = json.dumps(gltf, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
binary = glb[20 + json_length:]
header = pack('<4sIIII', b'glTF', 2, 20 + len(metadata) + len(binary), len(metadata), 0x4E4F534A)
(root / 'assets/models/ground-crew.glb').write_bytes(header + metadata + binary)
