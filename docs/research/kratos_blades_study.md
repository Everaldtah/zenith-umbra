# Kratos' chain blades (Blades of Chaos) -> Enra's Hellfire Chains

Study by evera-b6 for evera-14 (sim: Hellfire Chains / Chain Throw, f1e0259 in zu-qa) and evera-c1 (rigging and
animation). Frames counted from "Blades of Chaos - Beginner Combo Tutorial | GoWR" (1080p60) and the "Old Kratos VS
Young Kratos Blades of Chaos Move set" comparison (Ragnarok vs God of War III); the frames live in the git-ignored
`work/ref/` (`kb_light2.jpg`, `kb_heavy2.jpg`, `kb_grapple2.jpg` at 15 fps, `kb_a.jpg`, `kb_b.jpg` overviews).
Kratos is about 1.9 m tall in Ragnarok, which sets the reach scale; Enra is 2.05 m.

## 1. The weapon
Two short, broad, forward-curved blades (each about 0.75 m from pommel to tip, the blade 0.5 m of that, widening to a
hooked point), each on a chain of heavy links that runs from the pommel up the forearm and is bolted into the wrist
bracer; a length of chain (about 1.2 m coiled) hangs from each wrist at rest. The blades glow along the edge and vent
embers when swung; the chains trail behind every swing and go taut on a throw.
- rest: the blades hang blade-down beside the thighs, the chains slack in loops; when idle he twirls them in small circles
- the whole strike length is hand + chain + blade: 1.9 m arm reach extends to 4.5-5.5 m on a full light arc, 6-7 m on a throw

## 2. Light attacks (`kb_light2.jpg`, 29.5-33.5 s; each row 0.4 s)
| swing | t | what happens |
|---|---|---|
| 1 | 0.00-0.20 | the right blade thrusts forward, short and low (the first hit of the string is a stab, not an arc) |
| 1 | 0.20-0.45 | the LEFT blade whips out on its chain to the upper right, the chain fully extended (~2.5 body heights = ~5 m) |
| 1 | 0.45-0.75 | it is yanked back; the right arm crosses the body |
| 2 | 0.75-1.10 | a full horizontal arc right-to-left: the blade trail spans the whole frame width (~180 deg around him), arms crossing at the end |
| - | 1.10-1.55 | recover: both blades back at the hips, elbows bent |
| 3 | 1.55-1.90 | the right blade whipped out to the right and behind |
| 3 | 1.90-2.35 | a wide overhead-to-horizontal arc from the left, chain fully extended, the trail crossing the frame; the enemy is launched |
| 3 | 2.35-2.75 | the arc continues round behind him (the "cyclone" tail), then recover, arms crossing low |
| 4 | 2.75-3.20 | the next strike: a thrust to the left, then a short arc |
Measured: one light swing = 0.55-0.7 s (about 1.6 a second); the trails sweep 170-200 deg around him, hitting everything
inside; reach on the big arcs ~5 m; the hands alternate (right stab, left whip, right arc, left arc). The trail is the
blade's path: a flat ribbon of ember-orange, brightest at the blade, fading over ~0.3 s.

## 3. Heavy attack (`kb_heavy2.jpg`, 34.2-38.2 s)
| t | what happens |
|---|---|
| 0.0-0.5 | wind-up: the right blade drawn back behind the shoulder, the chain coiled, weight on the back foot |
| 0.5-1.0 | the blade whipped up and over the shoulder in a long overhead arc |
| 1.0-1.6 | a low-to-high sweep that catches the enemy and lifts them off the ground |
| 1.6-2.4 | a huge horizontal arc (the trail fills the frame) that launches the enemy away |
| 2.4-3.2 | the blade thrown out and held: it plants in the enemy at ~4 m, a fireball at the point, chain taut (the Hyperion follow-up) |
A heavy is ~1.5 s from wind-up to the end of the launch arc; ~0.5 s of it is telegraph.

## 4. The throw and grapple (`kb_grapple2.jpg`, 62.4-65.6 s)
| t | what happens |
|---|---|
| 0.00-0.25 | the right blade thrown over the shoulder straight at the enemy, ~6-7 m; the chain pays out in a straight line |
| 0.25-0.40 | the blade plants; the chain snaps taut |
| 0.40 on | held: he leans back on the chain (the tutorial holds here); on release he either yanks the enemy in or pulls himself to them |
The chain in flight is a straight taut line from the wrist; the blade spins once on the way out.

## 5. Ragnarok vs God of War III (`kb_a.jpg`)
Same weapon, same alternating hands and full-body arcs. GoW III's swings are faster and larger (the camera is farther,
the arcs read as full circles: "Cyclone of Chaos" spins him in place with both blades out at full chain, ~2 turns in
1.2 s), Ragnarok's are heavier with more wind-up and the chains drawn as real links. For Enra take Ragnarok's weight
and GoW III's reach.

## 6. Enra's version: what the sim has and what the animation needs
evera-14's numbers (f1e0259) match the footage and stand:
- PRIMARY Hellfire Chains: melee 55, 1.6 a second, 5 m, sweep (alternating sides, ~170 deg arc, everyone in it knocked along the swing), 0.12 s delay before the arc lands (the frames say the light arcs land ~0.15 s after the swing starts) - keep.
- SECONDARY Chain Throw: melee 85, 0.55 a second, 7.5 m, a 70 deg cone straight out - the blade thrown and yanked back; the frames say the blade reaches 6-7 m in 0.25 s and the return takes ~0.3 s, so a 0.55 s total fits a 1.8 s cycle with recovery.
- Chain of Oblivion (SHIFT, 18 m hook) is the grapple; Eclipse Brand unchanged; the Crimson Effigy swings the same blades, giant.

Animation (evera-c1), third person: a.anim.attackAt / attackSide from the sweep branch; alternate the hands; a light
swing = 0.15 s wind-up, 0.25 s arc (the chain extended to full length, the blade leading, the trail ribbon behind it),
0.2 s recover with the arms crossing; every second light swing is the big horizontal arc that goes round behind him;
the chain is a run of links from wrist to pommel that trails the blade with a one-frame lag and goes slack on recover.
Chain Throw: the blade over the shoulder, chain a straight taut line, the blade spinning once, 0.25 s out / 0.3 s back.
Idle: blades hanging blade-down at the thighs, small twirls. First person: both bracers in the bottom corners with the
chains hanging into the frame, the light arc sweeping the blade across the whole width of the view, the throw going
out from the right bracer to the reticle and back.

Enra's flair on the prop (prop_enra_blade): an oni-fang cleaver - the same forward-curved hooked profile as Kratos'
blades, but the edge is a row of jagged fangs, the guard is an oni mask with two short horns, the spine and fuller glow
crimson-orange like cooling iron, and the chain links are black iron with every fourth link an ember-red glowing link.
