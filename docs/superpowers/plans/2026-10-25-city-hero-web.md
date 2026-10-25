# City Hero for the Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/city` page that plays the Blender hero camera move in reverse as the visitor scrolls (well → avenue), from a culled, AO-baked glb exported from v05, with a procedural cloud sky, a day/night toggle, circling blimps, moving well water and walking people.

**Architecture:** Three stages:
1. `export_hero.py` runs in the live Blender (Blender MCP) on v05 and writes a raw glb plus `hero_props.json`. It does the culling, realising, joining, LOD, AO bake, night markers, lamp posts and camera bake, and never saves the .blend.
2. `hero_glb.mjs` (glTF-Transform, node) post-processes the raw glb: dedup, instancing, weld, meshopt and quantize. It writes `static/city/hero.glb`, which stays git-ignored until the user approves it.
3. The SvelteKit route `/city` mounts `CityHeroScene` (Three.js). The scene scrubs the glb's camera animation from the scroll position, draws a shader sky and runs the night mode and the moving things.

Pure logic lives in small modules with unit tests:
- Python: `hero_geom.py`, tested with `python3 -m unittest`.
- Site TS: `src/lib/city/*.ts`, tested with vitest.

**Tech Stack:**
- Blender 5.2 (Flatpak) via the Blender MCP, Python/bpy, Cycles AO bake.
- Node with `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions` and `meshoptimizer`.
- SvelteKit 2 / Svelte 5 with adapter-static.
- `three` ^0.184: GLTFLoader, MeshoptDecoder, EffectComposer/UnrealBloomPass, PMREMGenerator.
- vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-city-hero-web-design.md`

## Global Constraints

- **Paths:**
  - repo worktree `/run/media/dracky/e97d0aa9-5c45-460a-a682-b57cd6302030/Projects/atlantis-site-hero` (branch `city-hero`);
  - generators `concept-assets/city/generators/` (`gen/` below).
- **Blender:** the live session has `concept-assets/city/Atlantian_plaza_blockout-v05.blend` open from the *main* checkout (`Projects/atlantis-site-fork`). Blender work goes through `mcp__blender__execute_blender_code`. Exec a script with `exec(open(PATH).read(), {...,"__name__":"eh"})`, the same pattern as `build_city.py`.
- **v05 is never saved and never changed.** `export_hero.py` must leave the scene as it found it:
  - it works in a scratch scene or collection that it deletes afterwards, or on evaluated copies;
  - after it runs, the object count and the `Camera.001` keys are unchanged;
  - the user's unsaved state stays intact.
- **Never touch** `concept-assets/city/Atlantian_plaza_blockout-v01.blend` in the main checkout.
- **Hero camera:** `Camera.001`, parent `Rig_Gimbal`, frames 1–250 at 24 fps, lens 34 mm, clip 0.2–8000, render 1280×720.
- **Coordinates:** scene = plan + `build.json` `center` (0, 1168).
- **Scroll mapping:** scroll progress 0→1 maps to frames **250→1**.
- **Safe frame:**
  - At 16:9 the field of view is exactly the Blender camera's.
  - Narrower screens widen the vertical FOV so the safe frame's width stays in view. The safe frame is the "Welcome to Atlantis" text width at frame 250 and the avenue width at frame 1, stored as half-width tangents in `hero_props.json`.
  - Wider screens keep the vertical FOV.
- **Cull aspects:** 16:9, 21:9, and portrait 9:19.5 under the safe-frame rule, plus a margin.
- **Night list, and only these:**
  - `MAT_AP_Void` (warm windows);
  - faces using `MAT_AP_Glow` or `MAT_AP_Clerestory` (light bands);
  - objects named `KIT_Temple_lantern*` with cyan;
  - the well ring lights;
  - the new lamp posts.

  `MAT_AP_Cyan` elsewhere (canals!) never glows.
- **Budget:**
  - `hero.glb` plus `hero_props.json` ≤ **10 MB**;
  - ≤ 300 draw calls;
  - ≤ 1.5 M triangles on screen at frame 1;
  - pixel ratio capped at 1.5;
  - sun shadows near the camera, desktop only.
- **Only reviewed exports are committed:**
  - `static/city/*.glb` and `static/city/hero_props.json` are git-ignored;
  - raw exports go to `gen/build/hero/`, which is already ignored via `build/`;
  - the final glb is committed (`git add -f`) **only after the user approves the look**.
- **Git:**
  - stage explicit paths only; never `git commit -am`, `git stash`, `git checkout -- <path>` or `git reset`;
  - commit locally per task and never push;
  - commit trailer:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01B3tKFTzg4QwUxTiMAuM1K7
    ```
- **Site code style:** TypeScript, Svelte 5 runes, tabs, `#lib/...` imports. Follow `src/lib/dice/DicePreviewScene.ts` (class owning renderer, scene, timer and RAF loop, with `destroy()`) and `src/routes/ladyofcode/dice-themes/+page.svelte` (canvas bound with `$state`, scene created in `onMount`).
- **Commands:**
  - site tests `pnpm vitest run`;
  - site checks `pnpm check` and `pnpm build`;
  - generator tests `cd gen && node --test "test/*.test.js"` (162 today; must stay green);
  - Python tests `cd gen && python3 -m unittest discover -s test -p "test_*.py"`.

- **Red, green, refactor:** every code task runs failing test → minimal code → **refactor** before its commit
  step. The refactor step looks for:
  - logic duplicated between modules (the safe-frame rule exists in `hero_geom.py` and `heroCamera.ts` by
    design; keep both formulas identical and cross-reference them in comments);
  - magic numbers that belong in a constants block at the top of the file (cull margin, band distances, AO
    settings, lamp spacing, night colours, people counts);
  - patterns to bring in line with `DicePreviewScene` and `build_city.py`;
  - names.

  Re-run that task's tests after refactoring.

## Review Focus

1. **Portrait phone at scroll 0:** "Welcome to Atlantis" is fully visible, because the safe frame widens the vertical FOV. Pinned by a `safeFrameFov` test in Task 1 and a portrait screenshot in Task 6.
2. **Scrolling back up mid-move:** the camera returns to exactly the frame for that scroll position, with no drift from easing. Pinned by the `scrollToFrame` and `easeToward` tests in Task 1.
3. **Any scroll position at any aspect has no holes:** geometry at the frustum edges is kept. Pinned by the `hero_geom` cull tests in Task 2 and a 10-position × 2-aspect screenshot sweep in Task 6.
4. **Night never lights the canals:** pinned by the glb test "no emissive marker on CANALS_*/MAT_AP_Cyan outside the Lantern" in Task 4.
5. **Second run of the export leaves v05 unchanged:** same object count, same camera keys. Pinned by the Blender post-check in Task 3.

