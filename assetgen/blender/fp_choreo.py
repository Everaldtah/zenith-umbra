"""First-person choreography: every hero's viewmodel clips as key poses + timing curves, read by fp_arms.py.

Overwatch's first-person rules (Matt Boehm, "The First Person Animation of Overwatch", GDC 2017), as data:
  * gameplay owns the clock: each clip is exactly as long as the design allows (a fire clip fits between two shots, the
    reload IS the reload time, 30 fps frames) - personality lives inside that window, never stretches it
  * no anticipation on a player action: the pose answers the button within 1-2 frames ('snap'); the energy goes into
    the follow-through and the settle ('back' overshoots, 'out' eases down)
  * keep the reticle clear: reloads and flourishes happen low and to the side, the off hand does the work
  * exaggerate for the camera only: arms stretch a little on strikes and recoil (IK stretch), wrists over-rotate
  * personality: every hero holds, fires, reloads and fidgets their own way - see the notes per hero

Units: hand targets in metres from the eye, view space (right, up, forward) - the same frame as FP_STYLE in
src/render/FirstPerson.ts. Wrist rotations in degrees (pitch up, yaw right, roll clockwise), relative to the hand simply
following the forearm (the in-game procedural convention). Easing names: see EASE in fp_arms.py.
"""

FPS = 30


def K(f, R=None, L=None, Rr=None, Lr=None, e="io"):
    """a key at frame f: hand positions (R / L, view space) and wrist rotations (Rr / Lr); None = keep the previous"""
    return {"f": f, "R": R, "L": L, "Rr": Rr, "Lr": Lr, "e": e}


def off(p, dx=0.0, dy=0.0, dz=0.0):
    return (p[0] + dx, p[1] + dy, p[2] + dz)


def frames(sec):
    return max(2, int(round(sec * FPS)))


