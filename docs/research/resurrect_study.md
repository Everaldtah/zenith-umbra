# Mercy's Resurrect (Overwatch 1 ultimate, Overwatch 2 ability) -> Mirei's Stellar Rebirth

Study by evera-b6, who also implemented the game logic (`src/game/rebirth.ts`); the poses, the souls and the rising
figures are evera-c1's. Numbers are from the Overwatch wiki's page source (`overwatch.fandom.com/api.php?action=parse&page=Mercy&prop=wikitext`,
current values plus the patch history that records the launch-era ultimate). Timing and looks are counted frame by frame
from footage; the frames live in the git-ignored `work/ref/` (`mres_*.jpg`).

## 1. The numbers
### Overwatch 1: Resurrect, the ultimate (2016-05 to 2017-09)
| | value |
|---|---|
| shape | every dead ally within 15 m of Mercy (2017-09 patch: "radius reduced to 5 meters" when it became an ability) |
| cast | instant (from 2016-07 she could keep moving while casting) |
| walls | not needed: souls in range came back through walls |
| the revived | full health where they died; could not move for 3 s at launch, 2.25 s from 2016-09 |
| Mercy | invulnerable while resurrecting, with the allies (2017-02) |
| charge | raised 30% in 2016-07 (about 1950 points after) |
| souls | a dead ally leaves a glowing yellow orb at the spot of death until they respawn |

### Overwatch 2: Resurrect, the ability (since 2017-09)
| | value |
|---|---|
| target | one soul, within 5.5 m |
| cast | 1.75 s channel, Mercy slowed 75% (1.375 m/s); interrupted by stun / knockdown / hack, or by moving more than 7 m from the soul |
| cooldown | 30 s (not reset by respawning) |
| line of sight | needed to start, not to finish |
| the revived | full health at the spot of death; invulnerable for 2.25 s, can't shoot or use abilities until that ends, can move after 1.5 s |
| Mercy | 100 overhealth after the cast (even if interrupted) |
| ult charge | none for the resurrect itself |

## 2. What the footage shows
### The launch-era mass resurrect, first person (`mres_c2.jpg`, 30 fps; "Mercy - Resurrect", 4 s, and a 5-man POTG)
| t (s from the cast) | what the player sees |
|---|---|
| before | each dead ally is a soft yellow orb on the floor with a faint pillar of light above it |
| 0.00 | the staff drops out of view; her right hand comes up into the frame, palm open, fingers spread |
| 0.03-0.30 | a thin beam of light rises from every soul; golden wing-shaped shards (chevrons) start floating up across the whole view |
| 0.30-0.75 | the hand pushes upward and opens further; the shards keep rising, more of them, the screen washes gold |
| 0.75-1.00 | a bright bloom at every soul with an expanding ring; the hand is at the top of the frame |
| 1.00-1.20 | the blooms fade; the hand drops out of view; the staff comes back |
| 1.2-2.4 | each revived ally stands as a golden translucent figure (invulnerable) - they rise from a crouch to standing in the first ~0.4 s |
| 2.4-2.6 | a ring bursts from each figure and they turn solid: the invulnerability is over (2.25 s after they stood) |

### The launch-era pose, third person (`mres_b2.jpg`, 15 fps; the "Heroes never die" highlight intro)
| t (s) | body |
|---|---|
| 0.0-0.4 | standing, staff in the right hand, looking at the camera |
| 0.4-0.8 | the LEFT hand reaches out and down, palm up, toward the souls; golden light gathers around it |
| 0.8-1.2 | the left arm sweeps up over her head; the staff hand rises too; the head tilts back |
| 1.25-1.45 | the wings flash white and spread to full span |
| 1.5 on | held: both arms raised in a V, wings spread and lit, chin up |

### The post-rework single resurrect (`mres_f2.jpg`, 20 fps; a 2018 POTG, cast inside Valkyrie so it is instant)
| t (s from the cast) | what the player sees |
|---|---|
| 0.00-0.25 | the staff lowers; the right hand extends forward toward the soul, palm out |
| 0.25-0.65 | golden shards stream from the hand to the soul |
| 0.65-0.95 | two expanding rings around the soul, a golden orb at its centre |
| 0.95-1.30 | a pillar of light at the soul, the screen blooms |
| 1.30-2.10 | the ally stands as a golden translucent figure |
| 2.10-2.25 | they turn solid; the staff comes back up |
Outside Valkyrie the same sequence plays over the 1.75 s channel (the hand stays out for the whole channel).

## 3. What Mirei does (`src/game/rebirth.ts`)
| Mercy | Stellar Rebirth (the user's ask: resurrect all dead teammates in her perimeter who died within 10 s) |
|---|---|
| OW1: every dead ally within 15 m, through walls, instant | the same: `REBIRTH_R` 15 m, no line of sight, instant on the press |
| the soul lasts until respawn (OW: 10 s) | `REBIRTH_WINDOW` 10 s from the death; the soul is gone once the ally respawns (6 s in a match, 8 s in the campaign, so those are the effective windows unless the respawn wait is raised) |
| full health where they died | `World.respawn()` then the body's spot: full health, armour, ammo; statuses and wounds cleared; facing her |
| invulnerable 2.25 s, no moving 1.5 s, no fighting until 2.25 s | statuses `reborn` 2.25 s (`World.damage` returns 0, the stun gate blocks weapons and abilities) and `rising` 1.5 s (rooted); HUD shows REBORN |
| Mercy invulnerable during the res | `spawnprot` 1.5 s on her |
| a yellow orb at the spot of death | `soulLingers(w, x)` says which dead bodies should show a soul (a living Mirei on the team, inside the window) - for the renderer |
| ult charge ~1950 | 2400 (her Nova was 2000; this wins fights outright) |
The web build keeps Nova Requiem (`FULL` gate in `heroes.ts`). Bots sing with two souls in reach and time left on their
respawn, or one if she is the last one standing. Tests: `tests/unit/mirei_rebirth.test.ts`.

## Sources
- Overwatch wiki, Mercy (page source via the MediaWiki API): https://overwatch.fandom.com/wiki/Mercy
- Mercy - Resurrect (launch-era mass res, first person): https://www.youtube.com/watch?v=3yUWUf6K7w0
- Overwatch Mercy POTG 5 Player Rez: https://www.youtube.com/watch?v=DeBVkcAzFjk
- 5 Man Revive (first person): https://www.youtube.com/watch?v=1hAGpNp6Y7s
- Reminiscing Mercy Mass Resurrection: https://www.youtube.com/watch?v=33H3gjwAj-s
- Overwatch - Mercy - POTG (2018, post-rework): https://www.youtube.com/watch?v=dNvGPVHahis
