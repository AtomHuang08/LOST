"""Build a wall of independent bricks and save a .blend file.

Each brick is its own object. Courses are stacked with a small joint
so the pieces read as masonry, not one fused mesh.
"""

import math
import os

import bpy

COLS = 12
ROWS = 18
WIDTH = 1.22
HEIGHT = 0.58
DEPTH = 0.26
GAP = 0.02

STRIDE_X = WIDTH + GAP
STRIDE_Z = HEIGHT + GAP
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "brick-wall.blend")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)


def make_material():
    material = bpy.data.materials.new("砖")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.90, 0.91, 0.92, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.72
    return material


def link_only(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def build():
    clear_scene()
    material = make_material()

    wall = bpy.data.collections.new("墙")
    bpy.context.scene.collection.children.link(wall)

    for row in range(ROWS):
        for col in range(COLS):
            x = (col - (COLS - 1) * 0.5) * STRIDE_X
            z = (row - (ROWS - 1) * 0.5) * STRIDE_Z
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0.0, z))
            brick = bpy.context.active_object
            brick.name = f"Brick_{row + 1:02d}_{col + 1:02d}"
            brick.dimensions = (WIDTH, DEPTH, HEIGHT)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            brick.data.materials.append(material)
            link_only(brick, wall)

    bpy.ops.object.camera_add(location=(0.0, -22.0, 0.6))
    camera = bpy.context.active_object
    camera.name = "Camera"
    camera.rotation_euler = (math.radians(90), 0.0, 0.0)
    camera.data.lens = 35

    bpy.ops.object.light_add(type="AREA", location=(0.0, -10.0, 3.0))
    light = bpy.context.active_object
    light.name = "Key"
    light.data.energy = 1500
    light.data.size = 12
    light.rotation_euler = (math.radians(90), 0.0, 0.0)

    scene = bpy.context.scene
    scene.camera = camera
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.02, 0.02, 0.025, 1.0)
        background.inputs["Strength"].default_value = 1.0

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print(f"saved {OUT} bricks={COLS * ROWS}")


if __name__ == "__main__":
    build()