# ------------------------------------------------------------------------------------------------ shared building blocks
def idle(R, L, amp=0.006, sway=0.004, secs=2.0, Rr=(0, 0, 0), Lr=(0, 0, 0)):
    """breathing loop: a slow rise and settle, the off hand a beat behind (never perfectly in sync)"""
    n = frames(secs)
    return {"loop": True, "keys": [
        K(0, R, L, Rr, Lr, "lin"),
        K(n * 3 // 8, off(R, sway * 0.3, amp, 0), off(L, -sway * 0.2, amp * 0.6, 0) if L else None, off(Rr, 1, 0, 0), None, "io"),
        K(n * 5 // 8, off(R, -sway * 0.2, amp * 0.4, 0.002), off(L, sway * 0.2, amp * 0.9, 0) if L else None, None, off(Lr, 1, 0, 0), "io"),
        K(n, R, L, Rr, Lr, "io"),
    ]}


def quick_melee(R, L, main_hand_free=True, secs=0.45):
    """C: the off hand snaps out (2 frames), holds the hit, recovers - the weapon hand dips out of the way"""
    n = frames(secs)
    if main_hand_free and L:
        return {"keys": [K(0, R, L), K(2, off(R, 0.02, -0.03, -0.03), (-0.04, -0.08, 0.5), None, (-10, 10, -30), "snap"),
                         K(4, None, (-0.02, -0.07, 0.68), None, (-5, 5, -40), "out"), K(7, None, (-0.02, -0.08, 0.64), None, None, "hold"),
                         K(n, R, L, (0, 0, 0), (0, 0, 0), "io")]}
    return {"keys": [K(0, R, L), K(2, (0.08, -0.08, 0.5), L, (-10, -10, 20), None, "snap"), K(4, (0.04, -0.07, 0.68), None, None, None, "out"),
                     K(7, (0.04, -0.08, 0.64), None, None, None, "hold"), K(n, R, L, (0, 0, 0), None, "io")]}


def flinch(R, L):
    return {"keys": [K(0, R, L), K(2, off(R, 0.01, 0.025, -0.03), off(L, -0.01, 0.025, -0.03) if L else None, (8, 0, 4), (8, 0, -4) if L else None, "snap"),
                     K(8, R, L, (0, 0, 0), (0, 0, 0) if L else None, "back")]}


def land(R, L):
    return {"keys": [K(0, R, L), K(3, off(R, 0, -0.045, 0.01), off(L, 0, -0.05, 0.01) if L else None, (-6, 0, 0), (-6, 0, 0) if L else None, "out"),
                     K(11, R, L, (0, 0, 0), (0, 0, 0) if L else None, "back")]}


def equip(R, L, from_side=1, secs=0.6):
    """weapon draw on spawn / hero swap: rises in from below the screen edge, a small overshoot, settles"""
    n = frames(secs)
    lo = (R[0] + 0.08 * from_side, R[1] - 0.3, R[2] - 0.08)
    return {"keys": [K(0, lo, off(L, -0.06, -0.3, -0.08) if L else None, (-40, 20 * from_side, 30 * from_side), (-30, 0, 0) if L else None, "lin"),
                     K(int(n * 0.6), off(R, 0, 0.01, 0), off(L, 0, 0.012, 0) if L else None, (4, 0, 0), (3, 0, 0) if L else None, "out"),
                     K(n, R, L, (0, 0, 0), (0, 0, 0) if L else None, "back")]}


def cast(R, L, reach=(0.0, -0.06, 0.52), palms=(10, 0, 0), secs=0.6, spread=0.1, ult=False):
    """two-handed ability gesture toward the aim; ults lift higher, hold longer and spread wide on the release"""
    n = frames(secs)
    hi = 0.05 if ult else 0.0
    return {"keys": [K(0, R, L),
                     K(3, off(reach, spread, hi), off(reach, -spread, hi), palms, (palms[0], -palms[1], -palms[2]), "snap"),
                     K(int(n * 0.45), off(reach, spread * 0.8, hi + 0.01, 0.04), off(reach, -spread * 0.8, hi + 0.01, 0.04), None, None, "out"),
                     K(int(n * 0.7), off(reach, spread * (2.2 if ult else 1.3), hi + (0.04 if ult else 0), 0.02), off(reach, -spread * (2.2 if ult else 1.3), hi + (0.04 if ult else 0), 0.02), None, None, "out"),
                     K(n, R, L, (0, 0, 0), (0, 0, 0), "io")]}


def gun_kick(R, L, k, rot=8, frames_=5, stretch=0.0):
    """fire: the kick lands on frame 1 (no wind-up), then a slower settle with a small rebound"""
    kick = (0.0, 0.02 * k / 0.05, -k)
    ks = [K(0, R, L), K(1, off(R, *kick), off(L, *kick) if L else None, (rot, 0, 0), (rot * 0.6, 0, 0) if L else None, "snap"),
          K(max(2, frames_ - 2), off(R, 0, 0, stretch), off(L, 0, 0, stretch) if L else None, (-1, 0, 0), None, "out"),
          K(frames_, R, L, (0, 0, 0), (0, 0, 0) if L else None, "io")]
    return {"keys": ks}


# ------------------------------------------------------------------------------------------------ heroes
def raijin(R, L):
    """RAIJIN - lightning duelist, cocky and fast. Katana in the right hand, left hand free for thunder. Swings alternate
    (fp_fire / fp_fire2) and each one ends on a held beat, blade flat, like a showman. Reload recharges the three thunder
    rounds: the left palm runs along the blade (sparks), a flick of the wrist to finish. Inspect: a spin of the katana."""
    rest_r = (35, 0, 17)          # blade up and across, like the procedural guard
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.005, Rr=rest_r)
    # 0.45 s between swings (rate 2.2): 13 frames. Wind-up is only 2 frames; the strike crosses the screen in 3
    C["fp_fire"] = {"keys": [K(0, R, L, rest_r, (0, 0, 0)),
                             K(2, (0.3, 0.06, 0.3), off(L, 0.12, 0.03, -0.02), (-10, -40, 70), (0, 0, 10), "snap"),
                             K(5, (-0.26, -0.3, 0.46), off(L, -0.08, -0.04, 0.02), (-60, 50, -30), (0, 0, -10), "out"),
                             K(7, (-0.24, -0.29, 0.44), None, (-62, 52, -28), None, "hold"),
                             K(13, R, L, rest_r, (0, 0, 0), "back")]}
    C["fp_fire2"] = {"keys": [K(0, R, L, rest_r, (0, 0, 0)),
                              K(2, (-0.18, 0.02, 0.32), off(L, -0.04, 0.02, -0.03), (-20, 45, -60), (0, 0, -10), "snap"),
                              K(5, (0.32, -0.26, 0.46), off(L, 0.1, -0.04, 0.02), (-50, -50, 40), (0, 0, 10), "out"),
                              K(7, (0.3, -0.25, 0.44), None, (-52, -50, 42), None, "hold"),
                              K(13, R, L, rest_r, (0, 0, 0), "back")]}
    # thunder bolt (RMB, rate 1.1): the left hand throws a bolt off two fingers, the blade dips out of the line
    C["fp_alt"] = {"keys": [K(0, R, L, rest_r), K(2, off(R, 0.03, -0.04, -0.03), (-0.05, -0.08, 0.42), None, (-20, 0, -40), "snap"),
                            K(4, None, (-0.03, -0.06, 0.62), None, (-10, 5, -60), "out"), K(9, None, (-0.03, -0.065, 0.6), None, None, "hold"),
                            K(24, R, L, rest_r, (0, 0, 0), "io")]}
    # reload 2.4 s: 72 frames. Blade comes across low (reticle clear), palm slides guard -> tip, a flick, back to guard
    n = frames(2.4)
    C["fp_reload"] = {"keys": [K(0, R, L, rest_r),
                               K(8, (0.08, -0.2, 0.36), off(L, 0.1, -0.02, 0.0), (-80, -60, 10), (0, 0, 0), "io"),
                               K(14, None, (0.03, -0.2, 0.33), None, (-10, 0, 80), "io"),
                               K(38, None, (-0.2, -0.18, 0.52), None, (-10, 0, 80), "io"),
                               K(44, None, off(L, 0, -0.03, 0), None, (0, 0, 0), "out"),
                               K(52, (0.24, -0.1, 0.34), None, (10, -20, 120), None, "snap"),
                               K(58, off(R, 0, 0.01, 0), None, (-20, 0, 30), None, "out"),
                               K(n, R, L, rest_r, (0, 0, 0), "back")]}
    C["fp_melee"] = quick_melee(R, L)
    # flash step: iaido stance - blade drawn back low right, then released forward
    C["fp_ability1"] = {"keys": [K(0, R, L, rest_r), K(2, (0.28, -0.24, 0.2), (0.12, -0.2, 0.26), (-70, -30, 0), (0, 0, 20), "snap"),
                                 K(6, (-0.1, -0.2, 0.62), (-0.14, -0.2, 0.4), (-80, 30, -20), None, "out"), K(18, R, L, rest_r, (0, 0, 0), "io")]}
    # thunder parry: blade vertical across the body, left palm on the back of the blade
    C["fp_ability2"] = {"keys": [K(0, R, L, rest_r), K(2, (0.06, -0.12, 0.34), (-0.02, -0.02, 0.4), (60, 10, 0), (0, 0, 70), "snap"),
                                 K(30, (0.06, -0.11, 0.35), (-0.02, -0.015, 0.41), (62, 10, 0), None, "hold"), K(36, R, L, rest_r, (0, 0, 0), "io")]}
    # judgment: blade raised overhead to call the storm, then swept down
    C["fp_ult"] = {"keys": [K(0, R, L, rest_r), K(3, (0.2, 0.06, 0.52), (0.1, 0.02, 0.5), (70, 0, 0), (40, 0, 0), "snap"),
                            K(16, (0.21, 0.09, 0.54), (0.11, 0.04, 0.52), (80, 0, 5), None, "out"),
                            K(21, (-0.1, -0.28, 0.5), off(L, -0.04), (-70, 30, 0), (0, 0, 0), "snap"), K(32, R, L, rest_r, (0, 0, 0), "back")]}
    # inspect (idle 7 s): the katana spins once in the fingers and snaps back into the guard
    C["fp_inspect"] = {"keys": [K(0, R, L, rest_r), K(10, (0.2, -0.1, 0.4), None, (-10, -10, 90), None, "io"),
                                K(20, None, None, (-10, -10, 270), None, "lin"), K(30, None, None, (-10, -10, 450), None, "lin"),
                                K(38, off(R, 0, 0.01), None, (-30, 0, 380), None, "out"), K(50, R, L, (-30, 0, 380), (0, 0, 0), "back")]}
    return C


def yuzu(R, L):
    """YUZU - calm, precise archer. Bow in the left hand, arrow in the right. The draw is scrubbed by charge (fp_draw):
    the string hand comes to the cheek. The release (fp_fire) snaps the right hand back and open, the bow arm kicks
    forward, then she nocks the next arrow from the quiver over the right shoulder - all inside the 0.9 s shot cycle."""
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.004, sway=0.003, Lr=(0, 0, -10))
    draw = (0.1, -0.06, 0.08)
    C["fp_draw"] = {"keys": [K(0, R, L, (0, 0, 0), (0, 0, -10)), K(20, draw, off(L, 0, 0.01, 0.03), (0, 10, 0), (0, 0, -15), "out")]}
    C["fp_fire"] = {"keys": [K(0, draw, off(L, 0, 0.01, 0.03), (0, 10, 0), (0, 0, -15)),
                             K(1, (0.16, -0.04, 0.02), off(L, 0, 0.015, 0.05), (10, 25, 20), (-4, 0, -15), "snap"),
                             K(6, (0.17, -0.05, 0.02), off(L, 0, 0.0, 0.02), None, (0, 0, -10), "out"),
                             K(12, (0.2, 0.02, -0.02), None, (40, 30, 30), None, "io"),
                             K(20, off(R, 0.02, 0.0, 0.0), None, (0, 0, 0), None, "io"),
                             K(27, R, L, (0, 0, 0), (0, 0, -10), "io")]}
    C["fp_alt"] = {"keys": [K(0, R, L), K(10, off(R, 0, 0.01, -0.01), off(L, 0, 0.01, 0.02), None, None, "io"), K(30, R, L, None, None, "io")]}
    C["fp_melee"] = quick_melee(R, L, main_hand_free=True)
    C["fp_ability1"] = {"keys": [K(0, R, L), K(3, off(R, 0.04, -0.12, -0.04), off(L, -0.02, -0.12, -0.04), (-20, 0, 0), (-20, 0, -10), "snap"),
                                 K(10, off(R, 0.02, 0.04, 0.02), off(L, 0, 0.05, 0.02), (10, 0, 0), (10, 0, -10), "out"), K(18, R, L, (0, 0, 0), (0, 0, -10), "io")]}
    C["fp_ability2"] = C["fp_fire"]
    C["fp_ult"] = {"keys": [K(0, R, L), K(4, (0.05, 0.14, 0.3), (0.0, 0.16, 0.4), (60, 0, 0), (60, 0, -10), "snap"),
                            K(18, (0.12, 0.2, 0.1), (0.0, 0.2, 0.42), (70, 10, 10), None, "out"),
                            K(20, (0.2, 0.18, 0.04), None, (80, 30, 30), None, "snap"), K(32, R, L, (0, 0, 0), (0, 0, -10), "io")]}
    C["fp_inspect"] = {"keys": [K(0, R, L), K(12, off(R, 0.03, 0.02), (0.02, -0.08, 0.44), None, (0, -30, -40), "io"),
                                K(32, None, (0.02, -0.075, 0.45), None, (0, -32, -60), "io"), K(48, R, L, (0, 0, 0), (0, 0, -10), "io")]}
    return C


