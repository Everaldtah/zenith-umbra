# How Overwatch balances heroes (state of the live game, October 2026) -> what ZENITH//UMBRA takes from it

Read-only study for the balance pass in `docs/BALANCE_PATCH.md`. Numbers are from Blizzard's patch notes (the September 8
and 17, 2026 patches, the July 30, 2026 patch, the February 10, 2026 "Reign of Talon" patch), the Overwatch wikis
(weirdgloop / Fandom - reference only, CC BY-NC-SA) and the developer blog. Overwatch names and numbers are the
reference; nothing of theirs ships in the game.

## 1. The power budget is set per role, not per hero

Overwatch first decides what a *role* is for, then gives every hero in the role the same shared passive, and only then
tunes kits. The 2026 shape:

| role | job | health band | ultimate cost band | shared passive (2026) |
|---|---|---|---|---|
| Tank | take space, absorb the enemy team's output, start fights | 525-700 (incl. +150 in role queue) | 1700-2700 | ultimate generation from own damage/healing -40%; knockback and crit resistance moved into sub-roles |
| Damage | convert space into kills | 175-250 (most at 250; snipers 200; Tracer 175) | 1400-2800 | every hit applies a healing cut on the target (15% for 2 s since Jul 30, 2026; it was 30%) |
| Support | keep the team alive, enable plays | 225-250 | 2150-3100 | (removed Feb 2026) - the universal regeneration made everyone a bit of a support |

Universal rules that make the budget hold:
- **Health types.** Health, armor (-30% on every hit since Season 9; all stacked mitigation capped at 50% since Aug 2025),
  shields (regenerate), overhealth / temporary health (gives the attacker **half** ultimate charge).
- **Regeneration.** Every hero regenerates 20 HP/s once they have gone ~5 s without taking damage (the old support-only
  passive became universal in February 2026). Health packs: 75 / 250.
