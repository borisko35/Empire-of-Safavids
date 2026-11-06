import bpy
import bmesh
from mathutils import Vector
import os

# Clear existing objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

EXPORT_DIR = r'D:/My Projects/Empire of Sefevids/client/src/assets/models/safavid'
os.makedirs(EXPORT_DIR, exist_ok=True)

def create_cube_obj(name, location, scale, color=(0.8, 0.8, 0.8)):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj.location = location
    obj.scale = scale
    mat = bpy.data.materials.new(name + '_mat')
    mat.use_nodes = True
    # Look up BSDF node by type, not by name (names are localized in Blender 5.2)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    obj.data.materials.append(mat)
    return obj

def export_glb(name):
    filepath = os.path.join(EXPORT_DIR, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
    )
    print('  OK ' + name + '.glb')

# 1. QIZILBASH GUARD
print('=== Creating Qizilbash Guard ===')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
create_cube_obj('Head', (0, 0, 1.72), (0.22, 0.16, 0.22), (0.9, 0.75, 0.6))
create_cube_obj('TubeykaHat', (0, 0, 1.88), (0.28, 0.24, 0.16), (0.75, 0.1, 0.1))
create_cube_obj('KaftanRobe', (0, 0, 0.95), (0.55, 0.35, 1.05), (0.75, 0.1, 0.1))
create_cube_obj('Chainmail', (0, 0, 1.15), (0.42, 0.32, 0.45), (0.55, 0.55, 0.6))
create_cube_obj('BootLeft', (-0.22, 0.08, 0.28), (0.14, 0.18, 0.28), (0.4, 0.25, 0.15))
create_cube_obj('BootRight', (0.22, 0.08, 0.28), (0.14, 0.18, 0.28), (0.4, 0.25, 0.15))
create_cube_obj('DarkCloak', (0, -0.1, 1.0), (0.52, 0.18, 0.75), (0.2, 0.15, 0.15))
export_glb('guard-qizilbash')

# 2. SUFI MYSTIC
print('=== Creating Sufi Mystic ===')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
create_cube_obj('Head', (0, 0, 1.70), (0.20, 0.15, 0.20), (0.9, 0.75, 0.6))
create_cube_obj('Turban', (0, 0, 1.90), (0.26, 0.26, 0.18), (0.6, 0.45, 0.35))
create_cube_obj('SufiRobe', (0, 0, 0.95), (0.50, 0.30, 1.10), (0.25, 0.25, 0.30))
create_cube_obj('Sash', (0, 0, 1.05), (0.45, 0.10, 0.06), (0.8, 0.5, 0.1))
create_cube_obj('SandalsLeft', (-0.20, 0.05, 0.25), (0.13, 0.15, 0.08), (0.3, 0.2, 0.15))
create_cube_obj('SandalsRight', (0.20, 0.05, 0.25), (0.13, 0.15, 0.08), (0.3, 0.2, 0.15))
create_cube_obj('PrayerBeads', (0.25, 0.35, 1.15), (0.08, 0.08, 0.35), (0.6, 0.45, 0.35))
export_glb('sufi-mystic')

# 3. PERSIAN ARCHER
print('=== Creating Persian Archer ===')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
create_cube_obj('Head', (0, 0, 1.75), (0.20, 0.15, 0.20), (0.9, 0.75, 0.6))
create_cube_obj('ArcherHat', (0, 0, 1.90), (0.24, 0.18, 0.14), (0.4, 0.3, 0.2))
create_cube_obj('Vest', (0, 0, 1.10), (0.40, 0.30, 0.50), (0.3, 0.25, 0.2))
create_cube_obj('Pants', (0, 0, 0.55), (0.28, 0.22, 0.60), (0.25, 0.2, 0.15))
create_cube_obj('BracersLeft', (-0.38, 0.25, 1.10), (0.08, 0.12, 0.15), (0.35, 0.25, 0.18))
create_cube_obj('BracersRight', (0.38, 0.25, 1.10), (0.08, 0.12, 0.15), (0.35, 0.25, 0.18))
create_cube_obj('Quiver', (0.35, -0.15, 0.85), (0.14, 0.08, 0.45), (0.3, 0.2, 0.15))
create_cube_obj('BootsLeft', (-0.20, 0.06, 0.25), (0.13, 0.16, 0.26), (0.35, 0.22, 0.15))
create_cube_obj('BootsRight', (0.20, 0.06, 0.25), (0.13, 0.16, 0.26), (0.35, 0.22, 0.15))
export_glb('archer-of-persian')

# 4. BAZAAR MERCHANT
print('=== Creating Bazaar Merchant ===')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
create_cube_obj('Head', (0, 0, 1.72), (0.22, 0.17, 0.22), (0.9, 0.75, 0.6))
create_cube_obj('MerchantTurban', (0, 0, 1.90), (0.27, 0.25, 0.17), (0.4, 0.32, 0.22))
create_cube_obj('MerchantRobe', (0, 0, 0.95), (0.52, 0.33, 1.05), (0.9, 0.8, 0.4))
create_cube_obj('Kushak', (0, 0, 1.08), (0.48, 0.09, 0.05), (0.85, 0.65, 0.2))
create_cube_obj('SandalsLeft', (-0.21, 0.05, 0.25), (0.12, 0.14, 0.07), (0.28, 0.18, 0.14))
create_cube_obj('SandalsRight', (0.21, 0.05, 0.25), (0.12, 0.14, 0.07), (0.28, 0.18, 0.14))
create_cube_obj('MerchantBag', (-0.32, -0.25, 0.90), (0.15, 0.08, 0.25), (0.3, 0.2, 0.15))
export_glb('market-vendor')

# 5. COURT DIPLOMAT
print('=== Creating Court Diplomat ===')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
create_cube_obj('Head', (0, 0, 1.74), (0.21, 0.16, 0.21), (0.9, 0.75, 0.6))
create_cube_obj('DiplomatHat', (0, 0, 1.92), (0.25, 0.20, 0.15), (0.35, 0.28, 0.22))
create_cube_obj('DiplomatRobe', (0, 0, 0.98), (0.50, 0.32, 1.08), (0.25, 0.35, 0.55))
create_cube_obj('WideSleevesLeft', (-0.45, 0.20, 1.05), (0.12, 0.14, 0.35), (0.3, 0.25, 0.2))
create_cube_obj('WideSleevesRight', (0.45, 0.20, 1.05), (0.12, 0.14, 0.35), (0.3, 0.25, 0.2))
create_cube_obj('DiplomatShoesLeft', (-0.19, 0.04, 0.24), (0.12, 0.13, 0.24), (0.28, 0.2, 0.14))
create_cube_obj('DiplomatShoesRight', (0.19, 0.04, 0.24), (0.12, 0.13, 0.24), (0.28, 0.2, 0.14))
create_cube_obj('DiplomatSash', (0, 0, 1.10), (0.46, 0.08, 0.04), (0.7, 0.5, 0.3))
export_glb('court-diplomat')

print('=== ALL 5 MODELS CREATED AND EXPORTED ===')