def caster(R, L, who):
    """the four casters, one family - four personalities:
      KAIEN  (warding monk)  talismans fanned between the fingers, thrown with a two-finger flick; reload pulls a fresh
                             stack from the left sleeve; the heal (RMB) is a prayer seal with the left palm
      MIREI  (angel medic)   graceful: fingertip star flicks, an open palm for the heal beam, wrists never rigid
      NOCTURNE (vampire diva) a conductor: clawed flourishes, big wrist rolls, the beam hand spread like a cue
      HEX    (puppeteer)     fingers hooked on strings: needles flick off the fingertips, the reload threads new needles"""
    C = {}
    sty = {"kaien": dict(amp=0.005, rot=(0, 0, 0), flick=(-0.03, 0.05, 0.13), frot=(35, -10, -20)),
           "mirei": dict(amp=0.007, rot=(10, 0, -10), flick=(-0.02, 0.06, 0.14), frot=(25, 5, 25)),
           "nocturne": dict(amp=0.006, rot=(0, 0, 30), flick=(-0.05, 0.07, 0.12), frot=(15, -25, 60)),
           "hex": dict(amp=0.004, rot=(-10, 0, 10), flick=(-0.01, 0.03, 0.15), frot=(40, 0, -5))}[who]
    rr = sty["rot"]
    C["fp_idle"] = idle(R, L, amp=sty["amp"], Rr=rr, Lr=(rr[0], -rr[1], -rr[2]))
    rate = {"kaien": 1.6, "mirei": 3.0, "nocturne": 4.0, "hex": 3.0}[who]
    n = min(frames(1 / rate), 16)
    C["fp_fire"] = {"keys": [K(0, R, L, rr), K(1, off(R, *sty["flick"]), None, sty["frot"], None, "snap"),
                             K(max(3, n // 2), off(R, sty["flick"][0] * 0.5, sty["flick"][1] * 0.3, sty["flick"][2] * 0.8), None, (sty["frot"][0] * 0.5, sty["frot"][1], sty["frot"][2]), None, "out"),
                             K(n, R, L, rr, None, "io")]}
    if who in ("mirei", "nocturne"):
        # heal beam (RMB, held): the off hand extends toward the target and holds, a slow shimmer in the wrist
        beam = (-0.06, -0.1, 0.5)
        C["fp_beam"] = {"loop": True, "keys": [K(0, off(R, 0.02, -0.01, -0.02), beam, rr, (0, 0, 0)),
                                                K(15, None, off(beam, 0.004, 0.004, 0.005), None, (3, 2, 4), "io"),
                                                K(30, off(R, 0.02, -0.01, -0.02), beam, rr, (0, 0, 0), "io")]}
    else:
        # the heal projectile: kaien seals with the left palm upright, hex stitches with a hooked-finger pull
        C["fp_alt"] = {"keys": [K(0, R, L, rr), K(2, None, (-0.06, -0.06, 0.46), None, (80, 0, -10) if who == "kaien" else (30, 20, -40), "snap"),
                                K(6, None, (-0.05, -0.06, 0.5), None, None, "out"), K(12, None, None, None, None, "hold"),
                                K(frames(1 / (1.25 if who == "kaien" else 1.2)), R, L, rr, (0, 0, 0), "io")]}
    rl = {"kaien": 1.6, "mirei": 1.4, "nocturne": 1.5, "hex": 1.5}[who]
    m = frames(rl)
    if who == "kaien":
        # new talismans from the left sleeve: the right hand crosses low to the left wrist, pulls, fans them out
        C["fp_reload"] = {"keys": [K(0, R, L, rr), K(8, off(L, 0.03, 0.0, 0.02), off(L, 0.02, 0.02, 0.0), (-20, 40, -60), (0, 0, 40), "io"),
                                   K(20, (0.02, -0.2, 0.34), None, (-10, 30, -40), None, "io"), K(26, None, off(L, 0, -0.02, 0), None, (0, 0, 0), "io"),
                                   K(34, (0.14, -0.1, 0.4), None, (20, -20, 60), None, "out"), K(m, R, L, rr, (0, 0, 0), "back")]}
    elif who == "hex":
        # threading needles: both hands low and together, a pulling motion twice, strings snapped taut
        C["fp_reload"] = {"keys": [K(0, R, L, rr), K(8, (0.06, -0.2, 0.36), (-0.02, -0.2, 0.36), (-20, 0, 30), (-20, 0, -30), "io"),
                                   K(16, (0.12, -0.16, 0.3), None, (-10, 0, 40), None, "io"), K(22, (0.06, -0.2, 0.36), None, None, None, "io"),
                                   K(30, (0.14, -0.15, 0.3), None, None, None, "io"), K(36, None, off(L, 0, 0, 0), None, (0, 0, 0), "io"),
                                   K(m, R, L, rr, (0, 0, 0), "back")]}
    else:
        # star / blood notes gather in the cupped right hand, low right - the reticle stays clear
        C["fp_reload"] = {"keys": [K(0, R, L, rr), K(8, off(R, 0.02, -0.1, -0.03), off(L, 0.12, -0.08, 0.0), (-40, 0, 0), (0, 0, 60), "io"),
                                   K(m - 12, off(R, 0.02, -0.09, -0.02), off(L, 0.12, -0.075, 0.0), (-45, 0, 10), None, "io"),
                                   K(m - 5, off(R, 0, 0.01, 0.01), None, (10, 0, 0), None, "out"), K(m, R, L, rr, (0, 0, 0), "back")]}
    C["fp_melee"] = quick_melee(R, L)
    reach = {"kaien": (0.0, -0.05, 0.5), "mirei": (0.0, -0.02, 0.5), "nocturne": (0.0, 0.0, 0.48), "hex": (0.0, -0.04, 0.52)}[who]
    palms = {"kaien": (70, 0, 0), "mirei": (20, 0, 20), "nocturne": (10, 20, 50), "hex": (30, 10, -20)}[who]
    C["fp_ability1"] = cast(R, L, reach, palms)
    C["fp_ability2"] = cast(R, L, off(reach, 0, -0.03, 0.02), (palms[0] + 10, palms[1], palms[2]), secs=0.5, spread=0.07)
    C["fp_ult"] = cast(R, L, reach, palms, secs=1.0, spread=0.08, ult=True)
    # inspect: kaien counts his beads, mirei turns a star in her palm, nocturne admires her claws, hex tests a string
    C["fp_inspect"] = {"keys": [K(0, R, L, rr), K(14, (0.04, -0.1, 0.36), (-0.03, -0.11, 0.36), (40, -20, 30), (40, 20, -30), "io"),
                                K(34, (0.05, -0.095, 0.37), (-0.035, -0.105, 0.37), (45, -30, 50), (40, 20, -10), "io"),
                                K(50, None, None, (40, -20, 20), (35, 25, -40), "io"), K(66, R, L, rr, (0, 0, 0), "io")]}
    return C


def kagemaru(R, L):
    """KAGEMARU - shinobi. Kunai thrown overhand with a snap (3/s), the off hand low and ready. RMB: twin-fang backhand
    slash with the left blade. Reload: three kunai fanned between the fingers, rolled into the throwing grip. Veil: a
    hand seal in front of the chest. Inspect: a kunai twirled around one finger."""
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.004, sway=0.005, Rr=(-20, 0, -30), Lr=(-10, 0, 30))
    C["fp_fire"] = {"keys": [K(0, R, L, (-20, 0, -30)), K(1, (0.24, 0.0, 0.18), None, (40, -20, -60), None, "snap"),
                             K(3, (0.06, -0.1, 0.6), None, (-40, 10, -20), None, "snap"), K(6, (0.07, -0.11, 0.57), None, None, None, "out"),
                             K(10, R, L, (-20, 0, -30), None, "io")]}
    C["fp_alt"] = {"keys": [K(0, R, L, None, (-10, 0, 30)), K(2, off(R, 0.03, -0.04, -0.04), (-0.32, 0.04, 0.34), None, (-20, -60, 80), "snap"),
                            K(5, None, (0.22, -0.3, 0.46), None, (-60, 60, -40), "out"), K(8, None, (0.2, -0.29, 0.44), None, None, "hold"),
                            K(25, R, L, (-20, 0, -30), (-10, 0, 30), "io")]}
    C["fp_reload"] = {"keys": [K(0, R, L, (-20, 0, -30)), K(8, (0.1, -0.2, 0.34), (0.02, -0.2, 0.34), (-30, 0, 60), (-30, 0, -40), "io"),
                               K(16, (0.12, -0.14, 0.36), None, (0, 0, 90), None, "out"), K(24, None, None, (0, 0, 20), None, "io"),
                               K(30, (0.14, -0.12, 0.36), None, (0, 0, 90), None, "out"), K(34, None, L, None, (-10, 0, 30), "io"),
                               K(42, R, None, (-20, 0, -30), None, "back")]}
    C["fp_melee"] = quick_melee(R, L)
    C["fp_ability1"] = {"keys": [K(0, R, L), K(2, off(R, -0.08, 0.04, -0.04), off(L, 0.08, 0.04, -0.04), (40, -40, 0), (40, 40, 0), "snap"),
                                 K(10, None, None, None, None, "hold"), K(18, R, L, (-20, 0, -30), (-10, 0, 30), "io")]}
    # veil: a hand seal (both hands meet in front of the chest), a breath, then they drop low
    C["fp_ability2"] = {"keys": [K(0, R, L), K(3, (0.02, -0.08, 0.34), (-0.01, -0.08, 0.34), (70, -10, 0), (70, 10, 0), "snap"),
                                 K(14, (0.02, -0.075, 0.35), (-0.01, -0.075, 0.35), None, None, "hold"), K(24, R, L, (-20, 0, -30), (-10, 0, 30), "out")]}
    C["fp_ult"] = {"keys": [K(0, R, L), K(2, (0.1, -0.22, 0.24), (-0.1, -0.22, 0.24), (-60, 0, -40), (-60, 0, 40), "snap"),
                            K(8, (-0.2, -0.1, 0.56), (0.2, -0.1, 0.56), (-40, 40, 60), (-40, -40, -60), "out"), K(30, R, L, (-20, 0, -30), (-10, 0, 30), "io")]}
    C["fp_inspect"] = {"keys": [K(0, R, L, (-20, 0, -30)), K(8, (0.12, -0.08, 0.36), None, (0, 0, 0), None, "io"),
                                K(16, None, None, (0, 0, 360), None, "lin"), K(24, None, None, (0, 0, 720), None, "lin"),
                                K(32, None, None, (0, 0, 1080), None, "out"), K(44, R, None, (-20, 0, 1050), None, "io")]}
    return C


def enra(R, L):
    """ENRA - a thousand-year oni. Heavy, deliberate, knuckles cracking. Primary is a flame stream from both palms
    (fp_beam, held); RMB is a slow haymaker (rate 0.4: 2.5 s) with a real wind-up for once - it's a gamble, the
    animation says so. Chain: the right arm hurls the chain. Inspect: he cracks his knuckles."""
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.008, sway=0.006, secs=2.6, Rr=(-10, 0, -20), Lr=(-10, 0, 20))
    C["fp_beam"] = {"loop": True, "keys": [K(0, (0.08, -0.14, 0.46), (-0.08, -0.14, 0.46), (60, 0, 0), (60, 0, 0)),
                                            K(6, (0.082, -0.138, 0.465), (-0.078, -0.142, 0.462), (62, 2, 3), (61, -2, -3), "io"),
                                            K(12, (0.08, -0.14, 0.46), (-0.08, -0.14, 0.46), (60, 0, 0), (60, 0, 0), "io")]}
    n = frames(1.6)
    C["fp_alt"] = {"keys": [K(0, R, L, (-10, 0, -20)), K(6, (0.3, -0.12, 0.12), off(L, 0.04, 0.02, 0.04), (-10, -30, -60), None, "out"),
                            K(9, (0.02, -0.08, 0.72), None, (-20, 20, -10), None, "snap"), K(15, (0.03, -0.085, 0.7), None, None, None, "hold"),
                            K(n, R, L, (-10, 0, -20), (-10, 0, 20), "io")]}
    C["fp_melee"] = quick_melee(R, L)
    C["fp_ability1"] = {"keys": [K(0, R, L), K(4, (0.3, 0.02, 0.1), None, (20, -30, -40), None, "out"), K(7, (0.04, -0.04, 0.7), None, (-10, 10, 0), None, "snap"),
                                 K(20, R, L, (-10, 0, -20), None, "io")]}
    C["fp_ability2"] = cast(R, L, (0.0, -0.1, 0.5), (50, 0, 0), secs=0.6, spread=0.12)
    C["fp_ult"] = {"keys": [K(0, R, L), K(4, (0.18, -0.02, 0.3), (-0.18, -0.02, 0.3), (-40, 0, -60), (-40, 0, 60), "snap"),
                            K(20, (0.2, 0.0, 0.28), (-0.2, 0.0, 0.28), (-50, 0, -70), (-50, 0, 70), "io"),
                            K(24, (0.24, -0.2, 0.36), (-0.24, -0.2, 0.36), (-70, 0, -30), (-70, 0, 30), "snap"), K(40, R, L, (-10, 0, -20), (-10, 0, 20), "back")]}
    C["fp_inspect"] = {"keys": [K(0, R, L), K(12, (0.04, -0.1, 0.34), (-0.02, -0.1, 0.32), (0, -40, -80), (0, 40, 60), "io"),
                                K(16, (0.05, -0.1, 0.35), None, (10, -40, -80), None, "snap"), K(26, None, None, None, None, "hold"),
                                K(30, (0.04, -0.1, 0.34), (-0.02, -0.1, 0.32), (0, -30, -60), (0, 50, 80), "snap"), K(48, R, L, (-10, 0, -20), (-10, 0, 20), "io")]}
    return C