- **Headshots** x2 (Widowmaker 2.5). **Hitscan falloff** to 30% of damage at range; the falloff *start* is a knob the
  balance team turns (Mauga's both-gun falloff 15 -> 10 m, D.Mon 30 -> 20 m, both in September 2026).
- **Ultimate charge.** 1 point per point of damage or healing done, +5/s passive. Costs are multiples of 62.5. Since
  July 30, 2026 damage into / healing on a **tank** gives 40% less charge (it was 20%); tanks' own generation is -40%.
  The combination is what lets tanks have 650 HP without being ultimate batteries for the whole lobby.

## 2. Sub-roles (February 10, 2026): identity inside a role

| sub-role | passive (values after the Jul 30, 2026 adjustments) | OW heroes |
|---|---|---|
| Tank / Stalwart | knockback -40%, slows -40% | Reinhardt, Junker Queen, Sigma, Ramattra, Domina, D.Mon |
| Tank / Bruiser | critical damage taken -25%; +15% move speed below half health | Mauga, Orisa, Roadhog, Zarya |
| Tank / Initiator | 40 healing over 1 s after a movement ability (4 s cd) | D.Va, Doomfist, Winston, Wrecking Ball, Hazard |
| Damage / Flanker | health packs +50 | Genji, Reaper, Tracer, Venture, Vendetta, Anran |
| Damage / Sharpshooter | critical hits shorten movement-ability cooldowns | Hanzo, Widowmaker, Ashe, Cassidy, Sojourn |
| Damage / Recon | damaging an enemy below half health reveals them 3.5 s | Pharah, Echo, Sombra, Freja, Sierra |
| Damage / Specialist | eliminations: 1.5x reload speed for 3 s | Soldier, Bastion, Junkrat, Mei, Torbjorn, Symmetra |
| Support / Medic | healing with the weapon heals you 30% of it | Mercy, Kiriko, Moira, Lifeweaver |
| Support / Survivor | movement abilities start regeneration at once | Brigitte, Illari, Juno, Wuyang, Mizuki |
| Support / Tactician | bank excess ultimate charge (25% of the next ult) | Ana, Baptiste, Lucio, Zenyatta, Jetpack Cat |

## 3. What the balance team actually does, read from the September 2026 patch

The patch notes are a catalogue of the levers, and the developer comments say why each one was pulled:

- **Durability vs lethality on tanks.** Mauga: armor 150 -> 125, both-gun spread 4 -> 5 deg, both-gun falloff from 10 m
  ("high durability and damage output... lower both survivability and lethality"). D.Mon: armor 325 -> 275 in two steps,
  saber 65 -> 60. The lever is the *armor* number and the *range* at which the kit works, not the kit's identity.
- **Uptime of personal defence.** Zarya bubble cooldown 11 -> 12, Wrecking Ball's barrier 1.5 -> 1 s, Winston's barrier
  cooldown 12 -> 10 but duration 8 -> 7: they trade cooldown against duration to set *uptime*, and treat too much personal
  barrier as the problem.
- **Crowd control is scarce and short.** OW2 moved hard CC off damage heroes entirely; tanks keep it but short (Earthshatter
  is an *ultimate*; Mauga's Overrun stomp is a shove, not a stun). Kiriko's Suzu invulnerability 0.65 -> 0.5 s.
- **Make the ultimate match its impact.** Domina's cost -6% ("disruptive but not always consequential"), Genji's -6%
  (Aug 2026). Costs move in ~6% steps.
- **Consistency over raw damage.** Sierra: projectile 90 -> 120 m/s but damage 9 -> 8.5; Vendetta: shorter swing delays
  but longer recoveries; Torbjorn: tighter secondary spread. A kit that *lands* more is paid for with lower numbers.
- **Healers: output vs reliability at range.** Kiriko's ofuda 24 -> 18 m/s and seek range 35 -> 30 m ("highly effective
  as a healer while retaining utility"); Zenyatta's and Wuyang's line-of-sight timeouts 5 -> 3 s. Healing at a distance
  with no exposure is what gets nerfed; healing in the fight is left alone or buffed (Baptiste's lamp, Brigitte's armor).
- **Health -> armor shifts for brawlers.** Brigitte 200/50 -> 175/75: same total, more durable against spray.
- **Reference numbers** (for matching a kit's class): Reinhardt hammer 100 / 0.96 s at 5 m (~104 DPS), barrier 1400;
  Junker Queen 525 HP, Commanding Shout 150 self / 50 allies on 15 s, Carnage 90 + 40 wound, Rampage 40 + 90 wound and
  anti-heal, ultimate 2700; Mauga chaingun 4.5 x 15/s per gun, Cardiac Overdrive 30% damage reduction, Berserker
  overhealth cap 150; Hanzo 125 full draw (x2 head), Storm Arrows 75; Widowmaker 120 (x2.5); Genji Swift Strike 50 dmg
  8 s reset on kill, Deflect 2 s / 8 s, Dragonblade 110 a swing for ~6 s; Mercy 55 HPS; Lucio 20 HPS aura (12 self),
  Amp 56, Sound Barrier 750 decaying over 6 s at 2900; Ana nade 100% anti-heal 3 s on 12 s; Zarya bubble 200 on 12 s.

## 4. The deviations ZENITH//UMBRA keeps (and why)

- **Headshots stay 1.5x** (2x for a full-draw bow). Our hit capsules and bot aim are coarser than Overwatch's, and most
  of our weapons are spread or burst weapons; 2x across the board would make the shotguns one-shot.
- **Mech tanks are knockback-immune** outright (Tenkai-Oh, Gorgoth) - that was already their identity; the stalwart
  reduction applies to the human tanks.
- **Tank health stays at 650 / 525** with no separate "role queue" bonus: our lineups are always 1-2-2.
- **Hard CC stays on a few tank cooldowns** (Dawn Charge pin, Shiko Stomp knockdown, Marionette's root) but shorter, and
  the 16 m Solar Shatter is no longer an ultimate on a 12 s cooldown.

Sources: Blizzard patch notes (overwatch.blizzard.com/en-us/news/patch-notes), esportstales.com's 2026 change log,
overwatch.weirdgloop.org (Sub-Roles, Ultimate ability), overwatch.fandom.com (hero pages), Blizzard's "Tuning Hero
Balance for Launch" developer blog.
