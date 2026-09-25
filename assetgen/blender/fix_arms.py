"""Blender 4.2+ / 5.x: repair a rigged hero's ARM joints + arm weights without re-rigging the rest of the body.

The auto-rigger (rig_hero.py) sometimes loses the arms: a held weapon or a long coat sleeve confuses the pose detector
and the silhouette fallback, and the shoulder / elbow / wrist land inside the chest (Raijin: a 5.5 cm forearm, the
real arms hanging untouched at his sides). Re-rigging needs the original TRELLIS mesh; this fixes the published GLB
in place, keeping the tuned leg, spine, hair and cloth weights.

  blender -b -P fix_arms.py -- --glb raijin_plain.glb --out raijin_fixed.glb --hero raijin [--test work/raijin_arms]
  blender -b -P fix_arms.py -- --glb x.glb --out y.glb --right "-0.23,1.22 -0.335,1.02 -0.34,0.86 -0.33,0.75" --mirror

(the input must be a plain GLB: the web models are Draco-compressed - decompress first with
 npx @gltf-transform/cli copy public/models/<id>.glb <id>_plain.glb; Blender's own importer handles Draco too)

Joints are FRONT-VIEW (x, z) in the model's space (character faces -Y, +X = its left): shoulder, elbow, wrist, hand
tip. Depth (y) comes from the mesh. --mirror derives the left arm from the right (or give --left; generated meshes are
rarely symmetric). Joints used for published heroes live in arm_fixes.json (--hero).
Afterwards: npx @gltf-transform/cli optimize out.glb public/models/<id>.glb --compress draco --texture-compress webp
--texture-size 1024 --simplify false   (the web tier, as build_assets.py does)

What it does
  1. moves upperarm / forearm / hand bones onto the given joints (shoulder bone tail follows)
  2. re-weights the arm region (a tapered capsule around the new arm chain, outside the shoulder line): segment weights
     with smooth blends at the elbow and wrist, faded into the existing torso weights at the shoulder and at the
     capsule surface
  3. hands any old arm weight left OUTSIDE the arm region (the misplaced bones sat in the chest) to the chest bone
  4. finds held weapons fused into the mesh (a straight run leading outward from the fist) and binds them to the hand
  5. normalises, keeps 4 influences; --test renders the arms raised / reaching forward to check deformation
"""
import bpy, sys, os, math, argparse
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--right", help="shoulder elbow wrist tip as 'x,z x,z x,z x,z'")
ap.add_argument("--left"); ap.add_argument("--mirror", action="store_true")
ap.add_argument("--hero", help="take the joints from arm_fixes.json")
ap.add_argument("--radius", type=float, default=0.09, help="arm capsule radius at the shoulder (tapers to 75%% at the hand)")
ap.add_argument("--debug", action="store_true")
ap.add_argument("--sleeve", type=float, default=0.045, help="half sleeve thickness for a 1.6 m hero (m): arm axis behind the front surface")
ap.add_argument("--no-props", action="store_true", help="don't look for held weapons")
ap.add_argument("--prop-width", type=float, default=0.035, help="held-weapon search radius around its axis (m)")
ap.add_argument("--prop-min", type=float, default=0.25, help="shortest straight run that counts as a held weapon (m)")
ap.add_argument("--test", default="", help="render deformation test images to this prefix")
a = ap.parse_args(argv)


def parse(s):
    p = [tuple(float(v) for v in q.split(",")) for q in s.split()]
    if len(p) != 4: raise SystemExit("need 4 joints: shoulder elbow wrist tip")
    return p


if a.hero:
    import json
    fx = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "arm_fixes.json")))[a.hero]
    a.right = a.right or fx.get("right"); a.left = a.left or fx.get("left")
J = {}
if a.right: J["R"] = parse(a.right)
if a.left: J["L"] = parse(a.left)
if a.mirror:
    if "R" in J and "L" not in J: J["L"] = [(-x, z) for x, z in J["R"]]
    if "L" in J and "R" not in J: J["R"] = [(-x, z) for x, z in J["L"]]
if not J: raise SystemExit("give --right and/or --left")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
arm = max((o for o in bpy.data.objects if o.type == "ARMATURE"), key=lambda o: len(o.data.bones))
meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]
if not meshes: raise SystemExit("no mesh skinned to the armature")

# ---------------------------------------------------------------- joint depth from the mesh (median y near x, z)
allv = np.concatenate([np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices]) for o in meshes])


