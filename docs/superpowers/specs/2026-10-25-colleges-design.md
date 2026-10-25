# The three colleges: design

Status: approved · 2026-10-25 · city generators in `concept-assets/city/generators/`

## Why

The college ring (district `park`, "Colleges & orchards") holds three colleges, one per pair of spoke
sectors. Today they are generated identically: the same "Scholars' quarter" style, the same building
forms and the same grey stone. From the air they read as one grey campus. That's the failure the user
named: **"if they all end up looking like the same grey campus"**.

Each college has a discipline, and its buildings, colours, ground and one landmark should say which
college you're in before you read a label.

## The colleges

The occupation layout stays as it is: groves toward Old Town, colleges in the middle band, orchards
toward canal 2, and the current mix of uses in each cell (college, commercial, residential and so on).
What changes is how each college's sector looks.

| Group | Sector | Name | Discipline |
|---|---|---|---|
| `park-0` | bearing −90° to 30° (hero side) | **Alder College** | physics |
| `park-1` | 30° to 150° | **Indigo College** (was Rosemary) | creative arts |
| `park-2` | 150° to 270° | **Saffron College** | earth sciences: farming, environment |

Names are pinned (`neighbourhoods.renames`), so a reseed can't change them. Indigo is the user's pick
from my suggestions (a dye plant, keeping the botanical naming).

### Alder College: physics

- **Landmark:** a big domed observatory. The user asked for it by name.
- **Lab halls:** long, large-span halls are the typical college building.
- **Feel** (*my call*; the user said Alder and Saffron "have their own feel" and accepted this
  playback): ordered and institutional. Pale cut stone, glass, and a copper or verdigris dome.
- **Room to grow:** Alder may take land from its own grove and orchard bands (the user allowed this).
  *My call*: the observatory sits in the grove band, on the side toward Old Town, with a clear lawn
  round it so the dome reads from the air.

### Saffron College: earth sciences

- **Signature:** eco buildings at a grand scale with a "tree-house" feel (user's words: "very tree housy
  but on a grand scale").
- *My call* on the form:
  - buildings raised on thick trunk-like columns, with tiered decks;
  - green roofs and timber;
  - terraces stepping up through the orchard canopy;
  - canopy walkways linking neighbouring buildings.
- **Low-rise and forest** (user feedback after the first build: the tall tree-houses and timber towers read as
  "wooden skyscrapers"): every Saffron building is at most 3 storeys, a tree-house's raised undercroft
  counting as one. All of Saffron's land apart from the orchard is buildings or forest, with no plots (user:
  "the buildings should be sprinkled over the forest and building ring without plots"): its grove and college
  bands are one wood, its Voronoi cells aren't built, and buildings stand scattered through the trees, joined
  by ground-level boardwalk trails. This replaces the tiered decks and canopy walkways above.
- **Orchards:** Saffron keeps its orchards whole. They are its farmland and part of its identity. It
  does not grow into the bands.

### Indigo College: creative arts

- **Look:** very European. This applies to Indigo only. *My call*: pitched roofs, narrow fronts,
  colourful plastered facades and an old-town streetscape.
- **Performing arts, theme-park style:** a varied, whimsical cluster of venues. *My call*: an opera
  house or theatre, an open-air amphitheatre, a big-top tent and smaller playhouses, each a different
  form and colour.
- **Making:** print works with an industrial feel for posters, books and printing. *My call*:
  sawtooth-roofed brick sheds with chimneys.
- **Supplies:**
  - a **pine arcology**: a tall structure that grows pines for the college's paper;
  - **herb gardens for dyes**: colourful striped beds.
- **Room to grow:** Indigo may take land from its grove and orchard bands (the user allowed this).
  *My call*: the arcology and the dye gardens go in the orchard band, and the performing-arts venues in
  or beside the college band.

## How it gets made

- **Single source.** Everything comes from `citygen.js`, like Old Town, so the planner drawing and the
  Blender scene match.
