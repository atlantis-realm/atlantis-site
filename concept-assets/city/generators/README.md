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
| `oneoff/` | One-time scene edits kept for reference (the avenue widening, the v06 cull of unseen objects). |

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
| `hero_props.json` | Camera FOV and safe frame, sun, Lantern, blimp orbit, walk paths, well water node, night materials, and `night_nodes` (glTF space: Y up). `sun.dir` is a unit vector pointing **from the scene toward the sun** (the sun object's +Z). `night_nodes` maps `NIGHT_MAT_AP_Cyan` and `NIGHT_WellRing` to the only node names allowed to use them. `idle_spots` (see "Idle spots" below), `robot_routes` ("Robot routes"), `talk_spots` ("Talk spots") and `drone_spots` / `drone_sky` ("Drone spots"). `version` is 2 since robot routes and talk spots (and the lean spots' `top`) were added; the page reads all of these as optional. |
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

### Idle spots

`idle_spots()` finds where idle people can sit or lean, for the page to place static `sit` / `lean` poses
(see People). It probes the BVH of the culled scene (skywalks, trees and the `Text` skipped) with a
`IDLE_GRID` (0.5 m) downward height map within `IDLE_RANGE` (150 m) of the camera path; a cell counts as
level ground only if its surface is exported, level, not water and not a facade, roof or street furniture
(`NOT_GROUND`). Then, between neighbouring cells:

- **sit**: a level ledge a `SIT_DROP` (0.35–0.6 m) step above its neighbour. A sideways ray finds the riser;
  the ledge must be level `SIT_BEHIND` behind the edge and the ground level `SIT_FRONT` in front
  (`hero_geom.sit_profile`), with room for knees, head and back. `pos` is the edge point at the ledge top,
  `heading` faces out over the drop, `drop` = ledge top − ground in front.
- **lean**: any change from level ground. Rays at `LEAN_CONTACT_HS` (0.9–1.2 m) find the nearest vertical
  surface, a wall or a railing's handrail; nothing at leg or shoulder height may stick out past it, and the
  ground `LEAN_FRONT` in front must be level and free (`hero_geom.lean_profile`). `pos` is on the ground at
  the wall foot, `heading` faces away from the wall.