def depth(x, z, r=0.035):
    near = allv[(np.abs(allv[:, 0] - x) < r) & (np.abs(allv[:, 2] - z) < r)]
    while len(near) < 8 and r < 0.2:
        r *= 1.6; near = allv[(np.abs(allv[:, 0] - x) < r) & (np.abs(allv[:, 2] - z) < r)]
    return float(np.median(near[:, 1])) if len(near) else float(np.median(allv[:, 1]))


H = float(allv[:, 2].max() - allv[:, 2].min())


def front_depth(x, z, r=0.03):
    # hanging forearms / hands sit in FRONT of the coat at the same (x, z): a median mixes both surfaces, so take the
    # front-most surface (-Y is the front) and step half a sleeve in
    near = allv[(np.abs(allv[:, 0] - x) < r) & (np.abs(allv[:, 2] - z) < r)]
    if len(near) < 6: return depth(x, z)
    return float(np.percentile(near[:, 1], 5)) + a.sleeve * H / 1.6


# the shoulder is inside the torso (median); elbow, wrist and hand are measured from the front surface
P = {s: [Vector((x, depth(x, z) if i == 0 else front_depth(x, z), z)) for i, (x, z) in enumerate(pts)] for s, pts in J.items()}
for s, pts in P.items(): print(f"[fix_arms] {s}: " + "  ".join(f"({p.x:.3f},{p.y:.3f},{p.z:.3f})" for p in pts))

# ---------------------------------------------------------------- 1. bones
inv = arm.matrix_world.inverted()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
for s, (S, E, W, T) in P.items():
    ua, fa, hd, sh = eb.get(f"upperarm_{s}"), eb.get(f"forearm_{s}"), eb.get(f"hand_{s}"), eb.get(f"shoulder_{s}")
    if not (ua and fa and hd): raise SystemExit(f"rig lacks upperarm/forearm/hand_{s}")
    for b in (ua, fa, hd): b.use_connect = False
    if sh: sh.tail = inv @ S
    ua.head, ua.tail = inv @ S, inv @ E
    fa.head, fa.tail = inv @ E, inv @ W
    hd.head, hd.tail = inv @ W, inv @ T
    fa.use_connect = True; hd.use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- 2-3. weights
def smooth(u): u = min(1.0, max(0.0, u)); return u * u * (3 - 2 * u)


def chain_param(p, pts):
    """closest point on the polyline: (distance, arc length from the shoulder, segment index, local t)"""
    best, s_acc, out = 1e9, 0.0, None
    for i in range(3):
        A, B = pts[i], pts[i + 1]
        AB = B - A; L = AB.length
        t = max(0.0, min(1.0, (p - A).dot(AB) / max(1e-9, L * L)))
        d = (p - (A + AB * t)).length
        if d < best: best, out = d, (d, s_acc + t * L, i, t)
        s_acc += L
    return out


