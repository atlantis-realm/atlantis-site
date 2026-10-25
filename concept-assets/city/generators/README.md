# City generators

Greybox generators for `../Atlantian_plaza_blockout-v05.blend`, the file to open (v01–v04 are earlier versions): a Cambridge-scale (≈6 km across) ring
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

## The colleges (v05)

The college ring of the park district (r 530–1180, collection `22_NBHD_PARK`) holds three colleges, one
per 120° sector, each with its own look. Every building in a college's sector takes that college's
palette and roof kind; signature forms sit on college-use cells only. Settings live in the park
district's `colleges` block of `plan.json`.

- **Alder College** (physics, sectors −90°…30°): warm Bath-stone ashlar (`MAT_AP_Ashlar`) capped in
  verdigris copper (`MAT_AP_Verdigris`); lab halls with a lit blue clerestory band (`MAT_AP_Clerestory`)
  under copper roofs; and the copper-domed **Alder Observatory** in its grove band
  (`NBHD_park_alder_observatory`).
- **Indigo College** (creative arts, 30°…150°): gabled studios in coloured plaster (`MAT_AP_PlasterOchre`,
  `PlasterRose`, `PlasterTeal`) under terracotta roofs (`MAT_AP_RoofTile`); the **Indigo Opera**, the
  **Indigo Amphitheatre** and the canvas **Indigo Big Top** (`MAT_AP_Canvas`); sawtooth brick print works
  with chimneys (`MAT_AP_Brick`); and in its orchard band the stepped **Indigo Pine Arcology**
  (`NBHD_park_indigo_arcology`, terrace pines from `KIT_PlantD_pine` via `TREES_park_asset_Plant_pine`)
  beside striped dye gardens (`NBHD_park_indigo_dye_gardens`, `MAT_AP_DyeBed`).
- **Saffron College** (earth sciences, 150°…270°): no plots. Its grove and college bands are one wood
  (`NBHD_park_forest_*` trees) with buildings scattered through it (`NBHD_park_woods_*`): low timber
  tree-houses (`MAT_AP_Timber`) one storey up on trunk columns, and in the college band 2-3 storey timber homes
  and shops, all under bright turf roofs (`MAT_AP_Turf`). Ground-level boardwalk trails join them
  (`MAT_AP_Boardwalk`, `NBHD_park_woods_walkways`). Its orchards are left as they were.

All college colours, roughness and glow are set in code (`COLLEGE_COLORS`, `COLLEGE_ROUGHNESS`,
`COLLEGE_EMISSION` in `build_city.py`), so a rebuild restores them.

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

## Hero export

`export_hero.py` writes the `/city` page's hero view from v05: only what the hero camera (`Camera.001`,
frames 1–250) can see, culled, joined, decimated by distance and AO-baked. The cull geometry is in
`hero_geom.py`. It **never saves the .blend** and leaves the scene as it found it: everything it builds lives
in a scratch scene `HERO_EXPORT_SCENE` (collection `HERO_EXPORT`), every ID it makes carries the custom
property `hero_export`, and all of them are deleted at the end, even on error.

```sh
cd concept-assets/city/generators
# Blender can't run node, so write the plan's blimps first (for the blimp length/radius):
node -e 'const fs=require("fs"),C=require("./citygen.js");fs.mkdirSync("build/hero",{recursive:true});fs.writeFileSync("build/hero/plan_blimps.json",JSON.stringify(C.generate(require("./plan.json")).blimps))'
```

Then in Blender, with v05 open:

```python
G = "/path/to/concept-assets/city/generators/"
exec(open(G + "export_hero.py").read(), {"__name__": "eh", "__file__": G + "export_hero.py", "OUT_DIR": G + "build/hero/"})
```

or headless, which is safer than the live session and takes a few minutes (`--factory-startup` keeps add-ons out):

```sh
flatpak run --command=blender org.blender.Blender --factory-startup -b ../Atlantian_plaza_blockout-v05.blend \
  --python-expr 'G="'$PWD'/"; exec(open(G+"export_hero.py").read(), {"__name__":"eh","__file__":G+"export_hero.py","OUT_DIR":G+"build/hero/"})'
```

Pass `"STOP_AFTER": "cull"` to print only the cull counts. Outputs, in the git-ignored `build/hero/`:

| File | What it is |
|---|---|
| `hero_raw.glb` | Joined meshes `HERO_<band>_<tx>_<ty>_<material>`, the named `Text`, `NBHD_core_lantern`, well ring lights and `HERO_well_water`, trees `HERO_tree_*` and lamps `HERO_lamp_*` as linked duplicates, the camera `HeroCamera` with its baked animation `Hero`. Every mesh has the corner colour `AO` (`COLOR_0`). Materials are simple PBR, `HERO_<source>`; the night list is `NIGHT_*` with `extras.night_emissive = [r, g, b, strength]`. |
| `hero_props.json` | Camera FOV and safe frame, sun, Lantern, blimp orbit, walk paths, well water node, night materials (glTF space: Y up). |
| `export_report.json` | Kept/dropped counts per collection, band and mesh counts, triangles, glb size, timings. |

Two runs give a byte-identical `hero_raw.glb` and leave the scene's object, material and mesh counts and
the `Camera.001` keys unchanged. v05's Lantern is `NBHD_core_lantern` (the `KIT_Temple_lantern*` objects are
in the excluded temple), so it is the node carrying `NIGHT_MAT_AP_Cyan`; the well ring lights use
`NIGHT_WellRing`. The scene objects' names are taken by the originals, so the copies are built as
`<name>@hero` and the suffix is stripped from the glb afterwards.

`hero_glb.mjs` turns `hero_raw.glb` into `static/city/hero.glb`. The tuning knobs (cull margin, bands,
tiles, decimate ratio, subdivision, AO, lamps, blimps) are the constants at the top of `export_hero.py`.

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
