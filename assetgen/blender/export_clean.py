"""Blender: a hero GLB -> a clean FBX (skinned mesh + armature only) for UniRig. Blender's glTF importer adds an
"Icosphere" bone-display shape; UniRig's extractor takes every mesh in the file, so it must not be there.
  blender -b -P export_clean.py -- in.glb out.fbx"""
import bpy, sys, os
src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
for o in list(bpy.data.objects):
    if o.type == "MESH" and not len(o.vertex_groups): bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.type == "ARMATURE":
        for pb in o.pose.bones: pb.custom_shape = None
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(filepath=os.path.abspath(dst), use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False,
                         bake_anim=False, path_mode="COPY", embed_textures=False, armature_nodetype="NULL")
print("CLEAN", dst, [o.name for o in bpy.data.objects])