def haruto(R, L):
    """HARUTO - seventeen, hot-blooded, a show-off. Sunspark blaster: short hard kicks at 7 shots/s (4 frames, lands
    on frame 1). Reload 1.3 s: flicks the spent cell out with a wrist snap, slaps the new one in with his left palm and
    spins the blaster once - D.Va-style swagger. Flare (RMB): a heavy two-handed kick. Combat roll: gun tucked to chest."""
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.005, Rr=(0, 0, 0))
    C["fp_fire"] = gun_kick(R, L, 0.05, rot=10, frames_=4)
    C["fp_alt"] = {"keys": [K(0, R, L), K(1, off(R, 0, 0.05, -0.1), off(L, 0, 0.05, -0.1), (30, 0, 5), (20, 0, 0), "snap"),
                            K(6, off(R, 0, 0.01, -0.02), off(L, 0, 0.01, -0.02), (5, 0, 0), None, "out"), K(24, R, L, (0, 0, 0), (0, 0, 0), "back")]}
    n = frames(1.3)
    C["fp_reload"] = {"keys": [K(0, R, L), K(4, off(R, 0.02, 0.02, -0.02), off(L, -0.04, -0.06, 0), (20, 0, 60), None, "snap"),
                               K(10, off(R, 0.03, -0.04, 0), None, (-30, 0, 70), None, "out"),
                               K(15, None, off(R, -0.07, -0.08, 0.02), None, (40, 0, -30), "io"), K(17, None, off(R, -0.05, -0.05, 0.02), None, None, "snap"),
                               K(22, None, L, None, (0, 0, 0), "out"), K(26, off(R, 0.02, 0.0, 0.0), None, (0, 0, 200), None, "out"),
                               K(32, R, None, (0, 0, 360), None, "out"), K(n, R, L, (0, 0, 360), (0, 0, 0), "back")]}
    C["fp_melee"] = quick_melee(R, L)
    C["fp_ability1"] = {"keys": [K(0, R, L), K(3, (0.06, -0.18, 0.2), (-0.02, -0.18, 0.22), (-40, 0, 40), (-30, 0, 0), "snap"),
                                 K(14, None, None, None, None, "hold"), K(20, R, L, (0, 0, 0), (0, 0, 0), "out")]}
    C["fp_ult"] = {"keys": [K(0, R, L), K(4, off(R, 0.02, -0.06, -0.03), (-0.1, 0.18, 0.4), None, (70, 0, 0), "snap"),
                            K(16, None, (-0.1, 0.22, 0.42), None, (80, 0, 10), "out"), K(26, R, L, (0, 0, 0), (0, 0, 0), "io")]}
    C["fp_inspect"] = {"keys": [K(0, R, L), K(8, (0.16, -0.08, 0.34), None, (0, 0, 60), None, "io"), K(14, None, None, (0, 0, 420), None, "out"),
                                K(22, None, None, (0, 0, 720), None, "out"), K(30, R, None, (0, 0, 720), None, "back")]}
    return C