- **wall top** (lean only, for a forward lean with the forearms on it): rays toward the wall from
  `LEAN_BODY_D` out are scanned up from the contact height every 5 cm to 1.8 m (`LEAN_TOP_HS`, reaching
  `LEAN_TOP_REACH` 0.15 m past the face); the first that misses is just above the top
  (`hero_geom.wall_top`), and a downward ray 3 cm behind the face finds the top itself (a railing too thin for
  it keeps the scan's estimate). `top` is that height above the ground in metres, or `null` when every ray
  hit (a wall taller than 1.8 m).
- **both**: the body must have room to either side (`IdleProbes.sides_clear`): rays `IDLE_SIDE_D` (0.3 m)
  left and right, square to the facing (`hero_geom.side_dirs`), at `LEAN_SIDE_HS` (0.5, 1.0, 1.5 m) from
  `LEAN_BODY_D` out of the wall, or at `SIT_SIDE_HS` (0.15, 0.5, 0.9 m above the seat) from `SIT_SEAT_IN`
  behind the edge, must run free, and the ground (lean) or seat (sit) `IDLE_SIDE_D` to either side
  (`hero_geom.side_points`) must be at the same level. This keeps leaners out of inside corners, where a
  wall square to theirs would bury half the body.

Kept spots are clear of the camera (`WALK_CAMERA_CLEARANCE` at the chest, every frame, as the walk paths),
`IDLE_PATH_CLEARANCE` (1.2 m) from every walk path line (both `pos` and the point `IDLE_BODY_REACH`, 0.4 m,
out along the facing: a leaner's origin, a sitter's feet), within `IDLE_LEVEL` (3 m) of the nearest walk
path's height (no roofs), in a cull frustum and seen from at least one sample camera, and `IDLE_SPACING`
(1 m) apart (`hero_geom.thin_spots`, in position order), at most `IDLE_MAX_SPOTS` (400, stride-picked per
pose), and `ROUTE_IDLE_CLEAR` (3 m) from every robot route (both points again). Each is `{pose, pos, heading,
drop (sit only), top (lean only), area}` in glTF space; `heading` is walkerPose's yaw
(`hero_geom.gl_heading`), `area` is `well` (within `WELL_AREA_R`, 20 m: the walkway round it), `avenue` or
`other`. `export_report.json` has the counts.

v05 result: 146 spots, 32 sit (all on the avenue: the outer pavement edge drops 0.41–0.59 m to the side
streets between the buildings, so they sit facing out over the side street) and 114 lean (26 on the
walkway railings round the well, all with `top` 1.127–1.128 m, and 88 against the avenue facades, all
`top: null`: so a forward lean only suits the well railings). None was near a robot route. v05 has no stepped rings round the well
(its deck is level, the rings are 2–9 cm inlays), no planter edges (the planting strips are flush) and no
kerbs (lane and pavement are level), so there are no seats at the well. The spots reach about 150 m up the
avenue (the camera stays near the well).

### Robot routes

`robot_routes()` finds where the robot can walk across the hero view, screen left to right or back. The camera
looks down the hero avenue, so these are the ring avenues and streets that cross it. It runs before the lamps
are placed, on the BVH of every in-frustum chunk (exported or not: the robot also walks where it is hidden):

- **Ground** (`route_z`): the first surface below (skywalks, trees and the `Text` skipped) must be level, not
  water and not a facade or street furniture (`NOT_GROUND`), with `ROBOT_H` (4.5 m) free above it and no tree
  centre (its trunk) within `ROUTE_TREE_CLEAR` (2 m).
- **Crossings**: cross lines square to the avenue every `ROUTE_SCAN_STEP` (1 m) from `ROUTE_RANGE` 20 to 500 m
  along it, probed every `ROUTE_STEP` (2 m) out to `ROUTE_REACH` (90 m) either side. A line counts when its
  ground is walkable from the axis `ROUTE_MIN_REACH` (60 m) both ways, with steps up to `ROBOT_STEP_MAX`
  (0.7 m, so the avenue's 0.6 m pavement edge is a step) (`hero_geom.walk_run`): past the avenue frontage
  (about 46 m out), so the dead-end gaps between its buildings don't count. Runs of `ROUTE_MIN_W` (3) lines
  are the crossings (`hero_geom.bands`).
- **Lanes**: a crossing holding a ring avenue (from `plan.json`: the scene centre and each district's ring
  avenue radius and road width, `plan_rings()`; where it crosses the axis: `hero_geom.ring_crossing`) gets one
  route per `RING_LANES` offset (a quarter of the road width in and out from the radius), following the ring's
  arc; any other crossing gets one straight route down its middle.
- **Per route**: each point needs ground `ROBOT_HALF_W` (1.5 m) to either side, square to the route, within
  `ROBOT_STEP_MAX`, and `ROBOT_CAMERA_CLEARANCE` (12 m) from the camera path at `ROBOT_VIEW_H` (2 m) up; the
  route is the walkable run through the axis. For every sample frame (`hero_geom.sample_frames`, every 5)
  it records the stretch the 16:9 view sees (a robot-sized box in its frustum and a ray to `ROBOT_VIEW_H`
  unoccluded, `hero_geom.seen_ranges`). A route is trimmed to `ROUTE_PAD` (8 m) past everything seen, and
  dropped if it can't run that far past it on both sides (the robot would pop in).
- **Lamps**: no lamp post is placed within `ROUTE_LAMP_CLEAR` (3 m) of a route.

Each route is `{name, kind, along, points, len, seen, view}` in glTF space: `name` (`street_<along>`, or
`ring_<district>_<index>_in` / `_out` for the inner / outer half of that ring avenue's road), `kind` (`ring`
or `street`), `along` (metres from the well centre along the avenue axis where it crosses), `points` (ground
points `ROUTE_STEP` apart, ordered screen left to right as the hero camera sees them; reverse them to walk
right to left), `len` (metres along the points), `seen` (`[from, to]` metres along the route seen from some
sample frame) and `view` (`[frame, from, to]` for each sample frame that sees part of it). `export_report.json`
has the crossings, the routes and any dropped ones with the reason.

v05 result: 5 routes. The avenue frontage hides everything off the avenue itself, so each is seen only across
the avenue (about ±20–28 m from the axis) and walks in from behind the buildings on one side and out behind
the other:

| Route | Kind | Along | Length | Seen | Sample frames |
|---|---|---|---|---|---|
| `street_57` | street, just past the canal; steps 0.6 m up onto and off the avenue pavement | 57 m | 56 m | 8–48 m | 1–96 |
| `street_357` | street between the blocks | 357 m | 64 m | 8–56 m | 1–86 |
| `street_380` | open ground in front of the ring avenue | 380 m | 64 m | 8–56 m | 1–86 |
| `ring_belt_1_out` | ring avenue r 1980, outer half of the road | 394.5 m | 72 m | 8–64 m | 1–86 |
| `ring_belt_1_in` | ring avenue r 1980, inner half of the road | 401.5 m | 68 m | 10–58 m | 1–86 |

The next ring avenue (r 1620) crosses 758 m out, past `ROUTE_RANGE`; the one behind the camera (r 2560) is
out of view. After frame 96 the camera looks down at the plaza and no route is in view. The plaza itself has
no route: the walkway deck is railed on both sides over the canal. The street at 57 m lost the two avenue lamps
at 56 m.

### Talk spots

`talk_spots()` finds open flat ground for conversation circles, from the same `IDLE_GRID` height map, trying a
centre every `TALK_STRIDE` (2) cells:

- every cell within the radius, the largest of `TALK_RADII` (2.2, 1.9, 1.6 m) that fits
  (`hero_geom.disc_offsets`), is level ground as for the idle spots, within `TALK_TOL` (6 cm) of the centre's
  height and not roadway (`TALK_NOT_GROUND`: the avenue lanes, median, tram line and planting strips, ring
  avenues);
- rays out from the centre at `TALK_CLEAR_HS` (0.3, 1.0, 1.7 m) in `TALK_CLEAR_DIRS` (8) directions run free
  to the radius + 0.3 m (no wall or railing inside), and `TALK_HEADROOM` (2.2 m) is free above the centre and
  the rim;
- clear of the camera (`WALK_CAMERA_CLEARANCE` from the chest at the rim, every frame), the walk paths
  (`IDLE_PATH_CLEARANCE` past the rim), the robot routes (`ROUTE_IDLE_CLEAR` past the rim) and the idle spots
  (`TALK_IDLE_GAP`, 1 m, past the rim), at street level (`IDLE_LEVEL`), within `IDLE_RANGE`, in a cull frustum
  and seen from a sample camera;
- `TALK_SPACING` (3 m) between rims, largest circles first, at most `TALK_MAX_SPOTS` (60, stride-picked).

Each is `{pos, radius, area}` in glTF space: `pos` the centre on the ground (its y the ground height),
`radius` metres of free flat ground round it, `area` as for the idle spots.

v05 result: 14 spots (10 of radius 2.2 m, 4 smaller): 6 on the walkway deck round the well, 4 on the
avenue pavement at its foot, before the walk paths start (8–17 m out; the one within `WELL_AREA_R` counts as
`well`, so 7 are `well` and 7 `avenue`), and 4 in the open ground beside the avenue between its facades
(63–140 m out).

### Drone spots

`drone_sky()` and `drone_spots()` give the page's delivery drones (`src/lib/city/drones.ts`) where to drop
parcels and how high to cruise. Both run after the talk spots, on the BVH of every in-frustum chunk:

- **Sky** (`drone_sky`): downward rays every `DRONE_SKY_STEP` (2 m) from `GROUND_TOP` find the top surface
  (anything: the Text, skywalks, hidden chunks) over `DRONE_SKY_AHEAD` (640 m) along the avenue from the camera,
  `DRONE_SKY_BACK` (160 m) behind it and `DRONE_SKY_HALF_W` (260 m) either side. Per `DRONE_SKY_CELL` (8 m)
  cell the highest hit or tree top (the trees are not in the BVH, so their boxes count; `hg.pool_max`, tested),
  rounded up to the metre, 0 where nothing is. `drone_sky` is `{origin: [x, z], cell, nx, nz, h}` in glTF space:
  `origin` the corner with the least x and z, `h` row-major by z.
- **Ground spots**: the talk spots' centres (open plaza and pavement, see "Talk spots") with `DRONE_COLUMN_H`
  (120 m) free straight up from the centre and four points `DRONE_COLUMN_R` (1.2 m) out, and no tree box over them.
- **Roof pads**: cells of the 2 m top map that are level (`IDLE_FLAT_NZ`), exported, not water, a skywalk, a tree
  or the Text (`DRONE_ROOF_SKIP`), at least `DRONE_ROOF_MIN_H` (4 m) above the nearest walk path point, level to
  `DRONE_ROOF_TOL` (0.15 m) over the cells `DRONE_ROOF_PATCH` either side (`hg.flat_patch`, tested: a 6 × 6 m
  pad), within `DRONE_RANGE` (320 m) of the camera path and under no tree.
- **Kept**: the point `DRONE_VIEW_H` (3 m) above the spot (a hovering drone) must be `DRONE_CAMERA_CLEARANCE`
  (10 m) from the camera path and seen, in the 16:9 view and unoccluded, from at least one sample frame; every
  such frame is listed. Then `DRONE_SPOT_SPACING` (6 m) apart, ground first, at most `DRONE_MAX_ROOFS` (60)
  roofs (stride-picked).

Each spot is `{pos, kind, frames}` in glTF space: `kind` `ground` or `roof`, `frames` the sample frames that
see the hovering drone. `export_report.json` has the counts.

v05 result: 15 spots. 7 ground: 5 on the walkway round the well and 2 on the avenue pavement 60–75 m out (the
other 7 talk spots have a tree or overhang above them, or are within 6 m of a kept one); 8 roof pads, 40–58 m
up on the avenue frontage 80–280 m out (33 seen before spacing). No spot is seen after sample frame 86: from
there on the camera looks down into the well. The sky grid is 66 × 101 cells, highest 128 m; it and the spots
take `hero_props.json` from 41.7 KB to 89.5 KB. `hero_raw.glb` is unchanged (two runs: the same SHA).

Final budget, measured on `/city` with the whole page running (blimps, water, people, night list):

| What | Budget | Measured |
|---|---|---|
| `hero.glb` + `hero_props.json` | ≤ 10 MB | 4,032,916 + 41,705 bytes = 3.89 MiB |
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
# one sheet of lean, lean_fwd (against its measured rail), stand and talk, side / front / three-quarter rows
# (build/people/check_poses2.py, git-ignored; [variants 0,3,..] [cell px]):
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/build/people/check_poses2.py" \
  -- "$PWD/build/people/people_raw.glb" "$PWD/build/people/people_meta.json" "$PWD/build/people/poses.png" 0,1,3,6,7,9,10,11 180
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
- **Idle poses**: five static keys after the walk, `sit` (target 6), `lean` (7), `lean_fwd` (8), `stand` (9)
  and `talk` (10), each held still on the page (`POSE_KEYS`; the first two keep their old targets). Limbs are placed with two-bone IK (`two_bone`, tested) on the rig. **Sit**: on a
  ledge edge, thighs level, shins down, back `SIT_SPINE_FWD` (6°) forward, hands palm down on the thighs;
  the thighs droop up to 15° to bring the seat contact to `SIT_SEAT_H` (0.45 m) above the soles, and the
  short legs that can't reach it sit lower (0.37–0.45 m over the cast). The ledge edge is
  `SIT_EDGE_CLEAR` (3 cm) behind the shins and feet (vertices weighted to them), the seat the lowest
  point behind it, so nothing dips into the ledge. **Lean**: back to a wall, body tilted `LEAN_TILT` (7°)
  back, the left foot flat, the right foot's sole flat on the wall with the ankle `LEAN_FOOT_H` (0.42 m)
  up, hands in the front pockets (the wrist just inside the thigh's front, measured on the mesh). The
  wall plane is the rearmost point of the upper body (head, back, buttocks). **Forward lean**
  (`lean_fwd_pose`): facing a railing, the body tipped `LEAN_FWD_TILT` (4°) forward about the hips (feet
  re-levelled) and bent `LEAN_FWD_SPINE` (9°, 9°, 7° at Spine, Spine1, Spine2), the head back up 14°, the
  upper arms 40° forward and out, the forearms crossing in front just above level, palms down, the right knee
  relaxed. Every limb direction is `limb_dir(pitch, yaw)` (tested). The rail is then measured where the
  forearms land (`rail_measure`, tested): its centre 0.3 of the way from the forearms' rearmost to foremost
  point, `LEAN_FWD_RAIL_D` (6 cm) deep, its top the forearms' lowest point over it (forearm vertices more
  than `LEAN_FWD_ARM_BAND`, 10 cm, below the elbow and wrist joints are cloth, such as a jacket hem, and count
  as body). The bake fails if any body point below the top crosses the rail's face (clearance 2–14 cm over
  the cast). **Stand**: arms down with the elbows bent `STAND_ELBOW` (10°), the right knee relaxed
  `STAND_KNEE` (9°). **Talk**: the stand with the right arm out in front in a gesture (`TALK_ARM`,
  `TALK_FOREARM`, `TALK_HAND`), palm up, the head tipped `TALK_HEAD` (6°) to the right.
- **Atlas**: the 12 pack textures (`Textures/<image>.png`, 512 px, opaque, colours untouched) in a 4×3
  grid (2048×1536), UVs inset `ATLAS_INSET_PX` (4 px) per tile; saved as JPEG (`ATLAS_JPEG_QUALITY` 90:
  a PNG atlas alone is 3.4 MB). One material `PEOPLE_Atlas` (roughness 0.85, metallic 0).
- **Outputs** (`build/people/`): `people_raw.glb` (meshes `PEOPLE_<file>`, facing glTF +Z, feet on
  y = 0, origin under the rest hips; morph targets `walk_0`…`walk_5`, `sit`, `lean`, `lean_fwd`, `stand`,
  `talk`), `people_atlas.jpg`, `people_meta.json` `{version: 3, keys: 6, poses: {sit: 6, lean: 7, lean_fwd: 8,
  stand: 9, talk: 10}, cycle_m, variants: [{name, height, gender, kind, tile, cycle_m, sit_seat_h, sit_edge,
  sit_reach, lean_back, lean_fwd_front, lean_fwd_top}]}`. `keys` counts the walk
  keys only; `poses` gives each static pose's morph target index. `cycle_m` is metres per walk cycle (2
  steps, twice the heel-to-heel stride at contact): 1.12–1.52 per person, mean 1.327 (≈1.4 for a 1.75 m
  person). The pose measures are metres in the character's frame (forward = its facing):
  `sit_seat_h` the seat contact above the soles (0.37–0.45), `sit_edge` the ledge edge forward of the
  origin (0.25–0.35), `sit_reach` the feet/knees forward of that edge (0.28–0.33), `lean_back` the wall
  behind the origin (0.15–0.23), `lean_fwd_front` the forward lean's rail face ahead of the origin
  (0.20–0.28) and `lean_fwd_top` its top above the soles (0.94–1.19; the shortest person, 1.52 m, rests
  her elbows at 0.94). To sit someone on a ledge whose front edge is at P (facing out over the
  drop): origin = P − facing · `sit_edge`, y = ledge top − `sit_seat_h`; to lean someone on a wall whose
  foot is at P (facing away): origin = P + facing · `lean_back`; to lean someone forward on a rail whose
  foot is at P (facing it): origin = P − facing · `lean_fwd_front`, scaled so `lean_fwd_top` meets the rail
  top. Two runs give byte-identical files.

