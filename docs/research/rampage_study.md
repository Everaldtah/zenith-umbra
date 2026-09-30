# Junker Queen's Rampage -> Tomoe's Crescent Warpath (task #19)

Study by evera-b6, who also implemented the game logic; the poses and the mark's glow are evera-c1's. Numbers are current
Overwatch 2 values from the Overwatch wiki's page source (`overwatch.fandom.com/api.php?action=parse&page=Junker_Queen&prop=wikitext`).
Timing and looks are counted frame by frame from footage; the frames live in the git-ignored `work/ref/`
(`jq_r1.jpg` 20 fps overview, `jq_r2.jpg` 30 fps, `jq_r5.jpg` 60 fps crops of the wheel, `jq_r3.jpg` / `jq_r6.jpg` the marked bots).

## 1. Rampage: the numbers (current OW2)
| | value |
|---|---|
| cost | 2700 points |
| cast | 0.496 s wind-up before she moves |
| dash | 0.7 s at +500% speed = 33 m/s, 25 m range; not subject to the speed cap |
| shape | 5 m radius around her, along the whole dash; walls and enemy barriers block it (line of sight) |
| impact | 40 damage, once per enemy |
| wound | 90 over 4.5 s (3.84 every 0.043 s) |
| anti-heal | healing received -100% for 4.5 s |
| self | Adrenaline Rush heals her 250% of wound damage: 225 over 4.5 s from a full wound |
| keywords | area of effect, channel, evasive, movement, reloads, wound |
| interrupt | crowd control during the wind-up wastes it; during the dash she is unstoppable |

## 2. What the footage shows (60 fps)
Source: "Junker Queen Abilities - Visuals & Sounds" (1080p60), Rampage at 49.6-51.7 s; a second cast at 52.6-54.2 s into
two training bots, then their marks to 56 s.

| t (s from the cast) | what happens |
|---|---|
| 0.00 | ult flash; her scattergun drops out of view |
| 0.30 | the camera has cut to third person, behind and above her |
| 0.30-0.75 | wind-up: she raises her right arm overhead; the axe and knife lift out of her hands |
| 0.75-1.00 | the blades start to circle her, in a wheel tilted ~60 deg across her back |
| 1.02 | the dash begins; the wheel levels to near-horizontal within ~0.15 s |
| 1.02-1.68 | the dash: 0.67 s, she runs upright the whole way (never leaves the ground) |
| 1.70 | the blades are back in her hands; the wheel is gone |
| 2.00 | first person again, the gun back up |

The wheel of blades, from the 60 fps crops (`jq_r5.jpg`):
- her BODY DOES NOT SPIN: the raised hand is the hub and the weapons orbit it
- radius about 1.3-1.5 m, at head / shoulder height; hafts point in at the hub, heads out
- the axe and the knife are roughly opposite each other, with one or two ghost copies between; neither leads
- anticlockwise seen from above (her left side moves backward, right side forward) - moderate confidence, from six
  consecutive frames; motion blur hides the rest
- 30-40 deg per frame = 5-6 turns a second, about 3.5-4 turns over the dash
- each blade drags a white-violet blur arc of 120-180 deg, in 2-3 concentric rings

The marked enemies (`jq_r6.jpg`): a soft violet halo BEHIND the body (a glow, not a rim), white blade streaks stabbing
through the torso, sparks, the halo pulsing about every 0.35 s, for the length of the wound.

## 3. The user's twists, and what Tomoe does
| Rampage | Crescent Warpath (the user's request) | implemented |
|---|---|---|
| a 25 m ground dash | travel IN THE AIR, land on the other side, about 20 m | a 1.0 s flight in one arc (`TIDE_LEN` 20 m at 20 m/s, `TIDE_APEX` 3 m), driven by `a.forced` with its own vertical velocity; she lands where the arc ends or drops where it is cut short |
| bodies stop her | warp through enemies like a ghost | body separation skips her for the whole flight; the lane is 2.5 m to each side of her line (`TIDE_HALF`), reaching down to the floor she took off from; walls block it (line of sight) |
| she runs, the weapons orbit | a spin animation, axe and knife spinning as she goes through | evera-c1: whole-body spin about her axis plus the weapons wheeling (numbers above); first person: the axe and Fang sweep in mirrored circles, no camera spin |
| wound + anti-heal | ... plus a BLUE glow that weakens them for ~10 s: more damage from anyone | status `tidemark` 10 s (`TIDE_MARK`): x1.25 damage taken from every source (`TIDE_MARK_AMP`, in `World.damage`, doesn't stack on Hex's `vuln`); cleansable; `TIDE_MARK_COLOR` #4aa8ff; the HUD shows CRESCENT MARK +25% |
| no early stop | click to stop, to avoid leaving the map | a click (fire or alt) after 0.15 s (`TIDE_HOLD`) ends the flight where she is; holding fire from before the cast doesn't count |
| - | - | the reach is pulled in to the last spot inside the arena with footing under it (`tideReach`), so a bot or a player facing the edge never flies out; a wall or a Grand Dohyo rope ends it |
| 40 + wound 90 + anti-heal 4.5 s | keep | `TIDE_CUT` 40, `TIDE_WOUND` 90, `TIDE_ANTIHEAL` 4.5 s, once per enemy; Reaping and the Fang reset on landing as before |

Bots cast it from 3-16 m at a crowd, a wounded target, or a lone target with two allies within 14 m to use the mark.
Tests: `tests/unit/tomoe_ult.test.ts` (the arc, the ghost pass, the mark and its multiplier, the click, the arena edge).

## Sources
- Overwatch wiki, Junker Queen (page source via the MediaWiki API): https://overwatch.fandom.com/wiki/Junker_Queen
- Junker Queen Abilities - Visuals & Sounds: https://www.youtube.com/watch?v=BQwNyYmuQZU
- Junker Queen Rampage (beta), third person: https://www.youtube.com/watch?v=iddS4MZAgkw
- Junker Queen play of the game: https://www.youtube.com/watch?v=ihLmgvfix_g (first person only; not used for measurements)
