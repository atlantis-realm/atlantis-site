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

Then run it **headless** on the saved v05 (about a minute; `--factory-startup` keeps add-ons out). This is
the default and the only tested way to run it:

```sh
flatpak run --command=blender org.blender.Blender --factory-startup -b ../Atlantian_plaza_blockout-v05.blend \
  --python-expr 'G="'$PWD'/"; exec(open(G+"export_hero.py").read(), {"__name__":"eh","__file__":G+"export_hero.py","OUT_DIR":G+"build/hero/"})'
```

It reads the .blend as saved on disk, so unsaved edits in an open Blender session are not exported.

Running it inside the live Blender session (`exec` through the Blender MCP) is **unverified**: a related
`temp_override` pattern segfaulted Blender 5.2, and a crash loses unsaved work. `run()` refuses to run
outside background mode unless the exec globals carry `"ALLOW_LIVE": True`. Pass it only after the user
has saved and opted in:

```python
G = "/path/to/concept-assets/city/generators/"
exec(open(G + "export_hero.py").read(), {"__name__": "eh", "__file__": G + "export_hero.py", "OUT_DIR": G + "build/hero/", "ALLOW_LIVE": True})
```

Pass `"STOP_AFTER": "cull"` to print only the cull counts. Outputs, in the git-ignored `build/hero/`:

| File | What it is |
|---|---|
| `hero_raw.glb` | Joined meshes `HERO_<band>_<tx>_<ty>_<material>`, the named `Text`, `NBHD_core_lantern`, well ring lights and `HERO_well_water`, trees `HERO_tree_*` and lamps `HERO_lamp_*` as linked duplicates, the camera `HeroCamera` with its baked animation `Hero`. Every mesh has the corner colour `AO` (`COLOR_0`). Materials are simple PBR, `HERO_<source>`; the night list is `NIGHT_*` with `extras.night_emissive = [r, g, b, strength]`. |
| `hero_props.json` | Camera FOV and safe frame, sun, Lantern, blimp orbit, walk paths, well water node, night materials, and `night_nodes` (glTF space: Y up). `sun.dir` is a unit vector pointing **from the scene toward the sun** (the sun object's +Z). `night_nodes` maps `NIGHT_MAT_AP_Cyan` and `NIGHT_WellRing` to the only node names allowed to use them. |
| `export_report.json` | Per collection: `instances`, `in_frustum`, `kept`, `dropped_frustum` (= instances − in_frustum), `dropped_occlusion` (= in_frustum − kept), `chunks`, `chunks_kept`. Also band and mesh counts, triangles, glb size, timings. |

Two runs give a byte-identical `hero_raw.glb` and leave the scene's object, material and mesh counts and
the `Camera.001` keys unchanged. v05's Lantern is `NBHD_core_lantern` (the `KIT_Temple_lantern*` objects are
in the excluded temple), so it is the node carrying `NIGHT_MAT_AP_Cyan`; the well ring lights use
`NIGHT_WellRing`. The Lantern's `MAT_AP_Glow` faces are its cyan heart, so they also go to
`NIGHT_MAT_AP_Cyan` (cyan), not to the warm `NIGHT_MAT_AP_Glow` band used elsewhere.

The near band (< `NEAR_DIST`) is joined per material per `NEAR_TILE` tile like the mid band, rather than
kept object by object: per-object near meshes would blow the 300 draw-call budget. Near keeps its full
detail (no back-face drop, no decimate) and the finest AO subdivision. The scene objects' names are taken by the originals, so the copies are built as
`<name>@hero` and the suffix is stripped from the glb afterwards.

`hero_glb.mjs` turns `hero_raw.glb` into `static/city/hero.glb` (git-ignored until the look is approved)
and copies `hero_props.json` beside it. It runs `dedup` (accessors, meshes, textures; not materials, which
the page finds by name), `instance` (min 5: trees and lamps become `EXT_mesh_gpu_instancing`), `weld`,
`prune`, `quantize` and `meshopt` (medium), and prints the size, triangles and draw-call estimate:

```sh
npm i                     # once: glTF-Transform and meshoptimizer, from public npm
node hero_glb.mjs         # [in=build/hero/hero_raw.glb] [out=../../../static/city/hero.glb]
node --test test/hero_glb.test.js   # budget tests; they skip when static/city/hero.glb is absent
```