ARM_BONES = ["upperarm", "forearm", "hand"]
stats = {"arm": 0, "reassigned": 0}
for o in meshes:
    vg = o.vertex_groups
    gi = {g.name: g.index for g in vg}
    chest = gi.get("chest") if "chest" in gi else gi.get("spine")
    for s in P:
        for n in ARM_BONES + ["shoulder"]:
            if f"{n}_{s}" not in gi: gi[f"{n}_{s}"] = vg.new(name=f"{n}_{s}").index
    arm_idx = {gi[f"{n}_{s}"]: s for s in P for n in ARM_BONES}
    mw = o.matrix_world
    for v in o.data.vertices:
        p = mw @ v.co
        w = {g.group: g.weight for g in v.groups}
        best = None
        for s, pts in P.items():
            d, arc, seg, t = chain_param(p, pts)
            total = sum((pts[i + 1] - pts[i]).length for i in range(3))
            r = a.radius * (1 - 0.25 * arc / max(1e-6, total))
            lateral = abs(p.x) > abs(pts[0].x) - 0.03                    # outside the shoulder line: not the chest / coat front
            if d < r and lateral and p.z > pts[3].z - 0.03 and (best is None or d < best[0]): best = (d, arc, seg, t, s, r, pts)
        if best:
            d, arc, seg, t, s, r, pts = best
            # segment weights, blended across the elbow (+-3 cm) and wrist (+-2 cm)
            Lu, Lf = (pts[1] - pts[0]).length, (pts[2] - pts[1]).length
            bw = {"upperarm": 0.0, "forearm": 0.0, "hand": 0.0}
            ke = smooth((arc - Lu + 0.03) / 0.06)
            kw = smooth((arc - Lu - Lf + 0.02) / 0.04)
            bw["upperarm"] = 1 - ke; bw["forearm"] = ke * (1 - kw); bw["hand"] = kw
            # fade into the torso: along the first 6 cm of the arm and over the outer 20% of the capsule
            k = smooth(arc / 0.06) * (1 - smooth((d - 0.8 * r) / (0.2 * r)))
            old = {g: x for g, x in w.items() if g not in arm_idx}
            tot_old = sum(old.values())
            if tot_old < 1e-6: old = {gi[f"shoulder_{s}"]: 1.0}; tot_old = 1.0
            new = {g: x / tot_old * (1 - k) for g, x in old.items()}
            for n, x in bw.items():
                if x * k > 1e-4: new[gi[f"{n}_{s}"]] = new.get(gi[f"{n}_{s}"], 0) + x * k
            stats["arm"] += 1
        else:
            # outside the arms: weight on the arm groups belongs to the chest (that's where the old bones were)
            moved = sum(x for g, x in w.items() if g in arm_idx)
            if moved <= 1e-6: continue
            new = {g: x for g, x in w.items() if g not in arm_idx}
            if chest is not None: new[chest] = new.get(chest, 0) + moved
            stats["reassigned"] += 1
        # 4 strongest influences, normalised
        top = sorted(new.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top) or 1.0
        for g in list(w): vg[g].remove([v.index])
        for g, x in top:
            if x / tot > 1e-4: vg[g].add([v.index], x / tot, "REPLACE")
print(f"[fix_arms] re-weighted {stats['arm']} arm vertices, moved stray arm weight off {stats['reassigned']} torso vertices")

# ---------------------------------------------------------------- held weapons: rigid to the hand
# Generated meshes fuse held swords into the body, so they can't be found as loose parts. A held blade is a straight run
# of vertices leading away from the fist: try ray directions from the fist (never into the torso, straight back into the
# body, up the forearm, or straight down along the coat edge), keep the one with the longest unbroken run, bind that run to the hand.
def held_props():
    fib = np.array([(math.cos(t) * math.sqrt(1 - u * u), math.sin(t) * math.sqrt(1 - u * u), u)
                    for u, t in ((1 - 2 * (i + 0.5) / 600, i * math.pi * (3 - math.sqrt(5))) for i in range(600))])
    for s, (S, E, W, T) in P.items():
        sg = 1 if s == "L" else -1
        F = np.array(((W + T) * 0.5)[:])
        rel = allv - F
        up_arm = np.array((E - W)[:]); up_arm /= np.linalg.norm(up_arm)
        cands = []
        near = np.linalg.norm(rel, axis=1) < 1.7
        R_ = rel[near]
        best = None
        for d in fib:
            # away from the body: not into the torso (inward), not backward (-Y is the front), not straight down the coat
            if sg * d[0] < -0.2 or (d[1] > 0.3 and sg * d[0] < 0.3) or d[2] < -0.75: continue   # backward only if also outward
            if d @ up_arm > 0.6: continue                                        # back up the forearm: that's the arm itself
            # the blade axis may miss the estimated fist centre: find the densest line parallel to d near the fist
            ax = np.array((1.0, 0, 0)) if abs(d[0]) < 0.9 else np.array((0, 1.0, 0))
            e1 = np.cross(d, ax); e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
            t = R_ @ d
            ahead = (t > 0.06) & (t < 1.6)
            u, v = R_[ahead] @ e1, R_[ahead] @ e2
            box = (np.abs(u) < 0.1) & (np.abs(v) < 0.1)
            if box.sum() < 20: continue
            H, _, _ = np.histogram2d(u[box], v[box], bins=20, range=[[-0.1, 0.1], [-0.1, 0.1]])
            Hs = sum(np.roll(np.roll(H, i, 0), j, 1) for i in (-1, 0, 1) for j in (-1, 0, 1))
            iu, iv = np.unravel_index(np.argmax(Hs), Hs.shape)
            cu, cv = -0.1 + (iu + 0.5) * 0.01, -0.1 + (iv + 0.5) * 0.01
            on = np.hypot(u - cu, v - cv) < a.prop_width
            tt = t[ahead][on]
            if len(tt) < 20: continue
            bins = np.zeros(80, bool); bins[np.minimum(79, (tt / 0.02).astype(int))] = True
            # a contiguous run of 2 cm bins starting within 16 cm of the fist (the hilt may sit inside the hand)
            first = next((i for i in range(3, 9) if bins[i]), None)
            if first is None: continue
            run = first
            while run < 80 and (bins[run] or (run + 1 < 80 and bins[run + 1])): run += 1
            run -= first - 3
            cands.append((run, tuple(np.round(d, 2)), len(tt)))
            if best is None or run > best[0]: best = (run, d, cu * e1 + cv * e2)
        if a.debug: print(f"[fix_arms] {s}: top directions (run bins, dir, points):", sorted(cands, reverse=True)[:6])
        if not best or best[0] * 0.02 < a.prop_min:
            print(f"[fix_arms] {s}: no held weapon found"); continue
        run, d, off = best
        F = F + off
        L = run * 0.02 + 0.02
        print(f"[fix_arms] {s}: held weapon {L:.2f} m along ({d[0]:.2f},{d[1]:.2f},{d[2]:.2f})")
        hand_g = {}
        for o in meshes:
            vg = o.vertex_groups; hg = vg[f"hand_{s}"].index
            mw = o.matrix_world; k = 0
            for v in o.data.vertices:
                p = np.array((mw @ v.co)[:]) - F
                t = p @ d
                if -0.03 < t < L + 0.03 and np.linalg.norm(p - t * d) < a.prop_width * 1.3:
                    for g in list(v.groups): vg[g.group].remove([v.index])
                    vg[hg].add([v.index], 1.0, "REPLACE"); k += 1
            hand_g[o.name] = k
        print(f"[fix_arms] {s}: {sum(hand_g.values())} weapon vertices bound to hand_{s}")