---

## Milestone 1: scroll page (day)

### Task 1: Site test runner and the camera maths

**Files:**
- Modify: `package.json` (add devDependency `vitest`, script `"test": "vitest run"`)
- Create: `src/lib/city/heroCamera.ts`
- Test: `src/lib/city/heroCamera.test.ts`

**Interfaces:**
- Produces:
  - `scrollToFrame(progress: number, start = 1, end = 250): number`
    - Clamps progress to [0,1].
    - Returns `end + (start - end) * progress`: 0→250, 1→1.
  - `frameToTime(frame: number, fps = 24, start = 1): number`
    - Returns `(frame - start) / fps`, seconds into the glb animation.
  - `safeFrameFov(aspect: number, baseVFovDeg: number, safeHalfTan: number): number`
    - Returns the vertical FOV in degrees.
    - `baseVFovDeg` is the Blender camera's vertical FOV at 16:9.
    - `safeHalfTan` is tan of half the horizontal angle that must stay visible.
    - Result: `max(baseVFovDeg, 2*atan(safeHalfTan / aspect))` in degrees.
  - `easeToward(current: number, target: number, dt: number, rate = 8): number`
    - Exponential approach: `target + (current - target) * exp(-rate*dt)`.
    - Snaps to target when within 1e-3 frames.

- [ ] **Step 1: Write failing tests** in `heroCamera.test.ts`:
  - `scrollToFrame(0)===250`, `scrollToFrame(1)===1`, `scrollToFrame(0.5)===125.5`, `scrollToFrame(-1)===250`, `scrollToFrame(2)===1`.
  - `frameToTime(1)===0`, `frameToTime(250)` ≈ `249/24`.
  - `safeFrameFov(16/9, 33.4, tan(halfH))` equals 33.4 when `halfH` is the 16:9 half-angle.
  - At `aspect = 9/19.5`, `2*atan(tan(vfov/2)*aspect)` (the horizontal FOV) ≥ `2*atan(safeHalfTan)`.
  - At `aspect = 21/9` it returns `baseVFovDeg`.
  - `easeToward(0, 10, 10)===10` (snaps).
  - `easeToward(0,10,0)===0`.
  - Repeated calls converge monotonically and never overshoot.