`people_glb.mjs` runs `prune`, `quantize` (morph targets included) and `meshopt`, writes
`static/city/people.glb` and copies `people_meta.json` beside it: 2.20 MB (11 morph targets), 14,583
triangles for one of each person (about 1,200 each).

On the page (`src/lib/city/people.ts`) each variant is one InstancedMesh with the shared atlas material;
walkers pick a variant by a seeded weighted draw (uniforms at `UNIFORM_WEIGHT` 0.5 against a civilian's 1)
and show walk key `floor(phase · keys)` for phase = distance walked / (variant `cycle_m` × walker scale),
one key at 1 and the rest 0. Without `people.glb` or `people_meta.json` the page walks capsules instead.
More people stay put at the export's `idle_spots` and `talk_spots`, after the walkers in the same per-variant
InstancedMeshes (no extra draw calls):

- **Idle** (`planIdlers`, `idlerPose`): `IDLE_SITTERS` (12; `IDLE_SITTERS_MOBILE` 8) sitters and
  `IDLE_LEANERS` (3; `IDLE_LEANERS_MOBILE` 1: a tenth of the 28 and 12 there were) leaners, from a seeded
  shuffle of the spots, each kind `IDLE_GAP` (2 m) from its own kind, with a weighted variant pick and the
  walkers' height scale; their `sit`, `lean` or `lean_fwd` key is set once and never touched per frame.
  Neither kind fills in for the other. A sitter's origin is the ledge edge moved back `sit_edge` (scaled)
  along its facing and `sit_seat_h` (scaled) below the ledge top; a sit spot whose drop misses the picked
  person's seat height by more than `SIT_DROP_TOLERANCE` (0.12 m) is skipped. Of the leaners,
  round(`LEAN_FWD_SHARE` 0.5 × leaners) lean forward where the spot's `top` fits the picked person:
  `leanFwdScale` scales them (within the walkers' range) so `lean_fwd_top` meets the rail top, within
  `LEAN_FWD_TOLERANCE` (3 cm); they turn round to face the rail, their origin `lean_fwd_front` (scaled) out
  from it. The rest lean back, their origin the wall foot moved out `lean_back` (scaled). With v05's spots
  that is the same 8 sitters on mobile and 12 of the 13 that fit on desktop (the avenue's outer pavement
  edge, 100–160 m out), 2 forward leaners on the well railings and 1 back leaner on an avenue facade
  (mobile: 1 forward leaner).
- **Conversations** (`planConvos`, `convoTalkers`): `CONVO_GROUPS` (4) groups of a seeded `CONVO_SIZE` (2–5)
  people at distinct talk spots, each a different variant while the cast has any left, spaced round a
  circle about `CONVO_GAP` (0.95 m) apart (at least `CONVO_MIN_R` 0.55 m radius) and facing its centre,
  with a little seeded jitter in radius, angle and facing. Each group loops a seeded schedule of
  `CONVO_TURNS` (24) turns of `CONVO_TURN_S` (2.5–6 s): one talker per turn, a different one each turn, with
  a `CONVO_OVERLAP` (0.3) chance of a second chipping in, so never more than two at once. A talker steps
  between `talk` and `stand` in beats of `CONVO_BEAT_S` (0.5–1.1 s: talk, talk, stand…), everyone else
  stands; update() writes a member's key only when it changes. With v05's spots (`CONVO_SEED` picked for a
  spread) the groups are 2, 3 and 5 on the well walkway and 4 at the avenue's foot.

With `botSlots` (`MINIBOT_TALKERS`, 2) one member of that many groups is left out for a minibot (see
"Minibots"), so the people are 2 fewer; `People` also returns `walkers` (the minibots step round them).

Reduced motion freezes the scene clock, so the conversations hold their first beat. The capsule fallback and
an old (version 2) meta have no conversations or forward leans. `PEOPLE_PER_PATH` stays 30
(120 walkers; 40 per path took the frame to 1.54 M triangles when the idle people came in). With the robots,
at 2908×1271 desktop with shadows the frame peaks at 253 draw calls by day and 269 by night, and 1.432 M
triangles (scroll 0, 0.3, 0.6, 0.75, 0.85, 0.95, 1).

The pack is the user's own purchased asset. Like the hero, `people.glb` and `people_meta.json` are
git-ignored until the user approves the look and its use on the site.

## Robot

`export_robot.py` bakes the `/city` robots: `VARIANTS` (8) seeded mechs from the Mech_00 pack in `Assets/Robot`
and its Mech_00A expansion (FBX: modular skinned meshes, separate attachment meshes and an animation file, all
on the same 87-bone rig, 60 fps). It needs no .blend, only reads the pack and never writes to it:

```sh
cd concept-assets/city/generators
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/export_robot.py" \
  -- "$PWD/build/robot"                       # [out_dir] [assets=/run/media/.../Assets/Robot]
node robot_glb.mjs         # [in=build/robot/robot_raw.glb] [out=../../../static/city/robot.glb]
node --test test/robot_glb.test.js    # skip when static/city/robot.glb is absent
# contact sheets (build/robot/, git-ignored; Blender can't read meshopt, so decode.mjs writes a plain copy
# first): every variant in its palette, idle front / side / back and a walk frame three-quarter, then the walk
# of variant 0, side (ground stripes sliding at the meta speed) and front
node build/robot/decode.mjs ../../../static/city/robot.glb build/robot/robot_decoded.glb
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/build/robot/check_variants.py" \
  -- "$PWD/build/robot/robot_decoded.glb" "$PWD/../../../static/city/robot_meta.json" "$PWD/build/robot/variants_sheet.png"
flatpak run --command=blender org.blender.Blender --factory-startup -b --python "$PWD/build/robot/check_walk.py" \
  -- "$PWD/build/robot/robot_decoded.glb" "$PWD/../../../static/city/robot_meta.json" "$PWD/build/robot/walk_sheet.png"
```

- **Body sets**: six, `Base_S_`, `Base_M_`, `Base_L_` (`Char_Mesh/Mech_Char_Mesh.fbx`, with every shared
  `Core_*` part) and `Base(A)_S_`, `Base(A)_M_`, `Base(A)_L_` (`Mech_00A.fbx`), each a part for every slot
  (`Torso`, `Pelvis`, `Shoulder`, `Arm`, `Forearm` .L/.R, `Thigh`, `Leg`). All are weighted to the same bones
  and both files' rigs rest exactly where the animation file's does (only the unweighted `c_traj` root is
  turned), so any mix of sets plays the pack's actions. Every part carries an inverted-hull `OutLine` copy of
  itself (half its faces); those faces are deleted.
- **Attachments**: the pack's sockets are bones under the deform bones, one per size (`Shoulder_M_Attachment.L`,
  `Back_S_Attachment`, ...), and its prefabs place an item on a socket at identity, so an item's vertices go
  through the socket's rest matrix (scale dropped) and are weighted fully to the socket's parent bone (no action
  moves a socket against its parent). The socket's size follows the slot it sits on (`SOCKET_SLOT`: back on
  the torso, elbow on the forearm, knee on the leg ...). Rolled: `Attach_Armour_00`–`02` on shoulders, elbows,
  thighs or knees, `Attach_Module_00` / `_02` on shoulders or thighs (`ATTACH_FITS`; not `Module_01`, a thin
  cage that reads as noise at a distance) and `Attach_Back_JetPack_00` on the back. No weapons: `robot_rig.WEAPONS`
  (`Gun`, `Missile`, `Weapon`, `Sword`, `Hammer`) rules out the `LimbGun` forearms, `Attach_Gun_*`,
  `Attach_Back_*Gun`, the missiles, the weapon carrier and `Weapons/`.