if not a.no_props: held_props()

# ---------------------------------------------------------------- export (armature + skinned meshes)
for o in bpy.data.objects: o.select_set(o == arm or o in meshes)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=True, export_yup=True, export_skins=True,
                          export_animations=False, export_apply=False)
print("[fix_arms] wrote", a.out)

# ---------------------------------------------------------------- deformation test renders
if a.test:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 8; sc.render.resolution_x = 420; sc.render.resolution_y = 520
    w = bpy.data.worlds.new("w"); sc.world = w; w.color = (0.75, 0.75, 0.78)
    for o in bpy.data.objects:
        if o.type == "MESH" and o not in meshes: o.hide_render = True
    cd = bpy.data.cameras.new("t"); cd.type = "ORTHO"; cd.ortho_scale = 2.0
    cam = bpy.data.objects.new("t", cd); sc.collection.objects.link(cam); sc.camera = cam
    zc = float(np.median(allv[:, 2])) + 0.15
    poses = {"rest": {}, "forward": {"upperarm": (-80, 0, 0), "forearm": (-40, 0, 0)}, "raised": {"upperarm": (0, 0, 70), "forearm": (0, 0, 30)}}
    for name, pose in poses.items():
        for pb in arm.pose.bones: pb.rotation_mode = "XYZ"; pb.rotation_euler = (0, 0, 0)
        for s, sg in (("L", 1), ("R", -1)):
            for n, (rx, ry, rz) in pose.items():
                pb = arm.pose.bones[f"{n}_{s}"]
                # rotate about WORLD axes through the joint (the imported armature space is not world-aligned)
                Rw = Matrix.Rotation(math.radians(rx), 4, "X") @ Matrix.Rotation(math.radians(-rz * sg), 4, "Y")
                A = arm.matrix_world.to_3x3().normalized().to_4x4()
                R = A.inverted() @ Rw @ A
                pb.matrix = Matrix.Translation(pb.matrix.to_translation()) @ R @ Matrix.Translation(-pb.matrix.to_translation()) @ pb.matrix
                bpy.context.view_layer.update()
        for view, loc, rot in (("front", (0, -5, zc), (90, 0, 0)), ("side", (5, float(np.median(allv[:, 1])), zc), (90, 0, 90))):
            cam.location = loc; cam.rotation_euler = tuple(math.radians(x) for x in rot)
            sc.render.filepath = f"{a.test}_{name}_{view}.png"; bpy.ops.render.render(write_still=True)
    print("[fix_arms] test renders:", a.test + "_*.png")