- [ ] **Step 2:** `pnpm add -D vitest`, then `pnpm vitest run src/lib/city`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `heroCamera.ts`.
- [ ] **Step 4:** `pnpm vitest run` → PASS, then `pnpm check` → no new errors.
- [ ] **Step 5:** Commit `package.json pnpm-lock.yaml src/lib/city/heroCamera.ts src/lib/city/heroCamera.test.ts`: "City hero: camera maths".

### Task 2: Cull geometry (pure Python)

**Files:**
- Create: `gen/hero_geom.py` (no bpy/mathutils imports; plain tuples)
- Test: `gen/test/test_hero_geom.py`

**Interfaces:**
- Produces, used by Task 3:
  - `frustum_planes(pos, fwd, up, vfov_rad, aspect, near, far, margin=0.0) -> list[tuple[nx,ny,nz,d]]`
    - Returns 6 inward-facing planes.
    - `margin` widens both FOVs by that many radians.
  - `aabb_in_frustum(lo, hi, planes) -> bool`
    - Conservative: false only when the box is fully outside one plane.
  - `safe_vfov(aspect, base_vfov, safe_half_tan) -> float`
    - Radians; the same rule as the TS `safeFrameFov`.
  - `cull_aspects(base_vfov, safe_half_tan) -> list[tuple[aspect, vfov]]`
    - For 16/9, 21/9 and 9/19.5.
  - `sample_frames(start=1, end=250, step=5) -> list[int]`
    - Always includes `start` and `end`.

- [ ] **Step 1: Write failing tests:**
  - A box straight ahead is in.
  - A box behind the camera is out.
  - A box just past the right edge is out at margin 0 and in at margin 0.05.
  - A box beyond `far` is out.
  - A box straddling a plane is in.
  - `safe_vfov(9/19.5, …)` keeps the safe half-width visible.
  - `sample_frames()` starts with 1, ends with 250, and is strictly increasing.
  - `cull_aspects` returns 3 entries, with the portrait vfov > the 16:9 vfov.
- [ ] **Step 2:** `cd gen && python3 -m unittest discover -s test -p "test_*.py"` → FAIL (import error).
- [ ] **Step 3:** Implement `hero_geom.py`.
- [ ] **Step 4:** Run again → PASS. `node --test "test/*.test.js"` is still 162/162.
- [ ] **Step 5:** Commit `gen/hero_geom.py gen/test/test_hero_geom.py`: "City hero: cull geometry".

### Task 3: `export_hero.py`: cull, realise, LOD, AO, night markers, lamp posts, camera → raw glb + props

**Files:**
- Create: `gen/export_hero.py`
- Modify: `gen/README.md` (a short "Hero export" section: how to run it, its outputs, and that it never saves)

**Interfaces:**
- Consumes: `hero_geom` (Task 2), loaded with `sys.path.insert(0, _here)`, the same way `build_city.py` finds its directory.
- Run with `exec(open(G+"export_hero.py").read(), {"__name__":"eh","OUT_DIR":G+"build/hero/"})`.
- Produces:
  - `build/hero/hero_raw.glb`;
  - `build/hero/hero_props.json`;
  - `build/hero/export_report.json`.
- `hero_props.json` schema, consumed by Tasks 5, 9, 10 and 11:
  ```json
  { "version": 1, "fps": 24, "frames": [1, 250], "base_vfov_deg": 0, "safe_half_tan": { "f250": 0, "f1": 0 },
    "sun": { "dir": [0,0,0] }, "lantern": [0,0,0],
    "blimps": { "count": 0, "radius": 0, "altitude": 0, "period_s": 0, "len": 0, "r": 0 },
    "walk_paths": [ [[0,0,0], [0,0,0]] ],
    "well_water": "node name", "night": ["material or node names carrying the marker"] }
  ```
  - Coordinates are in **glTF space**: Y up, so (x, z, −y) from Blender.
  - `safe_half_tan.f250` is measured from the `Text` bounds projected at frame 250.
  - `safe_half_tan.f1` is measured from the avenue frontage width at the camera's frame-1 distance, clamped to the 16:9 half-width.
- glb contents:
  - one perspective camera node `HeroCamera`, with an animation `Hero` baked per frame in world space, frames 1–250;
  - meshes with `COLOR_0` (AO) and simple PBR materials;
  - night-marked materials named with the prefix `NIGHT_` (for example `NIGHT_MAT_AP_Void`), each with `extras.night_emissive = [r,g,b,strength]`.

