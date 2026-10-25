# City generators

Greybox generators for `../Atlantian_plaza_blockout-v04.blend` (v01–v03 are earlier versions): a Cambridge-scale (≈6 km across) ring
city of sloped tiers rising to Old Town at the centre, six inclined spoke avenues, and one-way ring
avenues in every ring.

## Old Town and the Lantern (v04)

The centre, inside the first ring canal (r < 460), is **Old Town**, generated entirely by `citygen.js`
(district id `core`, collection `23_NBHD_CORE`):

- **Grid:** a street grid aligned to the hero avenue round a square of about 100 m (`core.grid`: block,
  street and square size, tower-form mix). Grid towers are 120–220 m (`core.heights`).
- **Quarters:** a patchwork of culture quarters from the first ring avenue (r 232) out to the canal
  (`core.quarters`: count, block size range, angle seed, optional culture list). Band towers are
  200–300 m.
- **Landmarks:** parliament, courts, exchange, embassies and guild halls, 25–80 m (`core.landmarks`).
- **The Lantern:** the ~500 m tower on the square (`core.lantern`: height, base width, taper, heart
  position and height). Its glowing cyan heart (`MAT_AP_Glow`) runs over 40–80 % of the height, and
  Old Town heights are capped so the heart top clears every roof by `core.lantern.clearance` (default 60 m).
- Spokes, the hero avenue and skywalks stop at the first ring avenue; nothing radial runs inside it.
  `core.second_avenue` (off by default) brings back the 350 m ring avenue.
- Every new setting has a default, so an older plan without these keys still builds.

The hand-built temple is not deleted: `build_city.py` excludes the `05_TEMPLE` collection from the view
layer and hides its planting (`KIT_PlantI_temple_*`). Re-enable the collection to get it back.

One generator feeds everything. `citygen.js` is inlined into the plan page, which draws the plan from it,
and run in node to produce the exact geometry Blender builds, so the plan and the scene can't drift.

| File | What it is |
|---|---|
| `plan.json` | The plan: rings, terrain, spokes, skyline, districts. The live copy is in the plan page's shared store; this is the last one built. |
| `citygen.js` | The generator: terrain, spoke profiles (ramps, bridges, stairs), ring avenues, Voronoi plots with squared-off buildings and culture-styled roofs, land use, neighbourhoods, Dutch canals with locks, harbours, skywalks, orchard solar farms and wind blimps, colleges, setback towers, planting. |
| `citygen_cli.js` | `node citygen_cli.js plan.json build/build.json` writes the build list Blender reads. |
| `build_city.py` | Run inside Blender. Rescales and regrades the hand-built scene onto the plan, then builds the generated collections `19`–`26` (Old Town and the Lantern in `23_NBHD_CORE`), hides the temple and cuts the canals out of the hand-built ground and canal walls (`27_CANAL_CUTS`, Boolean modifiers). |
| `plan_page/` | The city planner: `head.part.html` + `script.part.js` + `citygen.js`, joined by `assemble.py` into `atlantis-city-plan.html` (committed, so the planner opens straight from the repo; its live plan is kept in the published artifact's store). |
| `oneoff/` | One-time scene edits kept for reference (the avenue widening). |

## Rebuild the scene

```sh
cd concept-assets/city/generators
node citygen_cli.js plan.json build/build.json
```

Then in Blender (Scripting tab, or through the Blender MCP):

```python
G = "/path/to/concept-assets/city/generators/"
exec(open(G + "build_city.py").read(), {"BUILD_PATH": G + "build/build.json", "__name__": "bc"})
```

Pass `"DO_REGRADE": False` to rebuild only the generated city, or `"DO_BUILD": False` to only move the
hand-built scene. Rerunning is safe: every object it moves keeps its original transform (object
property `rg_orig_loc`, mesh attribute `rg_orig_co`, curve property `rg_orig_pts`) and starts from it.

## Tests

```sh
cd concept-assets/city/generators
node --test "test/*.test.js"
```

Use the quoted glob: plain `node --test test/` fails on Node 24, and bare `node --test` would also run
`test/helpers.js`. Tests call the real `citygen.js` functions.

## Update the plan page

```sh
python3 plan_page/assemble.py   # rewrites plan_page/atlantis-city-plan.html; commit it and republish the artifact
```

## Conventions

- Metres, centre-relative coordinates (x east, y north); the scene centre is `scene.center` (0, 1168).
- Ring avenues are numbered from the centre outward. In each ring the inner one runs clockwise and the
  outer one anticlockwise. Spokes are two-way.
- Blocks: `layout: "voronoi"` (default) seeds each band × sector, relaxes the cells (`plan.voronoi.relax`)
  and shrinks them by half a street; `layout: "rows"` uses the older concentric rows of blocks. Each cell
  is a plot: buildings inside are rectangles squared to the street (`plan.plots`), styled per
  neighbourhood culture (`neighbourhoods.types[].style`).
- Seeded randomness: FNV-1a of a key string seeds mulberry32, so a plan always builds the same city.
- `plan.scene.rescale` maps the original hand-built radii to the current scale (canals keep their width);
  the hero opener moves outward by `hero_shift` as one piece.
- `package.json` here marks these scripts CommonJS; the site's own build doesn't use them.

## Large files

`.blend` and other heavy 3D formats under `concept-assets/` are stored with Git LFS (see the repo's
`.gitattributes`). Run `git lfs install` once per clone. Blender's `.blend1` backups and the
`*_before-*.blend` safety copies are ignored.