- **College style.** Each college gets a style block. The user chose how far it reaches:
  - **Every building in the sector** takes the college's palette and roof kind, whatever the cell's
    use: Alder pale stone, Saffron timber with green roofs, Indigo coloured plaster with pitched roofs.
    That includes the shops and homes, so the three sectors read as three places.
  - **Only college-use cells** take the signature forms: lab halls, tree-house decks, venues, print
    works. Shops and homes keep their current lot-based forms.
  - Where the college style and the neighbourhood type's style both set palette, roofs or forms, the
    college style wins. Lot size and depth stay with the type (*my call*).
  - The block also sets the ground treatment and where the landmarks go.
- **Growing into the bands** (*my call*): no cell or band radius changes. A college may place feature
  footprints (the observatory, the arcology, the dye gardens) inside its own grove or orchard band.
  Trees are cleared round each footprint, the way the existing no-plant zones work. The planner
  setting is on or off per college. Saffron is always off.
- **Indigo's venues and print works** (*my call*): these are forms for Indigo's college-use cells,
  since performing arts and printing are what that college does. No cell changes use.
  - One each of opera house, amphitheatre and big top, placed by seed on college cells.
  - About a third of the remaining college cells become print works, and the rest studios and
    playhouses.
  - Cells with any other use keep their use.
- **Saffron's decks and walkways** (*my call*): raised decks may overhang the orchard edge and leave
  the trees under them. Canopy walkways only join buildings within the same college band. They never
  cross avenues, canals or spoke corridors, so they stay out of the skywalk system.
- **Forms** (*my call*): greybox from the existing primitives.
  - Domes, the big top and the amphitheatre bowl are `o.loft` rings, as for the Lantern.
  - Sawtooth roofs, trunk columns and decks are prisms.
  - The planner draws footprints, plus a symbol for each landmark.
- **Pine arcology** (*my call*): a tall stepped tower whose terraces are planted with pine instances.
  The new pine distance-tree species is used only for the arcology and Indigo's planting.
- **New materials.** New `MAT` keys are appended at the end of `MAT` in `build_city.py` (the index is
  the key's position). *My call*:
  - timber;
  - brick;
  - copper or verdigris;
  - a few plaster colours for Indigo;
  - a canvas colour for the big top;
  - a dye-bed material.
- **Planner.** Each college gets a settings group: name, landmark on or off, how far it may grow into
  the bands, and its style choices. The plan drawing colours each college so they read apart.
- **Trees.** The distance-tree system gets a pine species for the arcology and Indigo's planting.

## Non-goals

- No change to the occupation layout: cell uses stay, and the ring and band radii stay. Landmarks and
  features may sit inside the planted bands (see "Growing into the bands").
- No changes outside the college ring.
- Hero trees and interiors stay out of scope. This is still a greybox with colour.

## Anti-goals

- All three colleges still look like the same grey campus.
- A college's identity only shows on a label, not from the air.
- Indigo's European look spreads to Alder or Saffron.
- Saffron's orchards get eaten by buildings.
- The planner and the scene disagree.

## Constraints

- Seeded randomness only (`rng(key)`).
- `build_city.py` reruns stay idempotent.
- `.blend` files go through Git LFS.
- Commit locally after each plan task. Never push.
- The distance trees and ground palette from the performance pass stay in place.

## Done when (*my call*)

- Generator tests prove the following:
  - each college's buildings use its palette and roof kind;
  - signature forms appear only on college-use cells;
  - every landmark exists exactly once;
  - no building or feature lands in Saffron's orchard band;
  - the same plan gives the same output.
- The plan drawing colours the three colleges distinctly.
- `build_city.py` builds it with no errors. A second run changes nothing.
- An aerial render over the college ring shows three colleges you can tell apart, plus a close render
  of each landmark.
- The scene is saved as a new version, **v05** (LFS), and the planner is republished, with the plan
  store and `plan.json` updated together.

## Left to the builder

- Exact building forms, heights and sizes within each college's feel.
- Where each venue, hall and landmark goes within the rules above.
- How far "growing into the bands" goes, as long as Saffron's orchards stay whole and every college
  keeps some planted band.
- Exact colours, within each college's feel.