- [ ] **Step 1: Cull.**
  - For each frame in `sample_frames()` and each `(aspect, vfov)` in `cull_aspects(...)`, build the planes with `margin=0.03`. Read the camera's world matrix after `scene.frame_set(f)`.
  - Walk `depsgraph.object_instances` (meshes, plus GN and collection instances), take each instance's world AABB, and keep it if any frustum contains it.
  - Then run an occlusion pass with `scene.ray_cast` from 5 sampled camera positions to the AABB's 8 corners plus its centre. Drop an instance only if every ray is blocked by another object for every sample.
  - Skip hidden or excluded collections and `05_TEMPLE`.
  - Write the kept and dropped counts per collection to `export_report.json`.
- [ ] **Step 2: Realise and group into a scratch collection** `HERO_EXPORT`, deleted at the end.
  - Copy kept instances as real meshes with modifiers applied.
  - Trees (instances whose source mesh is a `KIT_PlantD_*` or `asset_Plant_*`) become **linked duplicates** of one mesh per species, so glTF-Transform can instance them in Task 4.
  - **Distance bands**, by the minimum distance to any sampled camera position:
    - **Near** < 150 m: kept as modelled.
    - **Mid** 150–700 m: joined per material within 100 m grid tiles.
    - **Far** > 700 m: joined per material per tile, then a Decimate modifier (ratio 0.25, collapse).
    - **Exception:** objects named `KIT_Temple_lantern*` are never joined or decimated, whatever their distance.
      They stay named objects so Step 4 can find them and the Task 4 test can check them by name.
  - **Mid back faces:** after joining, delete the faces of mid meshes whose normal points away from every
    sampled camera position (dot(normal, cam − face centre) < 0 for all samples).
  - `Text`: convert to a mesh and replace its `Procedural Ceramic` material with a simple pale PBR. Keep its node name `Text`.
- [ ] **Step 3: AO bake.**
  - Near and mid meshes: subdivide faces longer than 4 m (near) or 12 m (far and mid) on any side with a grid split, so vertex AO has vertices to land on.
  - Bake Cycles AO (samples 32, distance 8 m) into a byte colour attribute `AO` on the corner domain, `bake_type='AO'`, `target='VERTEX_COLORS'`, with the attribute active. Read valid enums from `bpy.types.BakeSettings` rather than hard-coding them.
  - Far meshes and trees get no bake: fill `AO` with white.
  - Restore the render engine afterwards.
- [ ] **Step 4: Night markers and lamp posts.**
  - Duplicate the materials on the night list as `NIGHT_<name>` and point only the qualifying faces or objects at them. `MAT_AP_Cyan` gets a `NIGHT_` twin only on `KIT_Temple_lantern*`.
  - Set `extras.night_emissive`:
    - warm `[1.0, 0.78, 0.5, 2.0]` for windows;
    - `[1, 0.9, 0.7, 1.5]` for bands;
    - cyan `[0.3, 0.9, 1, 4]` for the Lantern and well ring;
    - `[1, 0.85, 0.6, 3]` for lamp heads.
  - **Lamp posts:** a 5 m pole plus a 0.6 m head, every 18 m along both pavement edges of the hero avenue within the kept area, and every 15° around the plaza ring. Add them as linked duplicates; their heads use `NIGHT_Lamp`.
- [ ] **Step 5: Camera.**
  - Create `HeroCamera` with no parent, a copy of `Camera.001`'s data and a sensor fit of `HORIZONTAL`.
  - Key its world matrix on every frame from 1 to 250, with linear interpolation.
  - Compute `base_vfov_deg` from the lens, the sensor width and 16:9.
- [ ] **Step 6: Props.**
  - **Blimps:** centred on the Lantern's x/y.
    - Radius: choose it so the near-side crossing of the circle lies inside the frame-1 frustum's sky wedge above the frontage. Search radius 600–1400 m in 50 m steps, and keep the radius that maximises the visible fraction of a full orbit at altitude 280 m.
    - Count 6, period 240 s.
    - `len`/`r` are the median of `o.blimps` from `node citygen_cli.js plan.json build/build.json` (`build.json` has no blimps, so read them via a small `node -e` call that prints `CityGen.generate(plan).blimps`).
  - **Walk paths:**
    - the plaza ring centreline as a 48-point loop;
    - two straight lines along each avenue pavement, from the plaza to 600 m out;
    - all at walking-surface height, found with downward `ray_cast`.
  - `well_water`: the exported node name of `KIT_Walkway_ring1_water`, or of the well's water mesh if that differs. Find the visible water disc below the `Text` at frame 250 with `ray_cast`.