- **Variants** (`robot_rig.roll_variants`, tested, `VARIANT_SEED` 7): each variant's main set comes round a
  shuffled list of the six (so all six lead one), 0–2 slots swapped for another set, one or two mirrored pairs
  of limb items and a jetpack 40% of the time, at most `VARIANT_MAX_TRIS` (5,000), and no two alike. Each is
  joined, in name order, into one mesh `ROBOT_V<i>` in metres. v05 result:

  | Variant | Main set | Swapped | Attachments | Triangles |
  |---|---|---|---|---|
  | `ROBOT_V0` | `Base(A)_M_` | | jetpack, module 02 on the shoulders | 4,452 |
  | `ROBOT_V1` | `Base_S_` | | jetpack, module 00 on the thighs | 3,428 |
  | `ROBOT_V2` | `Base(A)_L_` | torso `Base(A)_M_`, leg `Base_S_` | armour 02 on the elbows | 3,388 |
  | `ROBOT_V3` | `Base(A)_S_` | | armour 02 on the elbows | 3,430 |
  | `ROBOT_V4` | `Base_M_` | pelvis `Base(A)_M_` | module 02 on the shoulders | 3,366 |
  | `ROBOT_V5` | `Base_L_` | forearms `Base_S_` | armour 00 on the shoulders | 3,184 |
  | `ROBOT_V6` | `Base(A)_M_` | | armour 01 on the knees | 3,630 |
  | `ROBOT_V7` | `Base_S_` | arm `Base(A)_L_` | armour 01 on the shoulders, armour 02 on the elbows | 3,450 |

