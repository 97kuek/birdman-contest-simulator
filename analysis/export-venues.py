"""Blender background export of the two venues and their moving vehicles.

blender -b models/flight-venues.blend -P analysis/export-venues.py
Run on a freshly opened file. Export-time batching never saves the .blend.
"""
import gzip
import json
import struct
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import bmesh
from mathutils import Euler

ROOT = Path(bpy.data.filepath).resolve().parents[1]
OUT = ROOT / 'assets/models'


def append_attribute(document, binary, values, dimensions):
    while len(binary) % 4:
        binary.append(0)
    start = len(binary)
    for value in values:
        binary.extend(struct.pack('<' + 'f' * dimensions, *value))
    views = document['bufferViews']
    views.append(dict(buffer=0, byteOffset=start, byteLength=len(binary)-start))
    accessors = document['accessors']
    accessors.append(dict(bufferView=len(views)-1, componentType=5126, count=len(values),
                          type=f'VEC{dimensions}', min=list(map(min, zip(*values))), max=list(map(max, zip(*values)))))
    return len(accessors)-1


def batch_collection_instances(collection, instances):
    """Join each linked house once, keeping its placements as GPU transforms."""
    groups = {}
    for obj in instances:
        groups.setdefault(obj.instance_collection, []).append(obj.matrix_world.decompose())
    depsgraph = bpy.context.evaluated_depsgraph_get()
    result = {}
    for asset, transforms in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        prototype = bpy.data.objects.new(asset.name, bpy.data.meshes.new(asset.name))
        collection.objects.link(prototype)
        prototype.select_set(True)
        for source in asset.all_objects:
            if source.type != 'MESH' or source.hide_render:
                continue
            evaluated = source.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
            part = bpy.data.objects.new(source.name, mesh)
            collection.objects.link(part)
            part.matrix_world = evaluated.matrix_world.copy()
            part.location -= asset.instance_offset
            part.select_set(True)
        bpy.context.view_layer.objects.active = prototype
        bpy.ops.object.join()
        if not prototype.data.polygons:
            raise ValueError(f'No geometry in instanced collection {asset.name}')
        result[prototype.name] = transforms
    return result


def export_instances(document, binary, fields, batches):
    """Encode editable point fields and linked collection placements in glTF axes."""
    transforms = dict(batches)
    colours = {}
    for field in fields:
        mesh = field.data
        name = field['prototype']
        transforms[name] = [
            (v.co, Euler(mesh.attributes['rotation'].data[i].vector).to_quaternion(),
             mesh.attributes['scale'].data[i].vector)
            for i, v in enumerate(mesh.vertices)]
        if mesh.attributes.get('tint'):
            colours[name] = [v.vector[:] for v in mesh.attributes['tint'].data]
    if not transforms:
        return
    nodes = {n.get('name'): n for n in document['nodes']}
    for name, rows in transforms.items():
        attributes = {
            'TRANSLATION': append_attribute(document, binary, [(p.x, p.z, -p.y) for p, q, s in rows], 3),
            'ROTATION': append_attribute(document, binary, [(q.x, q.z, -q.y, q.w) for p, q, s in rows], 4),
            'SCALE': append_attribute(document, binary, [(s.x, s.z, s.y) for p, q, s in rows], 3),
        }
        if name in colours:
            attributes['_COLOR_0'] = append_attribute(document, binary, colours[name], 3)
        nodes[name].setdefault('extensions', {})['EXT_mesh_gpu_instancing'] = {'attributes': attributes}
    for key in ('extensionsUsed', 'extensionsRequired'):
        document.setdefault(key, []).append('EXT_mesh_gpu_instancing')


def scene_textures(document):
    """Reference the original aerial images once, without embedding a second copy."""
    textures, images, samplers = [], [], []
    for material in document['materials']:
        extras = material.get('extras', {})
        source = extras.get('sourceImage')
        authored = bpy.data.materials.get(material['name'])
        if authored and authored.node_tree:
            # An artist can replace a photograph directly in the Blender material.
            maps = {node.image for node in authored.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image}
            if len(maps) == 1:
                image_path = Path(bpy.path.abspath(maps.pop().filepath)).resolve()
                if not image_path.is_relative_to(ROOT / 'assets'):
                    raise ValueError(f'Place the venue image in assets/: {image_path}')
                source = str(image_path.relative_to(ROOT / 'assets'))
        if not source:
            continue
        path = (ROOT / 'assets' / source).resolve()
        if not path.is_relative_to(ROOT / 'assets') or not path.is_file():
            raise ValueError(f'Missing venue texture: {source}')
        uri = '../' + source
        image = {'uri': uri}
        if image not in images:
            images.append(image)
        repeat = 10497 if extras.get('tile') else 33071
        sampler = dict(wrapS=repeat, wrapT=repeat, minFilter=9987, magFilter=9729)
        if sampler not in samplers:
            samplers.append(sampler)
        texture = dict(sampler=samplers.index(sampler))
        if path.suffix.lower() == '.webp':
            texture['extensions'] = {'EXT_texture_webp': {'source': images.index(image)}}
            for key in ('extensionsUsed', 'extensionsRequired'):
                extensions = document.setdefault(key, [])
                if 'EXT_texture_webp' not in extensions:
                    extensions.append('EXT_texture_webp')
        else:
            texture['source'] = images.index(image)
        if texture not in textures:
            textures.append(texture)
        material['pbrMetallicRoughness']['baseColorTexture'] = dict(index=textures.index(texture))
        if extras.get('dayTint'):
            material.setdefault('extensions', {})['KHR_materials_unlit'] = {}
            used = document.setdefault('extensionsUsed', [])
            if 'KHR_materials_unlit' not in used:
                used.append('KHR_materials_unlit')
        if 'alphaMode' in extras:
            material['alphaMode'] = extras['alphaMode']
            if material['alphaMode'] == 'MASK':
                material['alphaCutoff'] = extras.get('cutoff', .5)
    if images:
        document.update(images=images, textures=textures, samplers=samplers)