- [ ] **Step 7: Export.**
  - Select only `HERO_EXPORT` and the camera, then run `bpy.ops.export_scene.gltf(filepath=..., export_format='GLB', use_selection=True, export_cameras=True, export_animations=True, export_apply=True, export_extras=True, ...)` with vertex colour export on. Read the valid option names from `bpy.ops.export_scene.gltf.get_rna_type().properties` rather than hard-coding Blender-5.2 enums.
  - Then delete `HERO_EXPORT`, its meshes and its materials, and `HeroCamera`.
- [ ] **Step 8: Run and post-check in Blender.**
  - Record `len(bpy.data.objects)`, `len(bpy.data.materials)`, the `Camera.001` key values and `bpy.data.is_dirty` before the run.
  - Run the export **twice**. After each run, assert the counts and keys match the before-values.
  - Assert that `hero_raw.glb` exists and that both runs produce the same `export_report.json` counts.
  - Assert that the two runs' `hero_raw.glb` files have the same sha256. If they can't (for example the
    exporter writes a timestamp), find the varying bytes, record why in the README, and compare the glb
    with those bytes masked instead.
  - Print the report.
- [ ] **Step 9:** Commit `gen/export_hero.py gen/README.md`: "City hero: Blender export".

### Task 4: `hero_glb.mjs` post-process and the glb tests

**Files:**
- Modify: `gen/package.json`:
  - devDependencies `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`;
  - `"type"` stays `commonjs`, so the script is `.mjs`.
- Create: `gen/hero_glb.mjs`
- Modify: the site's `.gitignore`: add `static/city/*.glb` and `static/city/hero_props.json`
- Test: `gen/test/hero_glb.test.js`
  - Skips with a message when `../../../static/city/hero.glb` is absent, so CI without exports stays green.

**Interfaces:**
- `node hero_glb.mjs [in=build/hero/hero_raw.glb] [out=../../../static/city/hero.glb]` does three things:
  - runs `dedup()`, `instance({min: 5})`, `weld()`, `prune()`, `quantize()` and `meshopt({encoder: MeshoptEncoder, level: 'medium'})`;
  - copies `build/hero/hero_props.json` beside the output;
  - prints the size, the triangle count and the draw-call estimate (primitives, with instanced ones counted once).

- [ ] **Step 1: Write failing tests** in `hero_glb.test.js`, using `NodeIO` with `EXTMeshoptCompression` and `EXTMeshGPUInstancing` registered and the meshopt decoder:
  - the size of glb + props is ≤ 10 × 1024 × 1024;
  - exactly one camera node `HeroCamera`, and an animation `Hero` whose input accessor runs from 0 to 249/24 s ± 1e-3;
  - a node `Text` exists;
  - every `NIGHT_*` material has `extras.night_emissive` as 4 numbers;
  - no material named `NIGHT_MAT_AP_Cyan` is used by any node whose name does not start with `KIT_Temple_lantern`;
  - no node named `CANALS_*` uses a `NIGHT_` material;
  - triangles summed over primitives (× instance count) ≤ 1.5 M;
  - primitive count, with instanced meshes once, is ≤ 300;
  - every mesh primitive except trees and lamps has `COLOR_0`;
  - `hero_props.json` parses and has every key in the Task 3 schema, with `blimps.count` ≥ 1 and `walk_paths.length` ≥ 3.
- [ ] **Step 2:** `cd gen && npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer`. Then run `node hero_glb.mjs` and `node --test test/hero_glb.test.js` → FAIL until the export exists and is within budget.
- [ ] **Step 3:** Implement `hero_glb.mjs`.
  - Run Task 3's export, then this script, then the test.
  - **If over budget, tune the constants at the top of `export_hero.py` and re-run, in this order:**
    1. far decimate ratio;
    2. mid tile size;
    3. subdivision thresholds;
    4. tree species LOD.

    Record the final values in the README.
- [ ] **Step 4:** `node --test "test/*.test.js"` → 162 + the new tests PASS.
- [ ] **Step 5:** Commit `gen/package.json gen/package-lock.json gen/hero_glb.mjs gen/test/hero_glb.test.js .gitignore`: "City hero: glb post-process and budget tests". Do not commit the glb.

### Task 5: `CityHeroScene` (day) with the procedural sky