- **Rig**: the animation file's armature. Its object transform (90° about X, scale 0.01) is applied to the
  bones and the bone location keys scaled by 0.01; the actions' object-level curves are dropped. Bones no
  variant is weighted to (sockets, finger tips, `lookAt`, twist helpers) are deleted, keeping every ancestor
  of a weighted bone (`robot_rig.keep_bones`, tested): 43 of 87 remain. The rest pose is lowered 1.9 cm so
  the soles sit on y = 0 (the outline hull reached lower); every variant has the shared `Core_Feet`, so all
  soles agree (checked).
- **Animations**: `Mech_Walk` (in place, not `Mech_Walk_Root`) as `walk`, 70 frames = 1.1667 s, and
  `Mech_Idle` as `idle`, 80 frames = 1.3333 s, both sampled every frame with linear keys and looping (last
  frame = first). The robots' walk is the fluid one, played continuously on the page; the people's is
  stepped.
- **Material**: one `ROBOT_Mech` for every variant: a strip of `PALETTES` side by side (`robot_palettes.png`,
  9 × 80 × 48 px) as base colour with nearest filtering, roughness `ROUGHNESS` 0.85, metallic 0; the variants'
  UVs are squeezed into the first palette (u / 9), so the page picks palette k by offsetting u by k / 9. Each
  pack palette is two colour ramps and a grey one; the 47 `SimplePalette`s step round the hue wheel, and the
  pick is every 3rd–5th of them by main colour (red 0000, orange 0004, ochre 0007, green 0014, teal-green
  0020, cyan 0025, blue 0029, violet 0034; the pink and magenta mains past it left out as garish for a civic
  city) and `Gray_Col0025` (grey with orange). No emission: the palettes have no light cells.
- **Measures**: per variant: the bind (T) pose height (4.063 m for all: the shared head is the top, inside
  `HEIGHT_RANGE` 2.5–4.5 m), facing glTF +Z, the origin at the rig root between the feet. `walk_cycle_m` is
  measured from the planted feet (`robot_rig.stance_cycle_m`, tested): a foot bone within `CONTACT_EPS` (5 mm)
  of its lowest slides back at the ground speed in the in-place walk, so the mean slide over neighbouring
  planted frames times the loop's 70 frames is 3.69 m per loop (3.16 m/s; the pack's own `_Root` walk moves
  3.52 m, and its feet slip a little). It is measured per variant, and comes out the same for all eight: the
  sets only change the meshes on the same foot bones. At that speed a planted foot drifts at most 2.1 cm
  against the ground per stance (`robot_rig.skate_m`). Some foot is on the ground in every walk frame: the
  lowest vertex stays at y = 0.
