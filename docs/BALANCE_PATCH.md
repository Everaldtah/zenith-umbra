# Balance patch - October 2026: the Overwatch framework applied to the roster

The study behind every number is `docs/research/ow_balance_study.md`. The rules live in `src/game/roles.ts`, the kits in
`src/data/heroes.ts` and `src/game/abilities.ts`. Verify with `npx vitest run` (the new `tests/unit/roles.test.ts` pins the
rules) and read the AI census with `BAL_OUT=docs/balance-census.json npx vitest run -c tests/tools/vitest.config.ts tests/tools/balance.test.ts`.

## General

**Role passives**
- Tank: ultimate charge from your own damage and healing -40%. Damage into a tank (and healing on one) gives the other
  player 40% less charge. Knockback and crit resistance moved to the sub-roles.
- Damage: everyone you hit receives 15% less healing for 2 s.
- Everyone: health regenerates at 20 HP/s once 5 s have passed without taking damage (health first, then armor).
  *Developer comment: a hero who disengages comes back without a healer having to babysit them, the way Overwatch
  made everyone regenerate in 2026; it also lets the support role be measured by what it adds in the fight.*

**Sub-roles** (each hero's is on the hero panel in the menu)
- Stalwart (Tenkai-Oh, Tomoe): knockback and slows 40% weaker. Bruiser (Gorgoth, Gantetsu): critical hits -25%, +15%
  speed below half health. Flanker (Raijin, Kagemaru, Enra, Hayate): health packs +50. Sharpshooter (Yuzu, Seiran):
  critical hits refund the movement ability (1 s per 100 damage). Medic (Mirei, Kaien, Nocturne): healing others heals
  you 30% of it. Tactician (Hex, Hibiki): ultimate charge past full is banked, up to 25% of the next ultimate.

**Health, armor and ultimates**
- Armor now takes 30% off every hit. *It used to take 5 off anything over 17 damage - a 125 arrow lost 5 to the plating
  - so armor blunted chip and did nothing against the big hits it exists for. Wounds still bleed straight through.*
- Armor and Taiko Heartbeat together never remove more than 50% of a hit.
- Temporary health (Wish Barrier, War Call, Bass Drop, Void Plating...) gives the attacker half ultimate charge.
- Ultimate costs were moved into the Overwatch bands: tanks 2000-2600, damage 2000-2400, supports 2200-2800.
  *Costs used to sit between 1700 and 2400 with supports lowest, so the biggest team-wide ultimates came up most often.*
- Damage and support heroes now all have 225-250 health; snipers stay at 200.

## Tanks

**Tenkai-Oh** - *The hammer tank was the deadliest hero in the AI census (K/D 9, 48 kills per 10 min) on the strength of
a 16 m stun on a 12 s cooldown and a 60 s giant form. Both are brought in line with what a tank cooldown and a
transformation ultimate are allowed to be.*
- Dawnbreaker Rocket Hammer damage 85 -> 90 (Reinhardt's 100 at a slightly faster swing).
- Dawn Charge cooldown 8 -> 7 s; wall pin damage 250 -> 225.
- Solar Shatter cooldown 12 -> 16 s; damage 90 -> 75; the 1.6 s stun is a 1 s knockdown.
- Dawn Colossus Awakening: 60 -> 15 s, +800 -> +600 armor; cost 2300 -> 2400.

**Gorgoth** - Void Plating cooldown 10 -> 12 s (personal barrier uptime, like Zarya's bubble).

**Gantetsu** - *Mauga's September 2026 changes, one for one: survivability and lethality at range down.*
- Armor 225 -> 200.
- Both chainguns at once: spread x1.4 -> x1.7, damage falloff starts at 10 m instead of 16.
- Shiko Stomp 150 / 75 -> 120 / 60, knockdown 1.0 / 0.8 -> 0.9 / 0.7 s.
- Taiko Heartbeat damage reduction 40% -> 30% (Cardiac Overdrive).
- Grand Dohyo cost 2200 -> 2400.

**Tomoe** - *Junker Queen's numbers were the reference and hers were above them in every slot.*
- Horagai War Call 200 / 100 -> 150 / 75 temporary health, cooldown 14 -> 15 s.
- Crescent Warpath: anti-heal 4.5 -> 3.5 s, the mark 10 -> 8 s and +25% -> +20% damage taken; cost 2200 -> 2600.

## Damage

**Raijin** - Flash Step cooldown 6 -> 7 s.

**Yuzu** - Dawnshot full draw 130 -> 125 (a full-draw headshot still kills 250). Hundred Suns Barrage 1900 -> 2000.

**Kagemaru** - Health 200 -> 225. Kunai 30 -> 28. Shadow Step cooldown 7 -> 6 s. Thousand Shadow Cuts 1800 -> 2100
(600 instant damage through five bodies while untouchable was the cheapest ultimate in the game).

**Enra** - Health 275 -> 250 (the brawler band). Chain Throw 85 -> 80. Oni Blood is now the universal regeneration
starting at 2.5 s instead of 5 (it was 12 HP/s after 3 s). Crimson Effigy 1900 -> 2000.

**Hayate** - Health 200 -> 225. Current Dash cooldown 7 -> 8 s. Dragon Gate Blade 15 -> 8 s (Dragonblade runs ~6),
cost 1800 -> 2000.

**Seiran** - Scatter Current 32 -> 25 a scale (five scales: 160 -> 125, so it no longer one-shots a 225 hero point
blank - the reason Overwatch removed Scatter Arrow). Riverstep cooldown 5 -> 4 s. Twin Koi Torrent 1900 -> 2000.

## Supports

**Mirei** - Health 200 -> 225. Star shots 3 -> 4 a second. Healing beam 62 -> 55/s (Mercy). Wish Barrier 300 -> 200.
Nova Requiem (web) 2000 -> 2200.

**Kaien** - Divine Seal Storm 2200 -> 2700 (15 s of a 300 shield, 28 DPS to everyone in 18 m and 22 HPS to the team
is Kitsune Rush territory). Prayer Beads 25% -> 30% (it is the Medic sub-role now).

**Hibiki** - *Lucio's current numbers.* Healing Groove 16 -> 20 HP/s (self 11 -> 12), Max Volume 52 -> 56 HP/s.
Bass Drop 2300 -> 2800 (Sound Barrier is 2900).

**Lady Nocturne** - Health 200 -> 225. Healing beam 56 -> 55. Silence Aria 1.5 -> 1 s silence, 3 -> 2.5 s grounding.
Requiem of the Crimson Moon 2000 -> 2300.

**Hex** - *A support with 135 DPS primary fire out-damaged the damage role.* Needles 15 -> 12 a needle (108 DPS).
Marionette Strings cooldown 10 -> 12 s. Grievous Hex 4 -> 3 s. Grand Puppet Theater 2100 -> 2500.

## AI census (bots, 150 s matches on every map; a smoke test for outliers, not a win rate)

| | before | after |
|---|---|---|
| tank kills / 10 min (role average) | 32.5 | 18.4 |
| damage kills / 10 min | 16.5 | 26.8 |
| support kills / 10 min | 4.3 | 10.7 |
| support healing / 10 min | 10.6k | 8.6k (regeneration and the healing cut take their share) |
| Tenkai-Oh K/D | 9.0 | 4.9 (still the bots' top killer: the AI brawls inside hammer reach) |
| Gantetsu K/D | 5.0 | 0.5 (2 games - the lineup alternates the second tank by map) |
| Hex damage / 10 min | 5.7k (and 15.5k healing) | 4.4k (and 11.4k healing) |
| median seconds between ultimates | 32-46 (tanks fastest) | 39-77 (tanks and supports slowest) |

The raw after-census is `docs/balance-census.json` (16 games, 2 per map). The roles now sit where Overwatch puts them:
the damage role makes the kills, the tanks soak and mitigate (Tenkai-Oh 24k mitigated per 10 min), the supports heal and
the big team ultimates come up less often than the duelling ones. Rerun the census after any kit change.