**Files:**
- Create: `src/lib/city/sky.ts`
  - `createSky(): { mesh: THREE.Mesh; uniforms; setMix(night: number): void; update(t: number): void }`
  - A back-faced sphere using a ShaderMaterial:
    - a gradient from zenith to horizon;
    - a sun glow from `props.sun.dir`;
    - an fbm cloud layer that scrolls along a wind vector by `uTime`;
    - a night mix uniform (stars from a hash, a moon disc, a darker gradient, and cloud undersides lit with a
      faint warm city glow that is strongest near the horizon toward the city). Wired here; driven in Task 7.
- Create: `src/lib/city/CityHeroScene.ts`
- Create: `src/lib/city/props.ts`
  - The `HeroProps` type, matching the Task 3 schema.
  - `loadProps(url): Promise<HeroProps>`.
- Test: `src/lib/city/props.test.ts`
  - `loadProps` with a stub `fetch` returns the typed object.
  - It rejects with a clear error when a key is missing.

**Interfaces:**
- Consumes: `heroCamera.ts` (Task 1); `/city/hero.glb` and `/city/hero_props.json` (Task 4).
- Produces: `class CityHeroScene`, used by Tasks 6–11:
  - `constructor(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean; mobile: boolean })`
  - `load(glbUrl: string, propsUrl: string): Promise<void>`
    - Uses GLTFLoader with `setMeshoptDecoder(MeshoptDecoder)`.
    - Finds `HeroCamera` and makes it the render camera.
    - Starts an `AnimationMixer` on clip `Hero`, with the action paused and `setTime`-driven.
  - `setScroll(progress: number): void`: sets the frame target.
  - `resize(w: number, h: number): void`
    - Sets the aspect.
    - Sets fov = `safeFrameFov(aspect, props.base_vfov_deg, safeHalfTanAt(frame))`, interpolating `safe_half_tan` between f250 and f1 by frame.
    - Calls `updateProjectionMatrix`.
  - `setMode(mode: 'day'|'night'): void`: a stub in this task (day only); filled in by Task 7.
  - `stats(): { calls: number; triangles: number }`: from `renderer.info.render`.
  - `destroy(): void`
  - Exposes `readonly props` and `readonly root` (the glTF scene) for Tasks 7–10. The sky's clouds already drift here (milestone 3 in the spec, but free once the sky shader exists).
- Rendering:
  - `WebGLRenderer({antialias: !mobile})`;
  - `setPixelRatio(min(devicePixelRatio, 1.5))`;
  - ACES tone mapping and the sRGB output colour space;
  - materials use `vertexColors = true` where `COLOR_0` exists (AO);
  - environment: `PMREMGenerator.fromScene(skyOnlyScene)` at load;
  - a DirectionalLight from `props.sun.dir`, with shadows only when `!mobile`: a 2048 map with its shadow camera fitted to 150 m around the plaza;
  - each frame: `frame = easeToward(frame, target, dt)` (or `= target` when `reducedMotion`), then `mixer.setTime(frameToTime(frame))`, then `sky.update(t)` (t frozen when `reducedMotion`), then render;
  - the RAF loop follows `DicePreviewScene`'s pattern.

- [ ] **Step 1:** Write the failing `props.test.ts` → `pnpm vitest run` FAIL.
- [ ] **Step 2:** Implement `props.ts`, `sky.ts` and `CityHeroScene.ts`.
- [ ] **Step 3:** `pnpm vitest run` PASS and `pnpm check` clean.
- [ ] **Step 4:** Commit the four files: "City hero: Three.js scene and sky".

### Task 6: `/city` route, scroll track, still and fallback, and M1 verification

**Files:**
- Create: `src/routes/city/+page.svelte`
- Create: `static/city/hero-still.webp`
  - A frame-250 EEVEE render at 1280×720 from `Camera.001`, written through a temporary scene camera switch that is restored afterwards (as in earlier renders).
  - Committed: about 100 KB, plain git.

**Interfaces:**
- Consumes: `CityHeroScene` (Task 5).
- Page structure:
  - a `position: fixed; inset: 0` canvas;
  - over it, the still `<img>` (`object-fit: cover`), which fades out once `load()` resolves;
  - after them, a `<div class="track" style="height: 400vh">`.
