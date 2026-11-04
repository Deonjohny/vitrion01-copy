"""Trusted static GLB writer. Run with Blender --background --disable-autoexec.

Reads only explicitly allowlisted mesh datablocks. No source scripts, materials,
modifiers, drivers, textures, animations, custom properties or definitions copied.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SOURCE = 'https://github.com/Z-Anatomy/Models-of-human-anatomy'
ATTRIBUTION = ('BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan; '
               'Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0. '
               'Kousaku OKUBO (original model), Gauthier KERVYN (design, 3D, anatomy). '
               'Adaptation: skeleton-only selection, triangulation, world-transform baking and Y-up conversion.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public' / 'anatomy')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    mappings = json.loads((HERE / 'source-map.json').read_text(encoding='utf-8'))
    document = {'asset': {'version': '2.0', 'generator': 'Vitrion trusted skeleton exporter'},
                'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                'buffers': [], 'bufferViews': [], 'accessors': [],
                'materials': [{'name': 'Bone', 'pbrMetallicRoughness': {
                    'baseColorFactor': [0.86, 0.82, 0.71, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}}]}
    binary = bytearray()
    spatial = {}
    used = set()
    triangles = 0

    def accessor(raw, component, count, kind, target, minimum=None, maximum=None):
        while len(binary) % 4:
            binary.append(0)
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw), 'target': target})
        binary.extend(raw)
        value = {'bufferView': view, 'componentType': component, 'count': count, 'type': kind}
        if minimum is not None:
            value.update(min=minimum, max=maximum)
        index = len(document['accessors'])
        document['accessors'].append(value)
        return index

    for mapping in mappings:
        name, bone_id = mapping['nodeName'], mapping['boneId']
        if name in used:
            raise ValueError('Duplicate allowlist node: ' + name)
        used.add(name)
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != 'MESH' or '1: Skeletal system' not in [c.name for c in obj.users_collection]:
            raise ValueError('Missing or non-skeletal source mesh: ' + name)
        mesh = obj.data
        mesh.calc_loop_triangles()
        # The loaded source is in metres, Z-up, anterior negative Y. Bake to
        # glTF metres, Y-up, anterior positive Z: (x, y, z) -> (x, z, -y).
        points = []
        for vertex in mesh.vertices:
            p = obj.matrix_world @ vertex.co
            points.append((float(p.x), float(p.z), float(-p.y)))
        if not points or not mesh.loop_triangles or not all(math.isfinite(v) for p in points for v in p):
            raise ValueError('Empty or nonfinite source mesh: ' + name)
        low = [min(p[i] for p in points) for i in range(3)]
        high = [max(p[i] for p in points) for i in range(3)]
        positions = accessor(b''.join(struct.pack('<3f', *p) for p in points), 5126, len(points), 'VEC3', 34962, low, high)
        indices = [int(v) for tri in mesh.loop_triangles for v in tri.vertices]
        # Correct winding for mirrored source transforms.
        if obj.matrix_world.to_3x3().determinant() < 0:
            indices = [v for i in range(0, len(indices), 3) for v in (indices[i], indices[i+2], indices[i+1])]
        index_accessor = accessor(struct.pack('<' + 'I' * len(indices), *indices), 5125, len(indices), 'SCALAR', 34963)
        triangles += len(indices) // 3
        node_index = len(document['nodes'])
        document['nodes'].append({'name': name, 'mesh': len(document['meshes'])})
        document['scenes'][0]['nodes'].append(node_index)
        document['meshes'].append({'name': name, 'primitives': [{'attributes': {'POSITION': positions}, 'indices': index_accessor, 'material': 0, 'mode': 4}]})
        bounds = spatial.setdefault(bone_id, {'min': low[:], 'max': high[:]})
        bounds['min'] = [min(bounds['min'][i], low[i]) for i in range(3)]
        bounds['max'] = [max(bounds['max'][i], high[i]) for i in range(3)]

    document['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(document, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    size = 12 + 8 + len(encoded) + 8 + len(binary)
    if size > 64 * 1024 * 1024 or len(encoded) > 4 * 1024 * 1024:
        raise ValueError('Export exceeds viewer budgets; no output written')
    glb = (struct.pack('<III', 0x46546C67, 2, size) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
           + struct.pack('<II', len(binary), 0x004E4942) + binary)
    manifest = {'schemaVersion': 1, 'name': 'Z-Anatomy skeleton (source-name mapped)',
                'license': 'CC-BY-SA-4.0; original BodyParts3D CC-BY-SA-2.1-JP',
                'sourceUrl': SOURCE, 'attribution': ATTRIBUTION, 'modelUrl': '/anatomy/skeleton.glb',
                'units': 'm', 'orientation': 'Y_UP_ANTERIOR_POSITIVE_Z', 'meshes': mappings}
    measurements = {bone_id: {'bounds': bounds,
                    'centroid': [(bounds['min'][i] + bounds['max'][i]) / 2 for i in range(3)]}
                    for bone_id, bounds in sorted(spatial.items())}
    report = {'sourceUrl': SOURCE, 'blenderVersion': bpy.app.version_string,
              'sourceBlendSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
              'modelSha256': hashlib.sha256(glb).hexdigest(), 'modelBytes': size,
              'mappedBones': len(spatial), 'meshNodes': len(mappings), 'triangles': triangles,
              'units': 'm', 'orientation': manifest['orientation'],
              'centroidMeaning': 'World-space axis-aligned bounds midpoint, not center of mass',
              'geometry': 'Loaded base mesh datablocks, triangulated; source modifiers not evaluated',
              'bones': measurements}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'skeleton.glb').write_bytes(glb)
    (args.output / 'bone-spatial.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'bones'}))


if __name__ == '__main__':
    main()
