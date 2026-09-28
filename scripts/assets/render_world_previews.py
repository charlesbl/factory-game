"""Render thumbnails from the actual exported GLBs, using one fixed scale and light rig."""
import argparse
import sys
import struct
import hashlib
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "public/assets/world"


def main():
    global PACK
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root")
    parser.add_argument("--asset")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.output_root:
        PACK = Path(args.output_root).resolve() / "public/assets/world"
    (PACK / "thumbnails").mkdir(parents=True, exist_ok=True)
    if bpy.app.version_string != "4.5.0":
        raise RuntimeError("Preview generation requires Blender 4.5.0")
    manifest = json.loads((PACK / "manifest.json").read_text())
    for entry in manifest["assets"]:
        if args.asset and entry["id"] != args.asset:
            continue
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(PACK / entry["lods"][0]["url"]))
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
        scene.render.resolution_x = scene.render.resolution_y = 256
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.film_transparent = True
        scene.world.color = (0.3, 0.35, 0.4)
        scene.view_settings.view_transform = "AgX"
        bpy.ops.object.light_add(type="AREA", location=(-3, -4, 8))
        bpy.context.object.data.energy = 850
        bpy.context.object.data.shape = "DISK"
        bpy.context.object.data.size = 5
        bpy.ops.object.camera_add(location=(7, -9, 9))
        camera = bpy.context.object
        camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = 6.3
        scene.camera = camera
        temporary = PACK / "thumbnails" / f"{entry['id']}.png"
        scene.render.filepath = str(temporary)
        bpy.ops.render.render(write_still=True)
        # PNG render timestamps are volatile and do not belong in immutable URLs.
        data = temporary.read_bytes()
        stable = bytearray(data[:8])
        offset = 8
        while offset < len(data):
            length = struct.unpack_from('>I', data, offset)[0]
            chunk = data[offset:offset + length + 12]
            if data[offset + 4:offset + 8] != b'tEXt':
                stable.extend(chunk)
            offset += length + 12
        temporary.write_bytes(stable)
        checksum = hashlib.sha256(stable).hexdigest()
        final = temporary.with_name(f"{entry['id']}.{checksum[:12]}.png")
        temporary.replace(final)
        entry["thumbnail"] = {"url": f"thumbnails/{final.name}", "sha256": checksum, "width": 256, "height": 256, "scale": 6.3}
    (PACK / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    retained = {Path(entry["thumbnail"]["url"]).name for entry in manifest["assets"]}
    for path in (PACK / "thumbnails").glob("*.png"):
        if path.name not in retained and path.resolve().parent == (PACK / "thumbnails").resolve():
            path.unlink()


if __name__ == "__main__":
    main()
