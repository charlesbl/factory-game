"""Run with the pinned Blender executable; recipes are the geometry source of truth."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import struct

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/world"
VERSION = "4.5.0"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonicalize_glb(path):
    # Bevel normals can differ by one float ULP; quantize exported attributes.
    data = bytearray(path.read_bytes())
    json_size = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + json_size])
    binary_start = 20 + json_size + 8
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    for accessor in document['accessors']:
        if accessor['componentType'] != 5126:
            continue
        view = document['bufferViews'][accessor['bufferView']]
        count = components[accessor['type']]
        start = binary_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = view.get('byteStride', count * 4)
        for row in range(accessor['count']):
            for component in range(count):
                offset = start + row * stride + component * 4
                value = struct.unpack_from('<f', data, offset)[0]
                struct.pack_into('<f', data, offset, round(value, 5) + 0.0)
    path.write_bytes(data)


def linear(value):
    value /= 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def make_material():
    material = bpy.data.materials.new("world_palette")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.84
    shader.inputs["Metallic"].default_value = 0.05
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Color"
    material.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
    return material


def make_part(part, palette, material, lod):
    x, y, z = part["position"]
    w, h, d = part["size"]
    shape = part.get("shape", "box")
    if shape == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=8 if lod == 0 else 6, radius=0.5, depth=1)
    elif shape == "rock":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.location = (x, -z, y)
    obj.scale = (w, d, h)
    obj.rotation_euler.z = -part.get("rotation", 0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if lod == 0 and shape == "box" and part.get("bevel", 0.018) > 0:
        bevel = obj.modifiers.new("Silhouette bevel", "BEVEL")
        bevel.width = min(part.get("bevel", 0.018), w / 8, h / 8, d / 8)
        bevel.segments = 1
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj.data.materials.append(material)
    attribute = obj.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    code = palette[part["material"]].lstrip("#")
    color = tuple(linear(int(code[i:i + 2], 16)) for i in (0, 2, 4)) + (1,)
    for item in attribute.data:
        item.color = color
    return obj


def make_asset(recipe, palette, lod):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_recursive=True)
    material = make_material()
    groups = {}
    for part in recipe["parts"]:
        if lod > part.get("lastLod", 2):
            continue
        groups.setdefault(part.get("node", "body"), []).append(make_part(part, palette, material, lod))
    root = bpy.data.objects.new("root", None)
    bpy.context.collection.objects.link(root)
    for name, members in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        # Static vertices and animation pivots are exported in the same Y-up space.
        bpy.context.scene.cursor.location = (0, 0, 0)
        if name in recipe.get("pivots", {}):
            x, y, z = recipe["pivots"][name]
            bpy.context.scene.cursor.location = (x, -z, y)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        obj.parent = root
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        for polygon in obj.data.polygons:
            polygon.use_smooth = False
    for name, position in recipe.get("sockets", {}).items():
        socket = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(socket)
        socket.parent = root
        socket.location = (position[0], -position[2], position[1])
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.context.view_layer.update()
    if recipe["id"] != "terrain-surface":
        bounds, _ = metadata()
        for obj in root.children:
            obj.location.z -= bounds["min"][1]
        bpy.context.view_layer.update()
    return root


def metadata():
    vertices = []
    triangles = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            vertices.append((point.x, point.z, -point.y))
    return {"min": [round(min(p[i] for p in vertices), 6) for i in range(3)],
            "max": [round(max(p[i] for p in vertices), 6) for i in range(3)]}, triangles


def main():
    global PACK
    if bpy.app.version_string != VERSION:
        raise RuntimeError(f"Expected Blender {VERSION}, received {bpy.app.version_string}")
    bpy.context.preferences.filepaths.save_version = 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset")
    parser.add_argument("--output-root")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output_root = Path(args.output_root).resolve() if args.output_root else ROOT
    PACK = output_root / "public/assets/world"
    (PACK / "models").mkdir(parents=True, exist_ok=True)
    (output_root / "assets/world/source").mkdir(parents=True, exist_ok=True)
    recipes = json.loads((ROOT / "assets/world/recipes/pack-v1.json").read_text())
    manifest_file = PACK / "manifest.json"
    existing = json.loads(manifest_file.read_text()) if manifest_file.exists() else {"assets": []}
    entries = {entry["id"]: entry for entry in existing["assets"]} if args.asset else {}
    selected = [recipe for recipe in recipes["assets"] if not args.asset or recipe["id"] == args.asset]
    if not selected:
        raise RuntimeError("Unknown asset ID")
    for recipe in selected:
        entry = {key: recipe[key] for key in ["id", "footprint", "budget", "policy"]}
        entry.update({"version": 1, "pivot": [0, 0, 0], "front": "+Z", "source": f"assets/world/source/{recipe['id']}.blend",
                      "recipe": "assets/world/recipes/pack-v1.json", "provenance": "assets/world/provenance.json",
                      "sockets": recipe.get("sockets", {}), "animationParts": list(recipe.get("pivots", {})), "lods": []})
        for lod in range(3):
            make_asset(recipe, recipes["palette"], lod)
            bounds, triangles = metadata()
            if lod == 0:
                entry["bounds"] = bounds
                entry["animationBounds"] = recipe.get("animationBounds", bounds)
                bpy.ops.wm.save_as_mainfile(filepath=str(output_root / entry["source"]), check_existing=False)
            temporary = PACK / "models" / f"{recipe['id']}-lod{lod}.glb"
            bpy.ops.object.select_all(action="SELECT")
            bpy.ops.export_scene.gltf(filepath=str(temporary), export_format="GLB", use_selection=True,
                                      export_yup=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials="EXPORT",
                                      export_vertex_color="MATERIAL", export_animations=False, export_cameras=False,
                                      export_lights=False, export_extras=False, export_keep_originals=False)
            canonicalize_glb(temporary)
            content_hash = digest(temporary)
            final = temporary.with_name(f"{recipe['id']}-lod{lod}.{content_hash[:12]}.glb")
            temporary.replace(final)
            entry["lods"].append({"url": f"models/{final.name}", "sha256": content_hash, "triangles": triangles,
                                  "bytes": final.stat().st_size, "materials": 1, "bounds": bounds})
        entries[recipe["id"]] = entry
    manifest = {"schemaVersion": 1, "packVersion": "1.0.0", "blenderVersion": VERSION,
                "units": "one tile = one metre", "up": "+Y", "front": "+Z", "assets": list(entries.values())}
    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n")
    retained = {Path(lod["url"]).name for entry in entries.values() for lod in entry["lods"]}
    for path in (PACK / "models").glob("*.glb"):
        if path.name not in retained and path.resolve().parent == (PACK / "models").resolve():
            path.unlink()
    print(f"Built {len(selected)} assets with Blender {VERSION}")


if __name__ == "__main__":
    main()
