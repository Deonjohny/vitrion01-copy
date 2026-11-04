"""Read source datablocks only; never execute embedded texts or upstream add-ons."""
import bpy
import json
import sys
from pathlib import Path

output = Path(sys.argv[sys.argv.index('--') + 1])
report = {
    'blender': bpy.app.version_string,
    'units': {'system': bpy.context.scene.unit_settings.system, 'scale': bpy.context.scene.unit_settings.scale_length},
    'collections': [{'name': c.name, 'objects': len(c.all_objects)} for c in bpy.data.collections],
    'objects': [{
        'name': o.name, 'type': o.type,
        'collections': [c.name for c in o.users_collection],
        'properties': {k: str(v)[:4000] for k, v in o.items()},
        'bounds': [list(o.matrix_world @ __import__('mathutils').Vector(c)) for c in o.bound_box] if o.type == 'MESH' else None,
    } for o in bpy.data.objects],
}
output.write_text(json.dumps(report, indent=2), encoding='utf-8')
print('Inspected', len(report['objects']), 'objects ->', output)
