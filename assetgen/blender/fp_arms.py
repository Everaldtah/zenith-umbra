"""Blender 4.2+ / 5.x: author hero-specific FIRST-PERSON arm animations on the hero's own rig.

The mocap libraries (Quaternius UAL, Mixamo) give every hero the same body motion; the first-person arms are where each
hero gets personality - how Raijin flicks the katana, how Yuzu draws, how Enra's gauntlets flare. This script sets up
an authoring scene and exports the result for src/render/FirstPerson.ts.

  1. setup: build the scene + the hero's clip set from fp_choreo.py (Overwatch-style key poses with gameplay timing,
     see that file), sampled every frame with its easing curves, wrists solved against the IK pose; save a .blend to
     polish by hand
       blender -b -P fp_arms.py -- --hero raijin --model ../../public/models/raijin.glb --setup work/fp_raijin.blend
  2. author: open the .blend. The camera IS the in-game eye (58 deg viewmodel FOV). Animate the "fp_ctrl" armature:
     hand_L / hand_R (IK targets: move + rotate the hands), elbow_L / elbow_R (IK poles). One action per clip:
       fp_idle (loop)  fp_fire  fp_fire2  fp_alt  fp_melee  fp_reload  fp_ability1  fp_ability2  fp_ult  fp_hit  fp_land
       fp_beam (loop)  fp_draw (scrubbed by bow charge)  fp_inspect (idle flourish)  fp_equip (weapon draw)
     Wrists: the hero armature's "wrist_<clip>" actions (hand_L / hand_R rotation) - baked together with the controller.
     Add new actions with those names; keep any you don't need out (the game falls back to procedural per clip).
  3. export: bake each fp_* action through the IK onto the arm bones, export public/anim/fp_<hero>.glb and register it
       blender -b work/fp_raijin.blend -P fp_arms.py -- --hero raijin --export ../../public/anim
"""
import bpy, sys, os, json, math, argparse
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--hero", required=True)
ap.add_argument("--model", help="the hero's rigged GLB (public/models/<hero>.glb)")
ap.add_argument("--setup", help="write the authoring .blend here")
ap.add_argument("--export", help="folder to write fp_<hero>.glb + manifest.json into (public/anim)")
ap.add_argument("--fps", type=int, default=30)
a = ap.parse_args(argv)