def export_collection(scene_name, collection_name, filename, *, landscape=False):
    scene = bpy.data.scenes[scene_name]
    bpy.context.window.scene = scene
    collection = bpy.data.collections[collection_name]
    # Vehicles are collection instances in the venue, exported in vehicle-local metres.
    linked = collection.name not in scene.collection.children
    if linked:
        scene.collection.children.link(collection)
    # Batch the editable runway fixtures by material only for distribution.
    if collection_name == 'Fujikawa Landscape':
        for child in collection.children:
            if child.name.startswith(('03 |', '04 |')):
                bpy.ops.object.select_all(action='DESELECT')
                for obj in child.all_objects:
                    obj.select_set(True)
                bpy.context.view_layer.objects.active = next(iter(child.all_objects))
                bpy.ops.object.join()
    if collection_name == 'Chase Van':
        # Artists keep individually named doors, lenses, seats and dash switches.
        # Fixed parts share a single material-sorted mesh in the WebGL export.
        bpy.ops.object.select_all(action='DESELECT')
        fixed = [obj for obj in bpy.data.objects['Body and cabin'].children if obj.type == 'MESH']
        for obj in fixed:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = fixed[0]
        bpy.ops.object.join()
        bpy.ops.object.select_all(action='DESELECT')
        seated = [obj for child in collection.children for obj in child.all_objects if obj.type == 'MESH']
        for obj in seated:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = seated[0]
        bpy.ops.object.join()
        for obj in list(collection.all_objects):
            if obj.name.startswith('Wheel') and obj.name.endswith('Far'):
                for part in [obj, *obj.children_recursive]:
                    part.hide_viewport = False
                    part.hide_render = False
    bpy.context.view_layer.update()
    if landscape:
        # DEMs are photographed/unlit. A single normal on these surfaces removes
        # redundant per-triangle normals introduced during authoring.
        for obj in collection.all_objects:
            if obj.type != 'MESH' or not obj.data.materials or not all(m.get('dayTint') for m in obj.data.materials):
                continue
            mesh = obj.data
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
            bm.to_mesh(mesh)
            bm.free()
            for polygon in mesh.polygons:
                polygon.use_smooth = True
            mesh.normals_split_custom_set_from_vertices([(0, 0, 1)] * len(mesh.vertices))
    placements = [o for o in collection.all_objects
                  if o.instance_type == 'COLLECTION' and o.instance_collection
                  and (o.get('venueInstance') or o.instance_collection.get('batchVenueInstances'))]
    batches = batch_collection_instances(collection, placements)
    fields = [o for o in collection.all_objects if 'prototype' in o]
    for field in fields:
        proto = bpy.data.objects[field['prototype']]
        proto.hide_set(False)
        proto.hide_render = False
        proto.matrix_world = field.matrix_world.copy()
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    skip = set(fields + placements)
    for obj in list(collection.all_objects):
        if obj not in skip:
            obj.select_set(True)
    with TemporaryDirectory() as temp:
        glb = Path(temp) / 'model.glb'
        bpy.ops.export_scene.gltf(filepath=str(glb), use_selection=True, use_active_scene=True, export_extras=True,
            export_animations=False, export_cameras=False, export_vertex_color='ACTIVE',
            export_image_format='NONE' if landscape else 'AUTO')
        raw = glb.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20+size])
    binary = bytearray(raw[28+size:28+size+document['buffers'][0]['byteLength']])
    export_instances(document, binary, fields, batches)
    if landscape:
        scene_textures(document)
    document['buffers'][0]['byteLength'] = len(binary)
    header = json.dumps(document, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    binary.extend(bytes(-len(binary) % 4))
    result = struct.pack('<4sIIII', b'glTF', 2, 28+len(header)+len(binary), len(header), 0x4e4f534a)
    result += header + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    output = OUT / f'{filename}.glb.gz'
    if landscape:
        with TemporaryDirectory() as temp:
            glb = Path(temp) / 'scene.glb'
            glb.write_bytes(result)
            subprocess.run(['node', ROOT / 'analysis/compress-venue.js', glb, output], check=True)
    else:
        output.write_bytes(gzip.compress(result, compresslevel=9, mtime=0))
    if linked:
        scene.collection.children.unlink(collection)


for venue, collection, filename in [
        ('Lake Biwa', 'Biwa Landscape', 'biwa-scenery'), ('Lake Biwa', 'Chase Boat', 'chase-boat'),
        ('Fujikawa', 'Fujikawa Landscape', 'fujikawa-scenery'), ('Fujikawa', 'Chase Van', 'chase-van')]:
    export_collection(venue, collection, filename, landscape=filename.endswith('scenery'))