- **Outputs** (`build/robot/`): `robot_raw.glb` (`ROBOT_Rig` armature, skinned `ROBOT_V0`–`ROBOT_V7`,
  animations `walk` and `idle`), `robot_palettes.png` and `robot_meta.json` `{version: 2, height,
  walk_cycle_m, walk_duration_s, idle_duration_s, palettes: [name], variants: [{name, height, walk_cycle_m,
  tris, main, slots, attachments: [[item, socket]]}]}` (the top-level height and walk_cycle_m are variant
  0's). Two runs give byte-identical files.

`robot_glb.mjs` runs `prune`, `dedup`, `weld`, `lod`, `resample` (drops keys a linear blend of their
neighbours gives within 1e-4; walk 9,159 → 1,763 keys, idle 10,449 → 1,021), `quantize` and `meshopt`, writes
`static/city/robot.glb` and copies `robot_meta.json` beside it; two runs give the same bytes. `lod` adds a
`ROBOT_V<i>_LOD` node beside each variant for the minibots (see "Minibots"): the variant's primitive on the same
skin with a meshopt-simplified index list, down to `LOD_RATIO` (0.2) of the triangles while within `LOD_ERROR`
(0.002 of the mesh's extent, 8 mm on the 4 m bake; seams kept, so the palette regions stay). The error decides:
1,590–2,540 triangles a variant, 50–65% (V0 2,540, V1 1,856, V2 1,954, V3 1,867, V4 1,685, V5 1,590, V6 2,036,
V7 1,921). 0.01 took the thin rods of the legs and arms, leaving the parts floating apart. With the LODs the glb is
716 KB (43,777 triangles in all; it was 446.7 KB and 28,328). `test/robot_glb.test.js` checks the LODs (one per
variant, skinned, 40–75% of the triangles, bind bounds within 2 cm of the full mesh's) and that every mesh binds
consistently (each joint of a vertex puts it in the same rest place).

On the page (`src/lib/city/robot.ts`) `ROBOT_COUNT` (2; set it to 1 for a single robot) robots cross the
view on the export's `robot_routes` (see "Robot routes"; none without them). Each is a skeleton clone of the
glb with its own material (the palette offset) showing one variant mesh at a time. A pass: a variant and a
palette (`pickIndex`: not its own last ones nor the other robot's), a direction (its points as stored, screen
left to right, or reversed) and a free route, preferring one the camera sees at the current frame (a `view`
sample within `ROUTE_VIEW_SLACK` 5 frames) and weighted by nearness to the camera (`routeWeight`: 1 / d² of
its nearest point, `ROUTE_NEAR_POWER` 2, so `street_57` beats each far route about 30 to 1; `pickRoute`), all
from `mulberry32(ROBOT_SEED + i)`. A route the other robot is on is free when, setting off then or after a
hidden wait of up to `ROBOT_FOLLOW_WAIT` (12 s, in 0.5 s steps), this one stays `ROBOT_FOLLOW_GAP` (12 m)
from it all along (`passesApart`: following it the same way, or on only once it is off for the other way);
then it walks the route from end to end (both ends are hidden) at the variant's
`walk_cycle_m / walk_duration_s`, on the polyline's ground (riding the 0.6 m kerb on `street_57`), its
heading the chord ±`ROBOT_TURN_LOOK` 1.5 m so it turns smoothly round the ring arcs (`routePose`). The paused
`walk` clip's time follows the distance walked at the variant's stride (`robotWalkTime`), driven by the
scene clock like the people (frozen with reduced motion). Off the far end it is hidden for
`ROBOT_RESPAWN_GAP` (0.5–3 s) and the next pass is rolled. The first pass starts part of the way along, so
the two don't set off together. At night the palette glows at `ROBOT_NIGHT_GLOW` 0.15 so it reads against
the dark trees. Without `robot.glb` or a version-2 `robot_meta.json` there is no robot (`loadRobotAsset`,
tested). Each robot adds 2 draw calls (main + shadow) and up to 4,452 triangles each; with both at 2893×1271
(desktop, shadows) the page peaks at 253 draw calls by day, 269 by night, and 1.458 M triangles (with both
on `street_57` at frame 53, 2908×1215: 254 / 268 calls, 1.432 M triangles). In v05 a
pass takes 18–23 s; `street_57` passes about 70 m from the camera (a robot about 70 px tall at 720p), the
other four 370–420 m out (about 12 px, too small to tell the variants apart), hence the weighting: simulated
over 100 min at a frame that sees all five, 71% of the robots shown are on `street_57`, both robots are on it
together 29% of the time and neither 7%, and passes go either way about equally. No route is in view before
frame 96 (the first ~60% of the scroll), where the camera looks down into the well and at its stepped rim:
there is no avenue or street in the frame to cross.

The pack's licence allows its use in projects but not redistributing it as a standalone asset. Like the
people, `robot.glb` and `robot_meta.json` are git-ignored until the user approves the look.

## Minibots

Person-sized mechs from the same `robot.glb` taking part in the people's things (`src/lib/city/minibots.ts`).
No export of their own: they use the bake's `ROBOT_V<i>_LOD` meshes (see "Robot") and its `walk` and `idle`
clips, and the hero's `walk_paths` and `talk_spots`.

- **Who**: `MINIBOT_WALKERS` (6; `MINIBOT_WALKERS_MOBILE` 4) walk the walk paths, round robin over the four,
  spread over each path's there-and-back cycle; `MINIBOT_TALKERS` (2) stand in conversations (`planMinibots`,
  tested, seeded per bot from `mulberry32(MINIBOT_SEED + i)`). Each is a variant and palette (every variant and
  palette comes round before any repeats) and a height, `MINIBOT_HEIGHT` 1.2–1.8 m for a walker,
  `MINIBOT_TALK_HEIGHT` 1.25–1.6 m in a conversation (the bake scaled by height / 4.063).
- **Where they walk**: a walker paces the first `MINIBOT_WALK_RANGE` (120 m) of its path from the plaza end,
  there and back (a loop is walked whole), spread over that cycle. The paths run 600 m up the avenue, where a
  1.5 m bot is a few pixels; over the first 120 m (40–160 m from the camera) it is 25–100 px tall at 1271 px.
  Sampled every 10 s over 1200 s, some walker is over 40 px tall 97% of the time at frames 1, 51, 76 and 88
  (was 32%, 33% and, at frame 101, 10% on the whole paths); from frame 101 they are below the frame.
- **Walking**: at the variant's own stride, scaled (`walk_cycle_m` × scale per `walk_duration_s`: 0.93–1.40 m/s,
  inside the people's 0.9–1.5), so the walk clip plays at its own rate and its time follows the distance
  walked (`robotWalkTime`): no foot slide. They ping-pong like the people (within their range). A walker steps aside
  round the people on its path (`dodgeOffset`, tested): from each one whose sideways place is within
  `MINIBOT_DODGE_R` (0.8 m) it is pushed to that distance, in full within `MINIBOT_DODGE_NEAR` (1 m) along the
  path and easing out to `MINIBOT_DODGE_FAR` (3 m), clamped to `MINIBOT_LANE_MAX` (0.8 m) from the path line
  (the lamps stand 1.83 m out, a tree 1.03 m, the idle people 2 m). It is a function of the clock and the
  people's own (stateless) walk, so it replays and freezes with them. Over 300 s a walker overlaps someone 1.6%
  of the time (6.8% without the dodge; people overlap each other 1.7%).
- **Conversations**: `createCharacterPeople` with `botSlots` leaves out one member of each of that many
  conversations (`pickBotSlots`, tested: groups of three or more first, so a group keeps two people; in each
  the member whose nearest neighbour stands furthest off, as a mech's arms reach about 0.87 m from its place)
  and returns their places as `slots`; a minibot stands there facing the circle's centre, playing `idle` from a
  seeded phase. When its turn to talk comes round the others listen. The page asks for slots only when
  `robot.glb` has the LOD meshes and the `walk` and `idle` clips (`canMakeMinibots`, tested), so a bake
  without them leaves no empty places.
- **Sitting**: not done. The mech's arms are as long as its legs (its fists hang by its knees), so a seat on
  a ledge needs the fists placed on the ledge or in its lap, which bone turns alone don't give; and the sit
  spots are 100–160 m up the avenue, where a 1.4 m bot is a few pixels tall.
- **Drawing**: all of them are one InstancedMesh, one draw call (and one in the sun shadow pass on desktop),
  whatever variants are out. The variants out are baked into a float vertex texture (4 texels a vertex: bind
  position + u, normal + v, joints, weights; `bakeVariant`) with a corner list per variant; per instance
  `mbInfo` holds its variant's corner offset and count and its palette's u offset. The vertex shader
  (`onBeforeCompile` on the robots' material and on a depth material for the shadows) skins corner
  `gl_VertexID` of its variant with the instance's row of a bone texture (43 bones × 4 texels per bot); corners
  past the variant's own count collapse to a point. Each frame one shared rig is posed for each bot in turn and
  its skin matrices (modelMatrix · bindMatrixInverse · bone · boneInverse, `boneRows`) copied into the bot's row:
  the same sum three's own skinning makes (`skinBaked`, tested against `SkinnedMesh.applyBoneTransform`);
  when the clock hasn't moved (reduced motion) nothing is posed again. The
  instance's triangles are the largest variant's out (2,540 with V0), so 8 bots draw 20,320 in the main pass and
  as many in the shadow pass. At night the palette glows at `ROBOT_NIGHT_GLOW` like the robots'.

Measured at 2908×1271 (desktop, shadows) over the whole scroll in 0.05 steps, with the drones: peak 261–264 draw
calls by day and 276–279 at night over separate sweeps (the base was 255 / 269: drones and minibots together add
about 9 by day and 10 at night, the rest is where the robots and drones happen to be), 1.474 M triangles at most.
On mobile they add 1 call. The conversation minibots are in view from frame 1 to about frame 109 (at the well,
100–260 px tall at 1271 px), the walkers from frame 1 to about frame 100; from about frame 110 on (scroll below
0.55, the camera looking down into the well) no minibot is in the frame.

## Drones

The delivery drones need no asset: `src/lib/city/drones.ts` builds a low-poly PSX-style quadcopter in code
(`droneGeometry`: a six-sided hull with a waist band, a raised spine and a camera pod, a stripe under the
belly and a chevron on the nose and under the belly, four arms on the diagonals with motors and caps, two
skids; 1.2 m across the motors, 1.7 m across the rotors, flat shaded, every vertex tagged with its livery
piece) and its rotor
blur (`rotorGeometry`: a translucent disc, darker at the rim, with one blade ghost across it and a guard
ring round it, spun in steps of
`DRONE_ROTOR_STEP_ANGLE` `DRONE_ROTOR_STEPS` times a second, neighbours opposite ways). They fly over the
export's `drone_spots` and `drone_sky` (see "Drone spots"); without the spots there are none.

`DRONE_COUNT` (6) drones each fly one trip after another (`planTrip`, tested), seeded per drone
(`mulberry32(DRONE_SEED + i)`), each trip a delivery or a pickup:

- **Delivery or pickup** (in `createDrones`): parcels a delivery sets down stay on their spots until a pickup
  collects them. Each can be collected `DRONE_PICKUP_WAIT` (20–60 s, per parcel, from when it touches down)
  later. A drone setting off collects one that is ready, on a spot the camera sees and not within
  `DRONE_SPOT_GAP` of another drone's spots, with `DRONE_PICKUP_CHANCE` (50%), weighted by distance as
  `pickSpot`; otherwise it delivers. When `DRONE_WAITING_MAX` (7) parcels lie about or are on their way
  (deliveries flying), it must collect a ready one (one in view first, else any), and with none ready it
  idles hidden for `DRONE_IDLE_S` (4 s). A delivery never goes to, or takes off from, a spot holding a
  parcel or another drone's spot (`taken`), and within the drones the spot gap is hard: with no spot left,
  it idles. `DRONE_WAITING_START` (3) parcels already lie about at the start (seeded, on spots in view at
  the first frame if any), so the plaza is not bare for the first minute.
- **Drop spot** (`pickSpot`): never a `taken` spot (-1 if every spot is); not within `DRONE_SPOT_GAP` (12 m) of another drone's drop or take-off spot (so
  at most two drones work round the well at once); one the camera sees at the current frame if any (a `frames` sample within `DRONE_VIEW_SLACK` 5 frames), weighted by 1 / distance from the
  camera (`DRONE_NEAR_POWER` 1, at least `DRONE_NEAR_MIN` 15 m), so the near spots come up more without the
  far roofs dropping out.
- **Start**: `DRONE_TAKEOFF_CHANCE` (35%) of trips take off from a spot the camera doesn't see at the frame, at
  least `DRONE_TAKEOFF_MIN` (60 m) away (landed on its skids, rotors spinning up for `DRONE_SPINUP_S`, then a
  vertical climb paying the line out); the rest come in at cruise height from a point `DRONE_FAR` (220–320 m)
  out (`farPoint`): of `DRONE_BEARING_TRIES` (12) random bearings, the one the camera's frustum doesn't contain
  with the lowest sky on the straight line in, so the cruise can stay low. The exit point is picked the same way.
- **Cruise**: at `DRONE_SPEED` (10–14 m/s) with `DRONE_ACCEL` (2.5 m/s²) at both ends (`moveDuration`,
  `easedDistance`: from rest to rest). The height is one per trip: `DRONE_CRUISE_AGL` (25–40 m) above a ground
  drop (`DRONE_ROOF_AGL` 10–18 m above a roof), raised so both legs clear the sky grid by `DRONE_SKY_CLEAR`
  (8 m) within `DRONE_RADIUS` (1 m) of the path (`skyMaxAlong`).
- **Glide in** (`pickGlide`, `glideClear`): the inbound quadratic Bezier ends tangent to a straight glide down
  to `DRONE_HOVER_H` (5 m) over the spot, `DRONE_GLIDE_RATIO` (2.5) metres out per metre lost, on the first of
  `DRONE_GLIDE_TRIES` (8) bearings whose glide stays `DRONE_GLIDE_CLEAR` (3 m) above the sky grid (but for its
  last `DRONE_GLIDE_FREE` 8 m, the column the export checked) and that the camera sees half way down, else the
  first clear one. The drone flies the curve and the glide as one move, braking only at the end. With no clear
  glide the curve, bowed sideways by up to `DRONE_BEND` (0.3) of its length, ends over the spot, and the drone
  stops (`DRONE_STOP_S`) and descends straight at `DRONE_DESCENT_SPEED`.
- **Delivery**: a settle at the hover, the parcel (`DRONE_PARCEL_W` × `DRONE_PARCEL_H`, on a `DRONE_TETHER` 0.5 m
  line in flight) winched down at `DRONE_WINCH_SPEED` (1.2 m/s) until it sits on the spot, released (it stays
  there, waiting for a pickup), the empty line winched up, then the climb back to cruise height, turning
  to the way out, and the cruise out.
- **Pickup** (`planTrip` with `pickup`): the delivery run backwards at the hover. The same flight in
  (entry or take-off, cruise, glide) with no line out, then at the hover the drone turns square to the
  parcel (`squareYawNear`: the nearest quarter turn, a box looks the same), lowers the empty line to the
  parcel's top, hooks it (`DRONE_RELEASE_S`), winches it up to `DRONE_TETHER` and carries it off: the climb,
  turning to the way out, and the cruise out of view. The parcel lies on its spot until the hook (drawn by
  the pickup drone from the moment the trip is planned, even in its hidden gap) and never jumps.
- **Liveries** (`DRONE_LIVERIES`, `liveryColours`, tested): ten made-up delivery companies (Tidewater Post,
  Lantern Express, Coral Couriers, Kelpline, Abyss Freight, Pearl Line, Harbour Hop, Gullwing, Current Mail,
  Saltmarsh & Sons), each a strong hull, a contrasting trim (the waist band, which is the belly the camera
  sees from below, and the arms), a mark (a stripe down the spine and under the belly, a chevron on the nose
  and under the belly, or both; a mark a livery hasn't takes the colour it lies on), rotor guards and motor
  caps, and its parcel colour and tape. Rolled per trip, seeded (never the drone's last one twice running);
  a pickup flies the livery of the parcel it collects, so a company collects its own. No extra draw call:
  the bodies read each vertex's piece (`liveryPiece`, `LIVERY_PIECES`) from a 8 × 10 float texture
  (`liveryTexture`: a row a livery) on the instance's row (a per-instance `livery` attribute), patched into
  the standard material's `color_vertex`; the rotor guards are white vertex colours times the instance
  colour (the caps colour); the parcels take the instance colour and a per-instance `tape` colour, laid by
  the fragment shader as a band 0.18 of the box wide round both ways (a cross on top, down the four sides).
- **Pose** (`tripPose`): the heading follows the cruise curve and turns over the stops; the drone leans with
  its acceleration (a central difference over 0.3 s divided by g, at most `DRONE_TILT_MAX` 0.4 rad), so it
  noses down speeding up, back braking, and banks into the curves; in the air it wobbles by `DRONE_WOBBLE_M`
  and `DRONE_WOBBLE_TILT`. A hanging parcel never sinks into the drop spot.
- **Gaps**: off the exit point a drone is hidden for `DRONE_RESPAWN_GAP` (1–6 s) before its next trip. The
  first trips start part of the way through.

Everything is a function of the scene clock, so reduced motion freezes the drones (and their rotors) like the
people and robots. All drones are four InstancedMeshes: bodies (with sun shadows on desktop), rotor discs
(transparent, no depth write, no shadows), parcels, lines and the `DRONE_WAITING_MAX` waiting parcels (one
unit box scaled per instance; shadows) and
nav lights (red on the port front motor, green starboard, a white strobe on the tail flashing
`DRONE_STROBE_ON` 0.1 s every `DRONE_STROBE_PERIOD` 1.3 s; unlit HDR colours above the bloom threshold, shown
only at night, scaled by mixMode's emissive level). That is 5 draw calls by day with shadows (3 on mobile) and
6 at night, and about 3,700 triangles in the main pass (444 per body, 32 per rotor with its guard, 12 per
parcel), about 6,600 with the shadow pass. Measured at 2908×1271 (desktop, shadows) over the whole scroll in
0.02 steps with the pickups and liveries: peak 262 draw calls by day and 278 at night (unchanged), 1.475 M
triangles (was 1.473 M).

Simulated in the page over 900 s at scroll 1 (frame 1) in 0.5 s steps: 34 deliveries and 34 pickups, 2.2
parcels waiting in view on average (besides those under a drone's own trip). A parcel leaves the ground
only on a pickup's hook (tested over 1,200 s on a 12-spot plaza: never two on a spot, at most
`DRONE_WAITING_MAX` waiting, every pickup in the livery of the parcel it collects).

The camera stands on the plaza in a canyon of 40–58 m buildings, so a drone cruising over the rooftops is
above the frame unless it is far down the avenue: hence the entry and exit points over the lowest sky (the
open avenue, the plaza behind the camera) and the glides in, chosen seen. Over a 300 s sweep, the frustum
holds on average 2.1 drones at scroll 1 (frame 1), 1.7 at scroll 0.9, 1.5 at 0.8 and 0.3 at 0.7; from about
scroll 0.62 (frame 96) the view is only the well and its deck, and no drone is in it: the first ~60% of the
page (scroll 0 is frame 250, the "Welcome to Atlantis" well) shows no drones. A flight across the well would
cross that title view; not done. Plans depend on the
order of the updates (a drone sees the others' trips as they stand when it plans), as for the robots; when
the clock goes back the drones start afresh from their seeds, so the same steps replay the same.

## The Lantern's energy and calmer nights

Runtime only (`src/lib/city/lanternBeam.ts`, wired up in `CityHeroScene.ts`; no re-export). The Lantern's heart is
`NBHD_core_lantern`'s `NIGHT_MAT_AP_Cyan` mesh: a capped cylinder r 29 m from y 284 to 484 m (glTF), with the
stone shaft (`HERO_MAT_AP_Stone`, r 28 to 25 m) running up inside it. At load, `findLanternHeart` finds it from
`night_nodes`, and:

- the heart becomes a glass tube: transparent at `LANTERN_HEART_OPACITY` 0.75, double-sided, no depth writes;
- the Lantern's other meshes get their own material clone that discards fragments inside the heart's cylinder
  (2 m in from its ends), so the shaft is cut away there; same draw calls;
- the heart glows by day too: emissive `LANTERN_DAY_GLOW` 0.4 by day to `LANTERN_NIGHT_GLOW` 0.3 at night (in
  place of its export strength 4, which blew it out to white and would hide the energy);
- inside it run the Magitech Look Lab's powerline spans (its `waveSpan` with `add: true, disc: false`, "Lantern
  Lines" cyan hue 186): `ENERGY_SPANS` 3 spans up the axis, 120° apart, each twisting 135° from bottom to top,
  each the lab's four aurora curtains (two up, two flipped down; bright wavering edge, upward rays, travelling
  pulses, RGB-split fringe, vertex fold; no audio), with its edge 0.45 H off the axis so the curtains cross it
  and fill the tube. `RUNES_PER_SPAN` 4 morphing molecular runes ride each span's pulse crests (the lab's
  `molecule()` / `drawMorph()`, a new molecule every 1 / `MORPH_RATE` s; each rune's molecule per beat is
  seeded, so the energy is a pure function of the scene clock and reduced motion shows one static frame). The
  spans' pulses are staggered by a third of a crest so their runes don't line up. Scaled to the heart: curtain
  height 0.95 × 0.9 r, fold 0.12 H, `PULSES` 20, `PULSE_SPEED` 1.5 (runes climb at 0.075 spans/s), rays 28 per
  span (the lab's 70 alias at the Lantern's 2.4 km), runes 7% of the span. Intensity `ENERGY_DAY_I` 1.1 by day,
  `ENERGY_NIGHT_I` 1.3 at night (the lab's night 1.65 calmed down). Additive curtains, normal-blended runes,
  drawn after the heart (`renderOrder` 1) so they read through its glow.

All curtains are one mesh (12 × 64 segments: 1,536 triangles) and all runes one InstancedMesh of unit boxes
(at most 12 × `RUNE_CAP` 56, 12 triangles each; typically 50–120 boxes); culled with the heart, so they cost
nothing where the Lantern is out of view (frame 250 and most of the scroll). The heart's second (back-face)
pass adds one call where it is in view. Measured at 2908×1271 (desktop, shadows) over the whole scroll in 0.02
steps: peak 266 draw calls by day and 282 at night (was 262 / 278), 1.479 M triangles (was 1.475 M).

Night glows: every night glow is scaled by `NIGHT_GLOW_SCALE` 0.6 (`night.ts`): the `NIGHT_` emissives
(windows, lamps, well ring), the robots' and minibots' `ROBOT_NIGHT_GLOW`, the drones' nav lights and the
water's glints of the well lights. The lit windows (`NIGHT_MAT_AP_Void`, `NIGHT_MAT_AP_Clerestory`) take
the lower `NIGHT_WINDOW_SCALE` 0.3 instead: they are large flat panes that ACES tone mapping still shows as
near-white rectangles at 0.6, while at 0.3 they read as calmer warm light. Bloom is gentler: `NIGHT_MIX.bloom` 0.4 (was 0.6) and the threshold scaled
with the glows (2.0 × 0.6 = 1.2), so the same lights bloom, with about 40% of the old bloom energy. The well
ring at frame 250 no longer washes out "Welcome to Atlantis".

## Cull unseen objects (v06)

`oneoff/cull_unseen.py` tidies a scene by moving every object the hero camera never sees into a collection
`_culled` (excluded in every view layer, render-hidden; tick it back on in the outliner to see them). Nothing is
deleted: each moved object keeps its original collections in the custom property `cull_from` (`A;B`, empty for
the scene collection), and `restore(scene)` in the script links them back.

```sh
flatpak run --command=blender org.blender.Blender --factory-startup -b ../Atlantian_plaza_blockout-v06.blend \
  --python "$PWD/oneoff/cull_unseen.py" -- --dry-run --log "$PWD/build/cull/culled.json"
```

`--dry-run` only writes the log (every culled object with its collections and bounds, counts per top-level
collection, what was protected); without it the script also applies the cull and saves the file in place
(compression kept, no relative-path remap, no `.blend1`). It refuses to save when the culled share of the
candidates is outside 5–95%. Copy the .blend to a `*_before-cull.blend` first. A `--log` outside the
flatpak's reach (e.g. under `/tmp`) needs `flatpak run --filesystem=<dir>`.

Seen means: the world AABB of the evaluated object (modifiers applied; an instancer by everything it
instances) is inside one of the frusta of `Camera.001` every half frame 1–250 plus the page's floor drop (the
frame-1 camera straight down to the floor, levelling), at every `hero_geom.cull_aspects` aspect with the widest
safe frame, far ≥ `clip_end`, `CULL_MARGIN` on the FOVs and every plane pushed out by `MARGIN_M` (30 m). So it
is a superset of what `export_hero.py` keeps. Hierarchies move whole, and a tree stays if any member is seen or
protected: cameras, lights, the objects the export reads by name (camera, `Text`, the Lantern, the well collar
and ring lights, `KIT_Ave_walk`), anything already hidden (templates, `05_TEMPLE`), members of instanced
collections, and anything another ID references (boolean cutters, node trees, drivers).

v06 (the run that made `Atlantian_plaza_blockout-v06_before-cull.blend`): 1,022 of 4,025 objects culled
(`20_NBHD_OUTER` 590, `21_NBHD_BELT` 353, `28_AVENUE_VERNACULAR` 74, `06_DOCKS_MARSH` 5), the city behind
and beside the camera. The hero export of the culled file matches the uncut one: same `hero_props.json`, same
glb binary chunk, accessors, meshes and materials; only the `HERO_tree_*` node names differ, whose suffix is the
depsgraph instance index (`export_report.json` `instances` and `dropped_frustum` drop by the culled count,
`in_frustum` and `kept` are unchanged). Tests: `python3 -m unittest discover -s test -p "test_*.py"`
(`test/test_cull_unseen.py`).

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