The tuning knobs (cull margin, bands, tiles, decimate ratio, subdivision, AO, lamps, blimps) are the
constants at the top of `export_hero.py`. Budget: glb + props ≤ 10 MB, ≤ 300 draw calls, ≤ 1.5 M
triangles. Tuned values: `NEAR_TILE, MID_TILE, FAR_TILE = 200, 200, 800` (100/100/400 gave about 440 draw
calls), `FAR_DECIMATE = 0.25`, `SUBDIV_NEAR, SUBDIV_MID = 4, 12`, trees unchanged. Result: 4.97 MB,
561,117 triangles, about 265 draw calls (after the branch review fixes: the frame-1 safe frame
`f1` is now measured where the avenue frontage first enters the 16:9 frame, 0.4393, which culls
the portrait view a little tighter).

Walk paths keep `WALK_CAMERA_CLEARANCE` (8 m, measured from a walker's chest) from the camera at
every frame 1–250 (`hero_geom.clear_runs`). Only the avenue pavements have walkers; none circle the
plaza. Lamp heads are tagged by the head cube's
own vertices, so only the head carries `NIGHT_Lamp`; `test/hero_glb.test.js` checks both.

Final budget, measured on `/city` with the whole page running (blimps, water, people, night list):

| What | Budget | Measured |
|---|---|---|
| `hero.glb` + `hero_props.json` | ≤ 10 MB | 5,203,440 + 8,928 bytes = 4.97 MiB |
| `stats()` draw calls, whole frame, day | ≤ 300 | 69–71 (frame 250) to 258 (peak), at 1280×720 and 390×844 |
| `stats()` draw calls, whole frame, night | ≤ 300 | 83–94 (frame 250) to 272 (peak) |
| `stats()` triangles, whole frame | ≤ 1.5 M | 1,000,957 (frame 250) to 1,090,092 |
| Main pass alone | | 67–69 (frame 250) to 256 calls; 497,576 to 586,649 triangles |
| Sun shadow pass (desktop only) | | 2 calls: the merged caster proxy (484,229 triangles) and the people |
| Night bloom path | | +14 calls |
| Mobile (`pointer: coarse`: no shadows, 100 people) | ≤ 300 | 78 calls / 503,020 triangles at frame 250, 256 / 577,049 at frame 1 |

`stats()` counts every pass of a frame, so on desktop it includes the shadow pass and, at night, the
bloom passes. The sun shadow casters near the plaza (96 meshes and 16 instanced meshes, about 110
shadow draw calls, which put the desktop frame at 365 by day and 383 by night) are merged at load into
one position-only mesh, `ShadowProxy` (`src/lib/city/shadowProxy.ts`). It is on a layer the camera
sees only while the shadow map renders, so the main pass never draws it. The rendered frames match
the per-mesh casters (at most 0.002% of pixels differ by more than 8/255).

## People

`export_people.py` bakes the `/city` walkers from the PSX character pack in `Assets/People` (rigged
Mixamo FBX). It needs no .blend, only reads the pack and never writes to it:

```sh
cd concept-assets/city/generators
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/export_people.py" \
  -- "$PWD/build/people"                      # [out_dir] [assets=/run/media/.../Assets/People]
node people_glb.mjs        # [in=build/people/people_raw.glb] [out=../../../static/city/people.glb]
node --test test/people_glb.test.js   # skip when static/city/people.glb is absent
# contact sheets of the sit and lean poses against a ledge and a wall (build/people/check_poses.py, git-ignored):
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/build/people/check_poses.py" \
  -- "$PWD/build/people/people_raw.glb" "$PWD/build/people/people_meta.json" "$PWD/build/people/sheets"
```

- **Cast** (`people_cast.py`, tested): `PEOPLE_VARIANTS = 12` from `Models/Rig` and `Extras_Rig`
  (identical files are taken once): one of each `UNIFORM_SLOTS` (male police, female firefighter, male
  doctor, female hazmat) and eight civilians, four men and four women, picked by stride over the sorted
  names, so a rerun picks the same people. No `Killer`, `Monster` or `Exotic_dancer` model is ever
  picked.
- **Walk**: a procedural walk posed on the rig and baked to `WALK_KEYS = 6` shape keys `walk_0`…`walk_5`
  (phase 0 = left heel contact). The page steps through them with **no blending**: the chunky 6-frame
  look is intended, and the robots added later are the fluid ones. Every bone turns about a world axis
  through its head, so the files' different bone rolls don't matter: arms down to `ARM_HANG_DEG` (9°)
  off vertical, thighs ±`THIGH_SWING` (23°), knees `KNEE_STANCE` 5° + `KNEE_SWING` 45° at passing +
  `KNEE_LOAD` 24° in early stance, feet kept level, arms ±`ARM_SWING` (18°) with a 12–26° elbow bend,
  hips/chest twist ±`SPINE_TWIST` (6°). Each key is grounded on its lowest vertex, so the hips bob
  0.7–3.3 cm, lowest at contact. The armature is deleted: the glb holds plain meshes with morph targets.
- **Idle poses**: two static keys after the walk, `sit` (target 6) and `lean` (target 7), held still on
  the page (`POSE_KEYS`). Limbs are placed with two-bone IK (`two_bone`, tested) on the rig. **Sit**: on a
  ledge edge, thighs level, shins down, back `SIT_SPINE_FWD` (6°) forward, hands palm down on the thighs;
  the thighs droop up to 15° to bring the seat contact to `SIT_SEAT_H` (0.45 m) above the soles, and the
  short legs that can't reach it sit lower (0.37–0.45 m over the cast). The ledge edge is
  `SIT_EDGE_CLEAR` (3 cm) behind the shins and feet (vertices weighted to them), the seat the lowest
  point behind it, so nothing dips into the ledge. **Lean**: back to a wall, body tilted `LEAN_TILT` (7°)
  back, the left foot flat, the right foot's sole flat on the wall with the ankle `LEAN_FOOT_H` (0.42 m)
  up, hands in the front pockets (the wrist just inside the thigh's front, measured on the mesh). The
  wall plane is the rearmost point of the upper body (head, back, buttocks).
- **Atlas**: the 12 pack textures (`Textures/<image>.png`, 512 px, opaque, colours untouched) in a 4×3
  grid (2048×1536), UVs inset `ATLAS_INSET_PX` (4 px) per tile; saved as JPEG (`ATLAS_JPEG_QUALITY` 90:
  a PNG atlas alone is 3.4 MB). One material `PEOPLE_Atlas` (roughness 0.85, metallic 0).
- **Outputs** (`build/people/`): `people_raw.glb` (meshes `PEOPLE_<file>`, facing glTF +Z, feet on
  y = 0, origin under the rest hips; morph targets `walk_0`…`walk_5`, `sit`, `lean`), `people_atlas.jpg`,
  `people_meta.json` `{version: 2, keys: 6, poses: {sit: 6, lean: 7}, cycle_m, variants: [{name, height,
  gender, kind, tile, cycle_m, sit_seat_h, sit_edge, sit_reach, lean_back}]}`. `keys` counts the walk
  keys only; `poses` gives each static pose's morph target index. `cycle_m` is metres per walk cycle (2
  steps, twice the heel-to-heel stride at contact): 1.12–1.52 per person, mean 1.327 (≈1.4 for a 1.75 m
  person). The pose measures are metres in the character's frame (forward = its facing):
  `sit_seat_h` the seat contact above the soles (0.37–0.45), `sit_edge` the ledge edge forward of the
  origin (0.25–0.35), `sit_reach` the feet/knees forward of that edge (0.28–0.33), `lean_back` the wall
  behind the origin (0.15–0.23). To sit someone on a ledge whose front edge is at P (facing out over the
  drop): origin = P − facing · `sit_edge`, y = ledge top − `sit_seat_h`; to lean someone on a wall whose
  foot is at P (facing away): origin = P + facing · `lean_back`. Two runs give byte-identical files.

`people_glb.mjs` runs `prune`, `quantize` (morph targets included) and `meshopt`, writes
`static/city/people.glb` and copies `people_meta.json` beside it: 1.83 MB (8 morph targets), 14,583
triangles for one of each person (about 1,200 each).

On the page (`src/lib/city/people.ts`) each variant is one InstancedMesh with the shared atlas material;
walkers pick a variant by a seeded weighted draw (uniforms at `UNIFORM_WEIGHT` 0.5 against a civilian's 1)
and show walk key `floor(phase · keys)` for phase = distance walked / (variant `cycle_m` × walker scale),
one key at 1 and the rest 0. Without `people.glb` or `people_meta.json` the page walks capsules instead.
At 1280×720 desktop with shadows, 160 walkers keep the frame at ≤ 252 draw calls and ≤ 1.45 M triangles.

The pack is the user's own purchased asset. Like the hero, `people.glb` and `people_meta.json` are
git-ignored until the user approves the look and its use on the site.

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
