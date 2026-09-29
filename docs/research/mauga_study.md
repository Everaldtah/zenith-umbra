# Mauga study -> Gantetsu (task #15)

Study by evera-b6 for system32-82, who implements. Numbers are current Overwatch 2 values from the Overwatch wiki's page
source (fetched through `overwatch.fandom.com/api.php?action=parse&page=Mauga&prop=wikitext`, which works where the page
itself is blocked). First-person behaviour is measured from footage; frames live in the git-ignored `work/ref/`.
Screen positions are fractions of the 16:9 frame, (0, 0) = top-left.

## 1. Kit numbers (current OW2, 5v5)
Health 425 + 125 armour (6v6: 450 + 100).

### Chainguns: Gunny (incendiary, primary) and Cha-Cha (volatile, secondary)
| | value |
|---|---|
| type | hitscan, headshots allowed |
| damage | 4 per shot, falling to 1.2 |
| falloff | 30-40 m firing one gun; 10-20 m firing both |
| fire rate | 17.36 shots/s per gun (one every 0.0576 s) |
| ammo / reload | 300, shared by both guns; 2 s reload |
| windup | 0.16 s per gun before the first shot |
| spread | 1 deg base -> 1.5 deg max, reached over 30 shots; firing both jumps straight to 4-5 deg |
| move penalty | -15% per gun firing (4.675 m/s with one; they stack with both) |
| Gunny ignite | 10 hits on a target ignite it; the count resets after 2 s without a hit, and on ignition |
| burn | 15 dps (2.88 every 0.192 s) for 4 s; igniting again refreshes it; barriers can't burn |
| Cha-Cha | every hit on a burning target is a critical hit (2x), whoever set it burning |
| dps | 69.4 one gun; 84.4 Gunny with burn; 138.9 both on a non-burning target; 208.3 both on a burning one; 223.3 with burn |

### Overrun (ability 1)
| | value |
|---|---|
| cooldown | 6 s, starting when the ability ends |
| startup | 0.21 s before he moves (he can still be stunned in this window) |
| charge | 0.32 s minimum, 2 s maximum (8 footsteps), 4.4-28 m |
| speed | +165% = 14.57 m/s, for the charge and the stomp |
| steering | turns with the movement keys while charging |
| while charging | unstoppable, takes 50% less damage, can't shoot or use abilities (except Cardiac Overdrive) |
| collision | 30 damage + knockback 18 m/s (17 horizontal, 6 up), once per enemy per use; not blocked by barriers |
| ending it | primary fire or jump = stomp now; the ability key again = stop with no stomp; at 2 s he leaps by himself |
| stomp | a real jump, 0.6 s; shockwave 7 m radius, 3 m tall, travels at 30 m/s, climbs and drops 2 m steps; blocked by barriers |
| stomp, inner 2 m | 150 damage + knocked down for 1 s |
| stomp, outer to 7 m | 75 damage + knockback 8.6 m/s (5 horizontal, 7 up) |
| walls | he doesn't stop at a wall; he keeps running in place |
| two Maugas colliding | both knocked down 1.7 s |

### Cardiac Overdrive (ability 2)
Cooldown 12 s (from when it ends), no cast time, lasts 3 s, radius 10.5 m with line of sight (enemy barriers don't
block it). Mauga: 40% less damage taken and heals for 100% of the damage he deals. Allies in range: heal for 50% of the
damage they deal; they keep the effect ~1.2 s after leaving the radius, and allies who enter later get it too.

### Cage Fight (ultimate)
| | value |
|---|---|
| cost | 2700 points |
| duration | 8 s (pressing the key again ends it early) |
| shape | a cylinder: radius 7.2 m, 6.3 m tall, reaching 3 m below and 9 m above the device |
| barrier | 1200 HP; destroying it ends the ultimate and frees everyone; killing Mauga doesn't |
| the device | an invulnerable object with gravity at the centre; it rides moving platforms |
| who is bound | Mauga and every enemy inside, each leashed to the device by a chain; enemies who walk in later are bound too |
| what binding does | can't leave the cylinder (or rise past ~9 m from the device); movement abilities are cancelled and disabled; flyers fall; they can still walk and fight inside |
| line of sight | needed to attach a chain; once attached it holds through walls |
| barrier rules | allies walk through and shoot through it; it blocks enemy fire from outside |
| ammo | chainguns reload in full when it starts, and the counter shows unlimited ammo for the duration |
| interrupt | crowd control during the throw wastes it |

### Berserker (passive)
Dealing critical damage gives temporary health: 50% of the critical damage dealt, up to 150, lasting 2 s.