ARM = ["shoulder_L", "upperarm_L", "forearm_L", "hand_L", "shoulder_R", "upperarm_R", "forearm_R", "hand_R"]
CLIPS = ["fp_idle", "fp_fire", "fp_fire2", "fp_alt", "fp_melee", "fp_reload", "fp_ability1", "fp_ability2", "fp_ult", "fp_hit", "fp_land",
         "fp_beam", "fp_draw", "fp_inspect", "fp_equip"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fp_choreo   # noqa: E402


def _back(u, s=1.0):
    u -= 1
    return 1 + (s + 1) * u ** 3 + s * u ** 2


# timing curves (u in 0..1 over a segment -> progress); the NEXT key's name shapes the way into it
EASE = {"lin": lambda u: u, "io": lambda u: u * u * (3 - 2 * u), "in": lambda u: u * u, "out": lambda u: 1 - (1 - u) ** 2,
        "snap": lambda u: 1 - (1 - u) ** 4, "back": _back, "hold": lambda u: u * u * (3 - 2 * u)}

# personality: view-space hand rest positions in metres from the eye (right, up, forward) - mirrors FP_STYLE in
# src/render/FirstPerson.ts so authored clips start from exactly the procedural framing
STYLE = {
    "raijin": ("katana", (0.22, -0.17, 0.46), (0.08, -0.19, 0.44), 0.0),
    "yuzu": ("bow", (0.0, -0.13, 0.4), (-0.06, -0.13, 0.52), 0.0),
    "kaien": ("caster", (0.19, -0.19, 0.46), (-0.19, -0.2, 0.44), 0.03),
    "mirei": ("caster", (0.14, -0.14, 0.38), (-0.15, -0.15, 0.35), 0.02),
    "nocturne": ("caster", (0.14, -0.1, 0.4), (-0.14, -0.11, 0.38), 0.02),
    "hex": ("caster", (0.13, -0.14, 0.38), (-0.13, -0.14, 0.38), 0.025),
    "kagemaru": ("kunai", (0.17, -0.15, 0.34), (-0.17, -0.18, 0.32), 0.0),
    "enra": ("fists", (0.16, -0.15, 0.36), (-0.16, -0.15, 0.36), 0.0),
    "haruto": ("pistol", (0.13, -0.12, 0.4), (0.06, -0.15, 0.36), 0.05),
    "tenkai": ("hammer", (0.24, -0.26, 0.38), (0.14, -0.3, 0.46), 0.0),
    "gorgoth": ("shotgun", (0.2, -0.19, 0.34), (0.05, -0.19, 0.62), 0.09),
}
# eye pushed forward past a high collar / bulky coat (metres), as FP_STYLE.push in FirstPerson.ts
PUSH = {"enra": 0.05}
# near clip (m): cut geometry closer than this to the camera - a high collar wrapped around the eye (FP_STYLE.clip)
CLIP = {"raijin": 0.14}
GRIP, REST_R, REST_L, RECOIL = STYLE.get(a.hero, ("rifle", (0.16, -0.15, 0.34), (0.03, -0.14, 0.5), 0.04))


def v3(v, d=(0, 0, 0), k=1.0):
    return tuple(v[i] + d[i] * k for i in range(3))


def starter_keys():
    """clip -> {control: [(frame, (right, up, fwd))]} for the hand targets (view space)"""
    R, L = REST_R, REST_L
    br = (0, 0.006, 0)
    K = {"fp_idle": {"hand_R": [(0, R), (30, v3(R, br)), (60, R)], "hand_L": [(0, L), (30, v3(L, br, 0.8)), (60, L)]}}
    if GRIP == "katana":
        K["fp_fire"] = {"hand_R": [(0, R), (3, (0.32, 0.06, 0.34)), (9, (-0.28, -0.32, 0.42)), (16, R)], "hand_L": [(0, L), (3, (0.25, 0.03, 0.32)), (9, (-0.34, -0.34, 0.4)), (16, L)]}
        K["fp_alt"] = {"hand_R": [(0, R), (4, (0.1, -0.1, 0.2)), (8, (0.05, -0.12, 0.6)), (18, R)], "hand_L": [(0, L), (18, L)]}
    elif GRIP == "bow":
        K["fp_fire"] = {"hand_R": [(0, (0.1, -0.06, 0.08)), (2, (0.14, -0.04, 0.03)), (10, R)], "hand_L": [(0, L), (2, v3(L, (0, 0.01, 0.02))), (10, L)]}
        K["fp_alt"] = {"hand_R": [(0, R), (20, (0.1, -0.06, 0.08)), (40, (0.1, -0.06, 0.08))], "hand_L": [(0, L), (40, L)]}
    elif GRIP == "kunai":
        K["fp_fire"] = {"hand_R": [(0, R), (3, (0.24, -0.04, 0.16)), (6, (0.06, -0.12, 0.58)), (12, R)], "hand_L": [(0, L), (12, L)]}
        K["fp_alt"] = {"hand_L": [(0, L), (4, (-0.3, 0.02, 0.35)), (10, (0.2, -0.3, 0.45)), (18, L)], "hand_R": [(0, R), (18, R)]}
    elif GRIP == "fists":
        K["fp_fire"] = {"hand_R": [(0, R), (6, (0.08, -0.14, 0.46)), (24, (0.08, -0.14, 0.46)), (30, R)], "hand_L": [(0, L), (6, (-0.08, -0.14, 0.46)), (24, (-0.08, -0.14, 0.46)), (30, L)]}
        K["fp_alt"] = {"hand_R": [(0, R), (4, (0.2, -0.18, 0.2)), (8, (0.04, -0.12, 0.62)), (20, R)], "hand_L": [(0, L), (20, L)]}
    elif GRIP == "caster":
        K["fp_fire"] = {"hand_R": [(0, R), (3, v3(R, (-0.03, 0.04, 0.12))), (8, R)], "hand_L": [(0, L), (8, L)]}
        K["fp_alt"] = {"hand_L": [(0, L), (6, (-0.06, -0.12, 0.5)), (24, (-0.06, -0.12, 0.5)), (30, L)], "hand_R": [(0, R), (30, R)]}
    elif GRIP == "hammer":
        K["fp_fire"] = {"hand_R": [(0, R), (6, (0.34, -0.1, 0.3)), (11, (-0.2, -0.24, 0.5)), (16, (-0.3, -0.2, 0.36)), (26, R)], "hand_L": [(0, L), (6, (0.3, -0.16, 0.36)), (11, (-0.12, -0.3, 0.56)), (16, (-0.24, -0.26, 0.42)), (26, L)]}
    else:  # rifle / pistol / shotgun: kick back and settle
        k = (0, 0.02, -RECOIL)
        K["fp_fire"] = {"hand_R": [(0, R), (2, v3(R, k)), (7, R)], "hand_L": [(0, L), (2, v3(L, k)), (7, L)]}
    ext = lambda e: (-0.03, -0.1, 0.36 + 0.3 * e)
    K["fp_melee"] = {"hand_L": [(0, L), (4, ext(-0.4)), (8, ext(1.0)), (13, L)], "hand_R": [(0, R), (13, R)]}
    dip = (-0.04, -0.1, -0.06)
    K["fp_reload"] = {"hand_R": [(0, R), (10, v3(R, dip)), (32, v3(R, dip)), (42, R)], "hand_L": [(0, L), (12, v3(R, dip, 1.0)), (30, v3(R, (-0.05, -0.12, -0.06))), (42, L)]}
    for n, h in (("fp_ability1", -0.08), ("fp_ability2", -0.06), ("fp_ult", 0.02)):
        n_f = 30 if n == "fp_ult" else 18
        K[n] = {"hand_R": [(0, R), (n_f // 2, (0.1, h, 0.5)), (n_f, R)], "hand_L": [(0, L), (n_f // 2, (-0.1, h, 0.5)), (n_f, L)]}
    K["fp_hit"] = {"hand_R": [(0, R), (3, v3(R, (0, 0.02, -0.02))), (8, R)], "hand_L": [(0, L), (3, v3(L, (0, 0.02, -0.02))), (8, L)]}
    K["fp_land"] = {"hand_R": [(0, R), (3, v3(R, (0, -0.04, 0))), (10, R)], "hand_L": [(0, L), (3, v3(L, (0, -0.04, 0))), (10, L)]}
    return K


def starter_choreo():
    """heroes without a fp_choreo.py entry: the starter keys as choreography (no wrist motion)"""
    out = {}
    for clip, v in starter_keys().items():
        fr = sorted({f for seq in v.values() for f, _ in seq})
        get = lambda b, f: next((p for ff, p in v.get(b, []) if ff == f), None)
        out[clip] = {"loop": clip == "fp_idle", "keys": [dict(f=f, R=get("hand_R", f), L=get("hand_L", f), Rr=None, Lr=None, e="io") for f in fr]}
    return out


def track(keys, ch, rest):
    """one channel of a choreography clip -> sampler f(frame); None values hold the previous key"""
    pts = []
    for k in keys:
        v = k.get(ch)
        if v is None:
            if pts: continue
            v = rest
        pts.append((k["f"], tuple(v), k.get("e", "io")))
    if not pts: pts = [(0, tuple(rest), "io")]
    if pts[0][0] != 0: pts.insert(0, (0, tuple(rest), "io"))

    def at(f):
        if f <= pts[0][0]: return pts[0][1]
        for (f0, v0, _), (f1, v1, e) in zip(pts, pts[1:]):
            if f <= f1:
                u = (f - f0) / max(1e-9, f1 - f0); k = EASE.get(e, EASE["io"])(u)
                return tuple(x + (y - x) * k for x, y in zip(v0, v1))
        return pts[-1][1]
    return at


def _fcurves(act):
    """an action's F-curves (Blender 4.4+ keeps them in layered channelbags)"""
    fc = list(getattr(act, "fcurves", []) or [])
    if fc: return fc
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []): out.extend(bag.fcurves)
    return out


def pole_angle(arm, side, ctrl):
    """the IK pole angle that keeps the arm untwisted at rest for THIS rig's bone rolls (a constant only fits one rig:
    after a Blender round trip the rolls change and a fixed -90 deg flipped the elbows up over the camera)"""
    ua, fa = arm.data.bones[f"upperarm_{side}"], arm.data.bones[f"forearm_{side}"]
    pole = arm.matrix_world.inverted() @ (ctrl.matrix_world @ ctrl.data.bones[f"elbow_{side}"].head_local)
    base, tip = ua.head_local, fa.tail_local
    axis = ua.tail_local - ua.head_local
    normal = (tip - base).cross(pole - base)
    proj = normal.cross(axis)
    x = ua.x_axis if hasattr(ua, "x_axis") else ua.matrix_local.to_3x3().col[0]
    ang = x.angle(proj)
    if x.cross(proj).dot(axis) < 0: ang = -ang
    return ang


def hero_armature():
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE" and o.name != "fp_ctrl"]
    if not arms: raise SystemExit("no hero armature")
    arm = max(arms, key=lambda o: len(o.data.bones))
    missing = [b for b in ARM[1:4] + ARM[5:] if b not in arm.data.bones]
    if missing: raise SystemExit(f"hero rig lacks {missing} (expected the rig_hero.py bone names)")
    return arm


def eye_frame(arm):
    """eye position + view basis (right, up, fwd) in world space. Heroes face -Y (rig_hero.py), Z up."""
    mw = arm.matrix_world
    head = mw @ arm.data.bones["head"].head_local
    foot = mw @ arm.data.bones["foot_L"].head_local
    H = (head.z - min(foot.z, 0)) * 1.08
    eye = head + Vector((0, -H * 0.05 - PUSH.get(a.hero, 0.0), H * 0.06))
    return eye, Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = a.fps
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.model))
    arm = hero_armature()
    global RIGHT, UP, FWD
    eye, RIGHT, UP, FWD = eye_frame(arm)
    # the viewmodel offset (viewmodelOffset in FirstPerson.ts): the camera + grip move together until both rest hand
    # targets are within reach of the shoulders, so the hands land where the style puts them on screen
    b = arm.data.bones
    SH = {s: arm.matrix_world @ b[f"upperarm_{s}"].head_local for s in ("L", "R")}
    REACH = {s: ((b[f"upperarm_{s}"].head_local - b[f"forearm_{s}"].head_local).length + (b[f"forearm_{s}"].head_local - b[f"hand_{s}"].head_local).length) * arm.matrix_world.to_scale().x * 0.92 for s in ("L", "R")}
    eye0 = eye.copy()      # frozen: view0 must not follow the camera when it moves by the rig offset below
    view0 = lambda p: eye0 + RIGHT * p[0] + UP * p[1] + FWD * p[2]
    o = Vector((0, 0, 0))
    # shoulders stay behind the camera: the rig may slide up / down / sideways, but only so far forward (-Y)
    minY = max(eye.y - SH[s_].y for s_ in ("L", "R")) + 0.03 + PUSH.get(a.hero, 0.0)   # and past a high collar
    def pull(s_, rest_, f):
        nonlocal o
        d = view0(rest_) - o - SH[s_]; ex = d.length - REACH[s_]
        if ex > 0: o = o + d.normalized() * ex * f
        o.y = max(o.y, minY)
    for _ in range(40):
        for s_, rest_ in (("L", REST_L), ("R", REST_R)): pull(s_, rest_, 0.6)
    pull("R", REST_R, 1.0)                                         # the main hand wins when both can't be reached
    cap = max(0.5, 2 * max(REACH.values()))
    if o.length > cap: o = o.normalized() * cap
    eye = eye - o
    view = lambda p, side="R": view0(p) - o
    # camera = the in-game eye
    cam_data = bpy.data.cameras.new("fp_eye"); cam_data.angle_y = math.radians(58); cam_data.clip_start = CLIP.get(a.hero, 0.02)
    cam = bpy.data.objects.new("fp_eye", cam_data); sc.collection.objects.link(cam)
    cam.location = eye; cam.rotation_euler = (math.radians(90), 0, math.radians(180))
    sc.camera = cam
    # head out of the way, like the game (scaled to nothing)
    arm.pose.bones["head"].scale = (0.001, 0.001, 0.001)
    # controller armature: hand targets + elbow poles, one action per clip
    cd = bpy.data.armatures.new("fp_ctrl"); ctrl = bpy.data.objects.new("fp_ctrl", cd); sc.collection.objects.link(ctrl)
    bpy.context.view_layer.objects.active = ctrl
    bpy.ops.object.mode_set(mode="EDIT")
    for side, s in (("L", 1), ("R", -1)):
        rest = REST_L if side == "L" else REST_R
        b = cd.edit_bones.new(f"hand_{side}"); b.head = view(rest, side); b.tail = b.head + FWD * 0.06
        p = cd.edit_bones.new(f"elbow_{side}"); p.head = SH[side] + (Vector((s * 0.35, 0, -0.45)) + FWD * -0.1) * min(1.0, REACH[side] / 0.46); p.tail = p.head + UP * 0.05
    bpy.ops.object.mode_set(mode="OBJECT")
    # IK on the hero's forearms (2-bone chain), hands copy the target rotation
    for side in ("L", "R"):
        pb = arm.pose.bones[f"forearm_{side}"]
        ik = pb.constraints.new("IK"); ik.name = "fp_ik"; ik.target = ctrl; ik.subtarget = f"hand_{side}"; ik.chain_count = 2
        ik.pole_target = ctrl; ik.pole_subtarget = f"elbow_{side}"; ik.pole_angle = pole_angle(arm, side, ctrl)
        hb = arm.pose.bones[f"hand_{side}"]
        cr = hb.constraints.new("COPY_ROTATION"); cr.name = "fp_hand"; cr.target = ctrl; cr.subtarget = f"hand_{side}"; cr.influence = 0.0
    # no IK stretch: Blender's solver trades rotation for stretch even inside reach and the bake stores it as a uniform
    # bone scale (the sleeve ballooned over the camera); the exaggeration lives in the poses and wrists instead
    for side in ("L", "R"):
        arm.pose.bones[f"forearm_{side}"].constraints["fp_ik"].use_stretch = False
        arm.pose.bones[f"hand_{side}"].constraints["fp_hand"].mute = True
        arm.pose.bones[f"hand_{side}"].rotation_mode = "QUATERNION"
    # clips: fp_choreo.py key poses, sampled every frame (so the timing curves survive the bake exactly)
    C = fp_choreo.build(a.hero, REST_R, REST_L) or starter_choreo()
    ctrl.animation_data_create()
    tracks = {}
    for clip in CLIPS:
        spec = C.get(clip)
        if not spec: continue
        keys = spec["keys"]; n = max(k["f"] for k in keys)
        act = bpy.data.actions.new(clip); act.use_fake_user = True
        ctrl.animation_data.action = act
        T = {ch: track(keys, ch, (REST_R if ch == "R" else REST_L if ch == "L" else (0, 0, 0))) for ch in ("R", "L", "Rr", "Lr")}
        tracks[clip] = (n, T)
        for f in range(n + 1):
            for side in ("R", "L"):
                rest = REST_L if side == "L" else REST_R
                if rest is None: continue
                pb = ctrl.pose.bones[f"hand_{side}"]
                d = view(T[side](f), side) - view(rest, side)
                pb.location = pb.bone.matrix_local.to_3x3().inverted() @ d
                pb.keyframe_insert("location", frame=f)
        for fc in _fcurves(act):
            for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
        print(f"[fp_arms] {clip}: {n} frames{' (loop)' if spec.get('loop') else ''}")
    # wrists: with the hands simply following the forearms, read each frame's hand orientation, then key the local
    # rotation that turns it by the clip's view-space wrist angles (pitch up / yaw right / roll clockwise)
    arm.animation_data_create()
    Mq = arm.matrix_world.to_quaternion()
    for clip, (n, T) in tracks.items():
        ctrl.animation_data.action = bpy.data.actions[clip]
        arm.animation_data.action = None
        for side in ("L", "R"): arm.pose.bones[f"hand_{side}"].rotation_quaternion = (1, 0, 0, 0)
        rows = []
        for f in range(n + 1):
            sc.frame_set(f); bpy.context.view_layer.update()
            row = {}
            for side, ch in (("R", "Rr"), ("L", "Lr")):
                p_, y_, r_ = T[ch](f)
                if abs(p_) + abs(y_) + abs(r_) < 1e-6: row[side] = None; continue
                Rv = Quaternion(FWD, math.radians(r_)) @ Quaternion(UP, -math.radians(y_)) @ Quaternion(RIGHT, math.radians(p_))
                Rv_arm = Mq.inverted() @ Rv @ Mq
                Fq = arm.pose.bones[f"hand_{side}"].matrix.to_quaternion()
                row[side] = Fq.inverted() @ Rv_arm @ Fq
            rows.append(row)
        wa = bpy.data.actions.new(f"wrist_{clip}"); wa.use_fake_user = True
        arm.animation_data.action = wa
        for side in ("L", "R"):
            pb = arm.pose.bones[f"hand_{side}"]
            prev = None
            for f, row in enumerate(rows):
                q = row[side] or Quaternion((1, 0, 0, 0))
                if prev is not None and prev.dot(q) < 0: q = -q          # keep the quaternion path continuous (spins)
                pb.rotation_quaternion = q; pb.keyframe_insert("rotation_quaternion", frame=f); prev = q
        for fc in _fcurves(wa):
            for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
        arm.animation_data.action = None
        for side in ("L", "R"): arm.pose.bones[f"hand_{side}"].rotation_quaternion = (1, 0, 0, 0)
    ctrl.animation_data.action = bpy.data.actions.get("fp_idle")
    sc.frame_start, sc.frame_end = 0, 60
    os.makedirs(os.path.dirname(os.path.abspath(a.setup)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.setup))
    print("[fp_arms] authoring scene:", a.setup)


def export():
    sc = bpy.context.scene
    arm = hero_armature()
    ctrl = bpy.data.objects.get("fp_ctrl")
    if not ctrl: raise SystemExit("run --setup first (no fp_ctrl controller in this file)")
    arm.pose.bones["head"].scale = (1, 1, 1)
    baked = []
    arm.animation_data_create()
    for clip in CLIPS:
        src = bpy.data.actions.get(clip)
        if not src: continue
        src.name = f"ctrl_{clip}"          # the baked bone action takes the clip name
        ctrl.animation_data.action = src
        f0, f1 = (int(x) for x in src.frame_range)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="POSE")
        for pb in arm.pose.bones:
            # Blender 5 selects pose bones directly; 4.x through the Bone
            if hasattr(pb, "select"): pb.select = pb.name in ARM
            else: pb.bone.select = pb.name in ARM
        arm.animation_data.action = bpy.data.actions.get(f"wrist_{clip}")      # hand rotations ride along into the bake
        bpy.ops.nla.bake(frame_start=f0, frame_end=max(f0 + 1, f1), only_selected=True, visual_keying=True, clear_constraints=False,
                         use_current_action=False, bake_types={"POSE"})
        bpy.ops.object.mode_set(mode="OBJECT")
        act = arm.animation_data.action
        act.name = f"{clip}"; act.use_fake_user = True
        baked.append(act)
        print(f"[fp_arms] baked {clip}: frames {f0}-{f1}")
    arm.animation_data.action = None
    # export the rig with the baked actions only (constraints muted: the exporter must sample the baked keys)
    for pb in arm.pose.bones:
        for c in pb.constraints: c.mute = True
    for o in list(bpy.data.objects):
        if o.type == "MESH" or o == ctrl or o.type == "CAMERA": bpy.data.objects.remove(o, do_unlink=True)
    arm.animation_data.action = None
    for tr in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(tr)
    for act in baked:
        tr = arm.animation_data.nla_tracks.new(); tr.name = act.name; tr.strips.new(act.name, int(act.frame_range[0]), act); tr.mute = True
    # only the baked clips may export (the controller's hand_L / hand_R keys would bind to the rig's hand bones)
    for x in list(bpy.data.actions):
        if x not in baked: bpy.data.actions.remove(x)
    for o in bpy.data.objects: o.select_set(o == arm)
    bpy.context.view_layer.objects.active = arm
    os.makedirs(a.export, exist_ok=True)
    fname = f"fp_{a.hero}.glb"
    out = os.path.join(a.export, fname)
    kw = dict(filepath=os.path.abspath(out), export_format="GLB", use_selection=True, export_yup=True, export_skins=True, export_animations=True,
              export_animation_mode="ACTIONS", export_force_sampling=True, export_apply=False)
    bpy.ops.export_scene.gltf(**kw)
    man_path = os.path.join(a.export, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    man.setdefault("fp", {})[a.hero] = fname
    json.dump(man, open(man_path, "w"), indent=2)
    print(f"[fp_arms] {out}: {len(baked)} clips ({', '.join(x.name for x in baked)})")


if a.setup:
    if not a.model: raise SystemExit("--setup needs --model")
    setup()
if a.export:
    export()