- Behaviour:
  - Progress = `scrollY / (track height - innerHeight)`, read on `scroll` with `{passive: true}`, then `scene.setScroll(progress)`.
  - On `resize`: `scene.resize`.
  - `reducedMotion` comes from `matchMedia('(prefers-reduced-motion: reduce)')`, and `mobile` from `matchMedia('(pointer: coarse)')`.
  - **Failure:** if WebGL is unavailable (a context creation throw) or `load()` rejects, keep the still and log one console warning.
  - `MainMenu` from the layout stays on top (z-index), and the canvas sits behind it.
  - Add `<svelte:head><title>Atlantis · City</title></svelte:head>`.

- [ ] **Step 1:** Render `hero-still.webp`, then implement the page.
- [ ] **Step 2:** Run `pnpm build`. It should pass, and the prerendered `build/city/index.html` should exist.
- [ ] **Step 3: Browser verification** with `pnpm dev`, using Claude in Chrome (resize the window to 1280×720, then to 390×844).
  - Scroll to progress 0, 0.1, 0.2, … 1.0 and take a screenshot at each.
  - Compare progress 0, 0.5 and 1.0 with Blender renders of frames 250, 125 and 1 for framing.
  - Check every screenshot for holes or popping.
  - At 390×844 and progress 0, "Welcome to Atlantis" must be fully visible.
  - Log `scene.stats()` at progress 1: calls ≤ 300 and triangles ≤ 1.5 M.
  - Save the screenshots to the scratchpad.
  - If holes appear, widen the cull margin or add sample frames in `export_hero.py`, re-export, and re-verify.
- [ ] **Step 4:** Commit `src/routes/city/+page.svelte static/city/hero-still.webp`: "City hero: /city page".

## Milestone 2: night

### Task 7: Night mode and toggle

**Files:**
- Create: `src/lib/city/night.ts`
  - `nightEmissive(material: THREE.Material): [number, number, number, number] | null`
    - Reads `material.userData.night_emissive`; GLTFLoader maps extras to userData.
    - Returns null for non-`NIGHT_` materials.
  - `mixMode(t: number): { sun: number; ambient: number; emissive: number; bloom: number; exposure: number }`
    - t = 0 is day and t = 1 is night.
    - Day: sun 3, ambient 1, emissive 0, bloom 0, exposure 1.
    - Night: sun 0.05 (a moon), ambient 0.15, emissive 1, bloom 0.6, exposure 0.9.
    - Linear between them.
- Test: `src/lib/city/night.test.ts`
  - Covers the endpoints and midpoint of `mixMode`.
  - `nightEmissive` returns the tuple for a material named `NIGHT_MAT_AP_Void` with userData, and null for `MAT_AP_Cyan`, even when that material has userData.
- Modify: `src/lib/city/CityHeroScene.ts`
  - `setMode` cross-fades `t` over 1 s (instantly with `reducedMotion`).
  - It applies `mixMode`:
    - sets emissive colour and intensity on the materials collected at load via `nightEmissive`;
    - sets `sky.setMix(t)`;
    - regenerates PMREM from the sky at the fade's end only.
  - Bloom: an `EffectComposer` with `UnrealBloomPass`, enabled while bloom > 0 (strength halved on mobile).
- Modify: `src/routes/city/+page.svelte`
  - A day/night toggle button in a corner (an accessible `<button aria-pressed>`).
  - It persists the choice to `localStorage['city-mode']`, with try/catch around reads and writes.

- [ ] **Step 1:** Write the failing `night.test.ts` → FAIL.
- [ ] **Step 2:** Implement, then `pnpm vitest run` PASS and `pnpm check` clean.
- [ ] **Step 3: Browser:** take night screenshots at progress 0, 0.5 and 1.
  - Windows, bands, lamp posts, the Lantern and the well ring glow.
  - The canals do not glow.
  - The sky has stars and a moon.
- [ ] **Step 4:** Commit: "City hero: night mode".

## Milestone 3: moving things

### Task 8: Blimps

**Files:**
- Create: `src/lib/city/blimps.ts`
  - `blimpPose(i: number, t: number, b: HeroProps['blimps'], centre: [number, number, number]): { position: [x, y, z]; yaw: number }`
    - angle = `2π(i/count + t/period_s)`;
    - position = `centre + radius·(cos, ·, sin)`, with y = `altitude + 4·sin(2π t/37 + i)`;
    - yaw is tangent to the circle.
  - `createBlimps(b): THREE.InstancedMesh`
    - A greybox capsule hull (length `len`, radius `r`) plus 4 box fins, merged into one geometry and instanced `count` times.
