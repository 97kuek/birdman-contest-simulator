"""Export the rig, its Blender actions and IK reference poses. Run with models/ground-crew.blend open in Blender."""
from pathlib import Path
from struct import pack, unpack_from
from tempfile import TemporaryDirectory
import json
import bpy
from mathutils import Matrix

root = Path(bpy.data.filepath).resolve().parents[1]
rig = bpy.data.objects['GroundCrewRig']

# Export the complete rig with its original transforms. Alternate hairstyles
# must be evaluated even when a visibility driver has disabled their meshes.
original_pose = rig.data.pose_position
hair = [bpy.data.objects[name] for name in ('HairSwept', 'HairCrop', 'HairTied')]
hidden = {obj.name for obj in hair if obj.hide_viewport}
visibility = [(obj, obj.hide_viewport, obj.hide_render) for obj in hair]
drivers = [(driver, driver.mute) for obj in hair for driver in obj.animation_data.drivers]

# The game retargets hands and soles to the aircraft and ground. Sample the
# same keyed torso, gaze and palm poses as the full glTF armature clips.
def motion_library():
    scene = bpy.context.scene
    animation = rig.animation_data
    previous, frame = animation.action, scene.frame_current
    basis = Matrix.Rotation(-1.5707963267948966, 4, 'X')
    def xyz(vector):
        return [round(v, 5) for v in vector]
    def rotation(bone):
        deform = bone.matrix @ bone.bone.matrix_local.inverted()
        return (basis @ deform @ basis.inverted()).to_quaternion()
    clips = {}
    try:
        rig.data.pose_position = 'POSE'
        for action in bpy.data.actions:
            if 'crewMotion' not in action:
                continue
            animation.action = action
            samples = []
            first, last = map(int, action.frame_range)
            for tick in range(first, last + 1):
                scene.frame_set(tick)
                bones = rig.pose.bones
                spine = bones['Spine']
                torso = rotation(spine)
                gaze = torso.inverted() @ rotation(bones['Neck'])
                samples.append([
                    *xyz(basis @ spine.head), *xyz(torso.to_euler('XYZ')),
                    *xyz(gaze.to_euler('XYZ')),
                    *xyz(basis @ bones['Hand.L'].head), *xyz(basis @ bones['Hand.R'].head),
                ])
            clips[action['crewMotion']] = samples
    finally:
        animation.action = previous
        scene.frame_set(frame)
        rig.data.pose_position = original_pose
    return clips


clips = motion_library()
with TemporaryDirectory() as directory:
    path = Path(directory) / 'ground-crew.glb'
    try:
        rig.data.pose_position = 'POSE'
        for driver, _ in drivers:
            driver.mute = True
        for obj in hair:
            obj.hide_viewport = obj.hide_render = False
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(
            filepath=str(path), collection='Ground Crew', export_animations=True,
            export_animation_mode='ACTIONS', export_anim_single_armature=True,
            export_rest_position_armature=True,
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
    if node['name'] == rig.name:
        node.setdefault('extras', {})['crewMotion'] = clips
    if node['name'] in hidden:
        node.setdefault('extras', {})['crewRestScale'] = node.get('scale', [1, 1, 1])
        node['scale'] = [0, 0, 0]
metadata = json.dumps(gltf, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
binary = glb[20 + json_length:]
header = pack('<4sIIII', b'glTF', 2, 20 + len(metadata) + len(binary), len(metadata), 0x4E4F534A)
(root / 'assets/models/ground-crew.glb').write_bytes(header + metadata + binary)