## 2. First-person behaviour (measured)
Source: "Mauga All Abilities Showcase" (practice range, 1080p60, recorded at his launch), https://www.youtube.com/watch?v=njJiaRAmqnw.
Launch-era values differ from today's in places (its cage countdown shows 10 s; the duration is now 8 s), so take
numbers from section 1 and looks from here.

### The guns at rest
Two chainguns held at the hips, one in each bottom corner, both angled in toward the reticle.
- Left gun: barrel cluster at about (0.10-0.30, 0.78-0.95). Right gun: (0.62-0.95, 0.75-0.95).
- The orange arm braces run off the bottom corners; the rear of each gun is out of frame.
- Together they fill the bottom ~25% of the screen and leave the centre clear.
Gantetsu's current layout (FP_STYLE 'dual', grips at [±0.36, -0.36, 0.56]) already matches this.

### Firing
| phase | timing | what happens |
|---|---|---|
| windup | ~100-130 ms visible (0.16 s in the data) | the firing gun lifts ~0.08 of screen height and swings ~0.05 toward the centre; barrels start to spin; no shots yet |
| firing | continuous | muzzle at about (0.72, 0.68) for the right gun (mirror for the left); a star-shaped flash ~0.10 of screen width on every shot; yellow tracers to the reticle; a constant small shake of the gun, no climbing recoil and no camera kick |
| one gun vs both | - | the gun that isn't firing stays low at the hip; firing both raises both |
| stop | last shot -> rest in ~250-350 ms | the gun stays up ~100 ms, then lowers to the hip |
The barrel spin itself isn't readable at this resolution. Suggested: spin up to full speed over the 0.16 s windup, and
coast down over ~0.5 s after the last shot (an estimate, not measured).
Which hand holds which gun couldn't be confirmed from the footage; the usual mapping is primary fire = left gun,
secondary fire = right gun.

### Overrun: the camera goes to third person
The view cuts to a chase camera behind and above him when the charge starts, and returns to first person after the
stomp. In the clip the whole thing (a short charge cancelled into the stomp) lasts ~1.9 s.
| phase | what the player sees |
|---|---|
| charge | Mauga from behind, glowing orange, filling about (0.38-0.58, 0.55-1.0) of the screen; the world streams past |
| leap | he rises; the camera follows |
| landing | a fan of red-orange cracks and sparks bursts forward from his feet along the ground, reaching most of the screen width in ~130 ms; the camera dips and pushes in on impact, then eases back over ~0.6 s; enemies are thrown up |
| after | back to first person with the guns at the hips |

### Cage Fight from inside
| phase | timing | what the player sees |
|---|---|---|
| throw | ~200 ms | his left hand slams the cage device down; it fills the left of the screen, about (0.0-0.35, 0.1-0.8) |
| deploy | ~270 ms | guns lowered, the device on the ground at his feet |
| bind | ~0.53 s after the throw starts | a white flash; a violet pillar of light rises from the device; chains shoot from the device (bottom centre, about (0.5, 0.95)) to every enemy; "TRAPPED" appears in red at about (0.5, 0.2) |
| held | the duration | the floor inside is a blue hexagon-patterned disc; the chains are metal links with a pale glow, slack and swaying; each bound enemy carries a countdown ring with the seconds left; the ammo counter shows the infinity sign |

## 3. The user's twists, and what to keep
| Mauga | Gantetsu (user's request) | suggestion |
|---|---|---|
| stomp inner 2 m knocks down for 1 s, outer 7 m knocks back and up | the slam knocks everyone DOWN, stunned on the ground, not launched | knock down the whole 7 m radius: 1 s in the inner 2 m, 0.6 s in the outer ring; no knockback, no lift; keep 150 / 75 damage |
| a barrier cylinder plus chains | a holographic CHAIN that binds everyone inside | keep the binding rules (can't leave, movement abilities off, flyers fall, late arrivals bound); draw the chains and the ring as holograms; decide whether the barrier (blocking fire from outside) stays, since the request only mentions the chain |
| third-person camera for Overrun | - | our game has a third-person camera already (Stadium mode); use it for the charge and return to first person after the slam |
| unlimited ammo in the cage | - | keep: full reload on cast, no ammo use for 8 s |

## Sources
- Overwatch wiki, Mauga (page source via the MediaWiki API): https://overwatch.fandom.com/wiki/Mauga
- Mauga All Abilities Showcase (SKLLZ): https://www.youtube.com/watch?v=njJiaRAmqnw
- Mauga gameplay, no commentary (DragonTamago): https://www.youtube.com/watch?v=1tIbIZ2wFIc (downloaded for reference; not used for measurements)