- Test: `src/lib/city/blimps.test.ts`
  - Every blimp's distance from the centre equals the radius ± 1e-6.
  - At t = 0 the blimps are evenly spaced.
  - After a quarter of `period_s` they have advanced π/2.
  - The bob is within ±4 m.
- Modify: `CityHeroScene.ts`: add the blimps at load and update them each frame (frozen with `reducedMotion`).
- [ ] Steps: failing test → implement → `pnpm vitest run` PASS → the browser shows a blimp crossing the sky at progress 1 within one period → commit "City hero: circling blimps".

### Task 9: Well water

**Files:**
- Create: `src/lib/city/water.ts`
  - `makeWaterMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial`
    - Uses `onBeforeCompile` to perturb the normal with two scrolling sine/noise layers driven by `uTime`.
    - Keeps the base colour.
    - Adds a soft fresnel tint and sky reflections via the env map.
    - **Night lights in the water:** at night it adds reflected glints of the city lights. A uniform array
      holds up to 32 light positions and colours, taken at load from the night-marked meshes nearest the well
      and the lamp posts. Each light adds a specular streak from its mirrored position, scaled by the night mix.
    - **Reduced motion:** `uTime` stops advancing, so the surface stays still.
  - `applyWater(root: THREE.Object3D, nodeName: string): THREE.Material | null`
    - Finds `props.well_water` by name and swaps in the water material.
- Test: `src/lib/city/water.test.ts`
  - `applyWater` replaces the material on the named mesh, returns it, and returns null when the name is missing (built on a tiny THREE scene).
  - `nearestLights(points, origin, n)` (exported helper) returns the n nearest points sorted by distance and never
    more than 32.
- Modify: `CityHeroScene.ts`: apply the water at load, advance `uTime` (frozen with `reducedMotion`) and pass the
  night mix to the water.
- [ ] Steps: failing test → implement → PASS → the browser at progress 0 shows the water moving behind the text by day, and at night with light glints → commit "City hero: well water".

### Task 10: People

**Files:**
- Create: `src/lib/city/people.ts`
  - `walkerPose(path: [number, number, number][], s: number): { position: [x, y, z]; heading: number }`
    - `s` is the distance along the path in metres, wrapping on closed loops (first point == last point) and ping-ponging on open lines.
  - `createPeople(paths, opts: { perPath: number; speed: [min, max] }): { mesh: THREE.InstancedMesh; update(t: number): void }`
    - Each figure is a low-poly capsule plus a head, about 1.75 m tall, one geometry with instance colours from a muted palette of 8.
    - Seeded with a mulberry32 PRNG keyed by path index, so the scene is the same every load.
    - perPath is 40 (20 on mobile), for a total of a few hundred.
- Test: `src/lib/city/people.test.ts`
  - On a square loop, s = 0 and s = perimeter give the same position.
  - On an open 100 m line, s = 150 sits at the 50 m point (ping-pong).
  - Heading points along the segment direction.
  - The same seed gives the same layout.
- Modify: `CityHeroScene.ts`: add people at load and update them each frame (frozen with `reducedMotion`).
- [ ] Steps: failing test → implement → PASS → the browser shows people walking on the plaza ring and pavements at progress 1 → commit "City hero: people".

### Task 11: Final verification and the reviewed glb

- [ ] **Step 1:** Run every check:
  - `pnpm vitest run`
  - `pnpm check`
  - `pnpm build`
  - `cd gen && node --test "test/*.test.js"`
  - `python3 -m unittest discover -s test -p "test_*.py"`

  All must pass.
- [ ] **Step 2: Full browser sweep** at 1280×720 and 390×844, day and night: 10 scroll positions each.
  - Save the screenshots, plus a short GIF of the scroll, to the scratchpad.
  - Log `stats()`.
  - **Frame rate:** log the average fps over a 5 s scroll at 1280×720 (target ≥ 60), and at 390×844 with Chrome
    CPU throttling at 4× and pixel ratio forced to 1.5 (target ≥ 30, a rough stand-in for a mid-range phone).
    If either misses, report it with the numbers; don't tune silently.
  - Check `prefers-reduced-motion` emulation: there is no easing and nothing moves (clouds, blimps, people,
    water).
- [ ] **Step 3:**
  - Update `gen/README.md` with the final budget numbers.
  - **Stop and show the user the screenshots and the GIF.** Only after they approve the look, run `git add -f static/city/hero.glb static/city/hero_props.json` and commit "City hero: reviewed export".
  - If they want changes, iterate on Tasks 3–10 first.