def gorgoth(R, L):
    """GORGOTH - the abyss engine. Everything is heavy: the shotgun kick throws the whole arm back (17 frames between
    shots), the reload is a slow pump-and-slam with a mechanical hitch."""
    C = {}
    C["fp_idle"] = idle(R, L, amp=0.01, sway=0.004, secs=2.8)
    C["fp_fire"] = {"keys": [K(0, R, L), K(1, off(R, 0, 0.05, -0.1), off(L, 0, 0.05, -0.08), (25, 0, 0), (20, 0, 0), "snap"),
                             K(6, off(R, 0, 0.01, -0.02), off(L, 0, 0.01, -0.02), (4, 0, 0), None, "out"), K(17, R, L, (0, 0, 0), (0, 0, 0), "back")]}
    n = frames(2.0)
    C["fp_reload"] = {"keys": [K(0, R, L), K(10, off(R, 0.02, -0.08, 0), off(L, 0.02, -0.06, -0.08), (-20, 0, 30), None, "io"),
                               K(20, None, off(L, 0.02, -0.06, 0.04), None, None, "snap"), K(26, None, None, None, None, "hold"),
                               K(34, None, off(L, 0.02, -0.06, -0.08), None, None, "io"), K(44, None, off(L, 0.02, -0.06, 0.04), None, None, "snap"),
                               K(n, R, L, (0, 0, 0), (0, 0, 0), "back")]}
    C["fp_melee"] = quick_melee(R, L)
    return C


def build(hero, R, L):
    """hero -> {clip: {"loop": bool, "keys": [...]}}; every hero also gets hit / land / equip"""
    fam = {"raijin": raijin, "yuzu": yuzu, "kagemaru": kagemaru, "enra": enra, "haruto": haruto, "gorgoth": gorgoth}
    if hero in fam: C = fam[hero](R, L)
    elif hero in ("kaien", "mirei", "nocturne", "hex"): C = caster(R, L, hero)
    else: return {}
    C.setdefault("fp_hit", flinch(R, L))
    C.setdefault("fp_land", land(R, L))
    C.setdefault("fp_equip", equip(R, L, 1 if hero != "yuzu" else -1))
    return C
