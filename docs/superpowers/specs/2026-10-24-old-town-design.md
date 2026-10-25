# Old Town and the Lantern: design

Status: approved, aligned with the plan 2026-10-25 · 2026-10-24 · city generators in `concept-assets/city/generators/`

## Why

The centre of the ring city is the weakest part of the blockout. Six spoke avenues run all the way to a
hand-built stepped temple. A placeholder spire tops it, and two rows of identical setback towers circle
it on an island in a moat. It reads as a generic temple precinct, not the heart of this city.

In the lore, the centre is **Old Town**: the seat of power and the central business district. It holds
special-purpose buildings and exclusive housing, and it never sleeps; look in at any hour and it's as
busy as ever. Atlantis is a civic and scientific city, so its monument should be a working piece of
infrastructure treated as a landmark, not a temple. The city is also a patchwork of many cultures (see
the memory note on lore), and the older part of Old Town should show that.

## What gets built

### 1. Naming

- District `core` is renamed **Old Town** everywhere: plan, planner, generated object names where
  they show a name, and the README. The fixed neighbourhood name `{W} Heights` becomes plain
  "Old Town". It stays one neighbourhood.
- The ring id `island` and district id `core` can stay as internal ids (*builder's call*), but no
  user-facing label says "island", "Circular Manhattan", "Sable Heights" or "temple".

### 2. Spokes stop at the first ring avenue

- All six spoke avenues end at Old Town's first ring avenue (currently `r = 232`). Today they start at
  `spokes.r_inner = 140`. Nothing radial runs inside that avenue.
- The hero avenue ends the same way. Where it meets the ring avenue, it should look straight up a grid
  street to the Lantern (see 4).
- Skywalk spoke links, spoke trees and anything else tied to a spoke stop at the same radius.

### 3. Not an island

- The inner water (`inner_water`, r 460–530) stays as **the first ring canal** between Old Town and the
  college ring. It should read as a canal crossed by bridges, not a moat round an island.
- The island quay wall and the deck that slopes down to the water are removed. Old Town's streets and
  plots run to a canal edge like the city's other canals: a canal wall and a quay walk, with the same
  treatment the other ring canals get (*builder's call* on the exact profile).
- Spokes still bridge the canal as they do now.

### 4. Central grid (inside the first ring avenue)

- A tight orthogonal **Manhattan-style grid** fills the disc inside the first ring avenue, aligned so
  one grid street runs on the hero avenue's bearing straight to the centre. Street centrelines sit at
  whole multiples of the pitch (block + street) from the centre, and block centres sit halfway between.
- Blocks are about **40–50 m** with streets of about 10–12 m. Both are planner settings.
- At the centre, a **square** about 100 m across, with the Lantern standing in it. It's the grid's one
  big open space. Its edges snap outward to the nearest street lines, and any block inside it is removed.
- Fabric: dense business towers and exclusive housing, **~120–220 m**. Blocks cut by the ring avenue
  are trimmed to it, not dropped, so the grid fills right to the avenue. A trimmed fragment under
  300 m² becomes a plaza or podium-only lot instead of a tower lot.
- The grid's towers don't share one form. The grid has its own weighted **tower-form mix** in the Old
  Town settings. By default it spreads evenly over all six culture tower forms. Each block picks one by
  seed, and its roofs follow the pick.
- **Landmark buildings** sit on their own blocks through the grid and the outer band: **parliament,
  courts, exchange, embassies, guild halls**. They're lower and broader than the towers (*my call*:
  roughly 25–80 m, filling most of a block, with a forecourt or colonnade edge), so their shape sets
  them apart, not their height. Height is measured to the eave. A dome or cupola may rise at most
  20 m above that, and it stays under the Old Town height cap. The parliament stands on the far side of
  the square from the hero avenue, on the axis, closing the view straight down it (it takes the two
  blocks either side of the axis street there). The exchange takes the block
  beside the parliament, also on the square. Embassies and guild halls take the building styles of the
  cultures they represent (*my call*: picked from the existing culture styles in
  `neighbourhoods.types`). *My call*: 6 embassies and 6 guild halls by default, both planner settings.

### 5. Outer band: patchwork quarters (first ring avenue → first ring canal)

- The band from the first ring avenue out to the canal is split into **quarters** (*my call*: about
  12–18, set in the planner). Each quarter has its own small street grid **turned to its own angle**
  and with **its own block size** (about 30–46 m), as if it grew piece by piece and each was laid out
  by a different culture. No spoke-and-hub rhythm: streets don't follow the radial direction.
- Spokes run through the band and are the seams between quarters. Blocks are clipped clear of the spoke
  corridors and the canal edge.
- **The second ring avenue (r = 350) is removed** (*my call*: the user picked the patchwork mockup,
  which had no second avenue, and didn't ask to keep it). The quarters run unbroken from the first
  ring avenue to the canal. Make it a planner setting so it can come back.
- Buildings are **taller than today**: **~200–300 m**, the tallest band in the city, under the Lantern.
  Each quarter takes one culture style from `neighbourhoods.types` (*my call*: picked by seed, with
  optional per-culture weights and per-quarter overrides in the planner). The culture shows in three
  ways:
  - **Block size:** the culture's lot range is rescaled from the city-wide lot span (8–40 m today)
    into the quarter block range (30–46 m), so cultures with bigger lots get bigger blocks.
  - **Podiums:** the culture's setback and gap shape the podiums.
  - **Roofs:** the culture's roof mix is used on podium roofs and the lower setback terraces.
- The culture "Lantern district" keeps its name. The monument is "the Lantern"; nothing gets renamed to
  avoid the overlap.
- Some landmark buildings (embassies and guild halls especially) sit in this band too.

### 6. The Lantern

It replaces the hand-built temple (`05_TEMPLE`, `KIT_Temple*`) as the monument at the exact centre.
The user picked this form from four sketches ("B · The Lantern"):

- **The city's tallest structure**, clearly above everything else. *My call*: ~500 m above the
  square, a planner setting. The skyline must keep it on top, so the old `spire_top` / `spire_clearance` cap now caps
  Old Town against the Lantern.
- **Slightly tapered shaft**, broader at the base, about 50–70 m across at the bottom. The taper (top
  radius ÷ base radius) is a planner setting with a default of 0.82, allowed from 0.7 to 0.95. Anything
  much lower starts to read as a spire.
- **The heart:** a **tall glazed reactor chamber** running up the middle of the shaft (about 40–80 %
  of the height). The user's answer to the sightline problem is a taller heart, so the top of the
  chamber must clear the tallest Old Town roof by at least ~60 m (a planner setting). The generator
  enforces it by capping Old Town heights under the heart top, not just under the crown. That way the
  glow shows over the patchwork band from across the city and from the hero avenue. It glows cyan:
  use the existing cyan/emissive look (`MAT_AP_Cyan` or similar). It's the energy core and the
  recognisable symbol.
- **Compute:** stacked floors above and below the heart, shown as banded storeys with lit lines (gold
  accent lip bands in greybox).
- **Crown:** radiator fins and heat-exchange vanes at the top, plus a slender mast or needle.
- **Storage:** the archive is underground beneath the square. In greybox it's only a sunken entrance
  or light well in the square, if anything (*builder's call*).
- At street level it's open and public: a great hall or colonnade facing the square, not a sealed
  facility.

### 7. The scene (Blender)

- `build_city.py` removes the hand-built temple from the visible scene. *My call*: move `05_TEMPLE` to
  an excluded or hidden collection instead of deleting it, so it can be recovered. The temple's
  plant scatter (`KIT_PlantI_temple_*`) goes with it.
- The Lantern is generated (a new prim set from `citygen.js`), not hand-modelled, so the plan and the
  scene can't drift.
- A scene inspection found nothing else hand-built inside the first ring canal (r < 460) apart from
  the temple and its planting. The civic arc-park facades there are already hidden by the build. The
  inner-water mesh (`AP_inner_water`) stays as the canal's water, and `KIT_Terrace_island` stays as the
  college-side bank. The build checks this: after building, any visible non-generated object inside
  r < 460 other than the canal water and that bank is reported and hidden the same recoverable way.
- The terrain profile for the centre can stay as it is (68 m at the canal, rising to 84 m inside
  `plateau_r`), but the island quay wall goes. "Temple" labels on terrain fields become "Old Town
  centre" (*builder's call* on wording).
- Save as a new version, **v04**, when built.

### 8. The city planner

The planner (`plan_page/`, published artifact `M79gAHcjP4C3vu9BQ8dTHA`) has to show and edit all of this:

- The district tab reads **Old Town**. Its panel gets grouped fields for:
  - **Grid:** block size, street width, square size, tower-form mix.
  - **Quarters:** count, block size range, angle seed.
  - **Heights:** grid towers, band towers, landmarks.
  - **Lantern:** height, base width, taper, heart position and height.
  - **Second ring avenue:** on or off.
- Remove the temple-era fields that no longer mean anything ("Garden ring round the temple", "Temple
  plateau" label wording).
- The plan drawing shows the grid, the quarters, the landmark buildings (labelled or coloured as
  landmarks) and the Lantern. The section view shows the Lantern instead of the temple.
- The "Core" view button becomes "Old Town".
- No visible text in the planner, and no generator warning, uses any of the banned names from §1.
  Internal ids are fine.
- Rebuild with `assemble.py`, republish to the same URL, and update the plan in the shared store
  (doc `plan/current`) and `plan.json` together.

## Non-goals

- Nothing about the city floating or moving gets modelled now. That's lore context only.
- No changes outside Old Town and the first ring canal: the college ring, belt, outer ring, canals
  elsewhere and harbours stay as they are.
- No final art. This is greybox: prisms, solids and the existing material set.
- No interior detail for the Lantern or the landmarks.

## Anti-goals (would make it a failure even if it works)

- The centre still reads as an island in a moat.
- Spokes visibly running into the grid, or quarters lining up into radial streets.
- The Lantern looking like a temple, a spire or just another office tower, anything out-topping it, or
  its glowing heart hidden behind Old Town from across the city.
- Old Town towers that all look the same again.
- The planner and the scene disagreeing (everything must come from `citygen.js`).

## Constraints

- Single source: `citygen.js` generates both the planner drawing and the Blender build list.
- Seeded randomness (FNV-1a → mulberry32) so a plan always builds the same Old Town.
- Rerunning `build_city.py` stays safe and idempotent: a second run leaves the same objects with the
  same names.
- `.blend` files go through Git LFS. The user asked (during alignment) for a local commit on
  `wip-city` after each plan task. Never push.

## Left to the builder

- Internal ids, prim layout and how the grid and quarter generators are structured in code.
- Exact quarter boundaries (angles, irregular edges), street widths, and how quarters meet at seams.
- Landmark massing details and where each one goes beyond "parliament and exchange face the square".
- Skywalks in Old Town. *My call*: keep a spine along the first ring avenue and the spoke links out to
  it; drop the loop on the removed second avenue; no skywalks inside the central grid unless they fall
  out naturally.
- Trees and planting in Old Town (street trees on the grid and a planted square are fine).
