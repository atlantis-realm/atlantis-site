# City hero view for the web: design

Status: approved after pushback · 2026-10-25 · source scene `concept-assets/city/Atlantian_plaza_blockout-v05.blend`

## Why

The homepage's hero is a pre-rendered loop, `static/background.m4v`. The user wants the Atlantis greybox city
as a live Three.js scene instead: the existing hero camera move, driven by scroll, with a day/night toggle and
moving things in it. The full city is far too heavy for a browser, so the user's rule is: **"we dont have to
render what isnt seen by that view"**.

## What exists

- The hero camera is `Camera.001`, parented to the empty `Rig_Gimbal` at (0, −1213.8, 8.9).
  - Lens 34 mm, clip 0.2 to 8000. The render is 1280×720 EEVEE.
  - Its action, `Camera.001Action`, runs frames 1 to 250: two Bezier keys on location and rotation.
- The shot:
  - **Frame 1:** standing on the plaza ring at the foot of the hero avenue, looking up the avenue past
    the flanking towers and trees to the skyline and the Lantern.
  - **Around frame 125:** tilting down over the ring's rims.
  - **Frame 250:** looking down into the well at the 3D text "Welcome to Atlantis" (the object named `Text`).
  - Renders of frames 1, 125 and 250 are the visual reference.
- The scene is about 3,500 objects plus tens of thousands of tree instances (distance-tree system, college
  woods). Lighting is one Sun plus the "Clear Daylight Ocean Horizon Sky" HDRI world.
- Boats and blimps exist in `citygen.js` output (`o.boats`, `o.blimps`), but `build_city.py` doesn't build
  them, so they aren't in the .blend. There are no people.
- The site is SvelteKit 5 with `adapter-static`. `three` ^0.184 is already a dependency. The pattern to follow
  for a Three.js scene class is `src/lib/dice/DicePreviewScene.ts`.

## What the user decided

- **Delivery:** a trimmed **glb exported from Blender**, once, from v05. It is not generated in the browser
  from the plan.
- **Scroll-driven, played in reverse:** the page opens looking down into the well at "Welcome to Atlantis"
  (frame 250). Scrolling down tilts the camera up to the city, ending on the view up the avenue (frame 1)
  (user: "the animation should run from looking down then up to the city as the user scrolls down").
  Scrolling back up reverses it.
- **Fake sky with moving clouds** (user: "lets try faking the sky so we can have some cloud movement"):
  the sky is drawn by the page, not taken from the scene's HDRI.
- **Day or night, on a toggle** the visitor flips.
- **Animated:** these loop on their own, independent of scroll:
  - blimps, which **drift in a circle** (user, after hearing the plan's blimps are hidden behind the avenue
    towers);
  - the well's water;
  - people.
- **No boats** (user: "dont worry about boats").
- **Its own page for now.** The homepage and its video stay as they are.
- **Cull to the view:** anything the camera can't see over the whole move is left out of the export.

## Design (*my calls* unless marked otherwise)

### The page

- **Route:** `/city`.
- **Layout:** a full-viewport canvas fixed behind a tall scroll track. Scroll progress 0→1 maps to camera
  frames 250→1.
  - Track height: about 4 viewport heights, so the move isn't over in a flick.
  - The camera eases toward the scroll target, so wheel steps don't judder.
- **Toggle:** a day/night switch in a corner. It defaults to day and remembers the choice per visitor
  (localStorage, wrapped in try/catch).
- **Reduced motion:** with `prefers-reduced-motion`, ambient animation slows or stops, and the camera snaps to
  the scroll position without easing.
- **Fallback:** if WebGL is missing or the glb fails to load, show the frame-250 still (the welcome view). The
  page never shows a blank screen.
- **Loading:** a still of frame 250 shows while the glb loads, then cross-fades to the live canvas.

### The export (Blender side)

- **Script.** A Python script, run through the Blender MCP like `build_city.py`, writes the glb. It is
  committed under `concept-assets/city/generators/` as `export_hero.py`, and rerunning it gives the same
  result.
- **Non-destructive.** It never saves v05. It works on a temporary copy, or only reads, and exports a
  selection.
- **Framing: a safe frame** (pushback, user's pick). At 16:9 the shot is exactly the Blender camera. On any
  narrower screen the camera widens its field of view just enough to keep a safe frame in view: the full width
  of "Welcome to Atlantis" at frame 250 and the avenue's width at frame 1. Portrait phones therefore see more
  above and below (well walls, sky, plaza paving), never less at the sides. Wider-than-16:9 screens keep the
  vertical field of view and see a little more at the sides.
  - Culling uses the union of the 16:9 frustums, a tall portrait frustum (about 9:19.5 under the safe-frame
    rule) and a 21:9 frustum, plus a small margin.
- **Coordinates:** scene = plan + `build.json` `center` (0, 1168), the same offset `build_city.py` uses.
- **Visibility.** It samples the camera every few frames across 1–250 and keeps an object or instance only
  if both are true:
  1. Its bounds fall inside some sampled frustum (any of the aspects above, with a small margin).
  2. It isn't fully hidden behind the avenue frontage. This is an occlusion test by ray casts from the sampled
     camera positions to points on the object.
- **Detail by distance.**
  - **Near** (plaza, well, first blocks of the avenue): kept as modelled.
  - **Mid** (rest of the avenue): faces the camera never sees are dropped where that's simple. Meshes
    sharing a material are merged to cut draw calls.
  - **Far** (skyline): heavily simplified. Decimated and merged, or reduced to billboards or impostors if
    they look right from this one viewpoint.
- **Trees.** Trees in view become instanced low-poly trees, one mesh per species, exported as
  `EXT_mesh_gpu_instancing`, or as a transform list that the page instances. They are not thousands of
  separate nodes.
- **Text.** The `Text` object is converted to a mesh.
- **Materials.** Simple PBR: base colour, roughness, metalness. No Blender-only nodes.
- **Baked ambient occlusion** (pushback, user's pick). The export bakes AO into vertex colours (or a
  per-mesh AO channel) so creases, street floors and tower bases darken whatever the light. It works for day
  and night alike and costs nothing at runtime, so phones keep the depth the EEVEE renders have. Real-time sun
  shadows stay near the camera on desktop only.
- **Night list** (pushback, user's pick). These, and only these, get a night-emissive marker (a glTF `extras`
  flag or name prefix) plus an emissive colour the page turns on:
  - `MAT_AP_Void`: lit windows, a warm glow (the kit facades' window openings);
  - `MAT_AP_Glow` and `MAT_AP_Clerestory`, only on the faces that actually use them: building light bands
    (every generated building lists all materials, so the export checks faces, not slots);
  - the Lantern's cyan parts, chosen by object name (`KIT_Temple_lantern*`), not by material:
    `MAT_AP_Cyan` is on 4,775 objects including every canal, which must not glow;
  - the well's ring lights;
  - **new lamp posts**: the scene has none, so the export script adds simple lamp posts along the plaza ring
    and the avenue pavements (export-only; v05 isn't changed), with glowing heads.
- **Camera.** The camera animation goes in the glb, baked as sampled keys in world space, so the gimbal parent
  doesn't matter. The page scrubs it with an `AnimationMixer`. Lens, sensor and clip are carried as a glTF
  perspective camera.
- **Compression.** Draco or Meshopt geometry compression, and KTX2 or WebP textures if there are any.

### Moving things (page side, positions from the city data)

- **Blimps:** greybox blimp meshes, styled after the plan's blimps (`o.blimps`: length, radius, altitude around
  250–340 m).
  - They drift on one slow circle centred over the Lantern, evenly spaced and gently bobbing.
  - The radius and altitude are chosen so the blimps pass through the sky visible above the avenue, with one
    usually in frame.
  - They are positioned for the shot, not taken from the plan's coordinates: the plan's blimps are hidden
    behind the avenue towers.
  - Parameters (count, radius, altitude, period) live in a small `hero_props.json` written by the export, in
    scene coordinates.
- **The well's water:** an animated water surface in the well (scrolling normals or a gentle shader). It
  matters most around frame 250, where it sits behind the welcome text.
- **People:** low-poly or billboard figures walking set paths on the avenue pavements, in the hundreds at
  most. None circle the plaza (user, after the first build). They are instanced, so they cost one or a few draw calls.

### Sky

- **A procedural sky dome** drawn in a shader: a gradient sky with a sun glow, plus a cloud layer from
  scrolling noise that drifts slowly. There is no HDRI file to download.
- **Day:** blue gradient, soft white clouds. **Night:** deep blue to near-black, stars, a moon, and clouds
  lit faintly from below by the city's glow.
- **Lighting:** a small environment map for reflections and ambient light is generated from the same sky at
  load (PMREM), and again when the toggle switches, so the buildings stay matched to the sky.
- The clouds keep moving whatever the scroll position. With reduced motion, they stop.

### Day and night

- **Day:** sun plus the procedural sky's environment, matching the EEVEE look. A pale greybox with colour, soft shadows
  near the camera only.
- **Night:**
  - a dark blue sky with a moon light;
  - the night list on (lit windows, light bands, lamp posts, the Lantern glowing, well ring lights);
  - mild bloom;
  - the water reflecting the lights.
- **Switching** cross-fades over about a second. It never reloads the glb.

### Budget

- **Download:** the glb plus props, **10 MB at most**, compressed.
  - The glb is served from `static/` as a **plain git file**. The site build doesn't fetch LFS (the Dockerfile
    does `COPY . .`; `.gitattributes` scopes LFS to `concept-assets/`), so it can't live in LFS.
  - **Only reviewed exports are committed** (pushback, user's pick). `export_hero.py` writes to a git-ignored
    folder while iterating; a glb is copied into `static/` and committed only when the user approves the look,
    so history grows only when they say so.
  - The working .blend stays where it is.
- **Runtime:**
  - fewer than about 300 draw calls;
  - fewer than about 1.5 M triangles on screen at frame 1;
  - 60 fps on a desktop GPU;
  - aiming for 30 fps or better on a mid-range phone, with pixel ratio capped at about 1.5 and shadows off on
    mobile.

## Milestones

Each milestone works on its own, so the page is usable if later ones stall.

1. **Scroll page (day):** export with culling, AO and LOD; the `/city` page with scroll-driven camera, safe
   frame, procedural day sky, fallback and loading still.
2. **Night:** the toggle, the night list and lamp posts, night sky, bloom, cross-fade.
3. **Moving things:** clouds drifting, blimps circling, the well's water, people.

## Non-goals

- No change to the homepage or `background.m4v`.
- No free camera, orbit controls, or leaving the hero path.
- No generating the city in the browser from `plan.json`.
- No changes to the generators' city output or to v05.
- Detailed characters are out of scope. People stay greybox-simple.

## Anti-goals

- The browser downloads or draws parts of the city the camera never sees.
- A scroll position shows a hole: missing geometry at a frustum edge, or a building popping in.
- Day and night look like the same scene with a dark filter.
- The page stutters or is blank on a phone.
- The web scene's framing drifts from the Blender camera (the user's hero shot).

## Constraints

- Commit locally per task. Don't push without asking.
- `.blend` stays in LFS. Never touch the user's uncommitted `Atlantian_plaza_blockout-v01.blend`.
- Work on a new branch `city-hero` cut from `wip-city` (its installed `node_modules` match; the site's `@ladyofcode` packages need GitHub Packages auth to install). Before any PR, rebase onto the PR branch the way `city-generators` was prepared.
- Match the site's existing code style (TypeScript, Svelte 5, the `DicePreviewScene` pattern).

## Done when

- `/city` builds with `npm run build` and loads in the browser.
- Scrolling top to bottom plays the hero move in reverse, from the well up to the avenue view. Frames 1, 125 and 250 match the Blender renders in framing
  (side-by-side screenshots).
- The toggle switches day and night, and night shows lit windows, lamps and the Lantern.
- Clouds drift; blimps circle through the visible sky; the well's water and people visibly move.
- No missing geometry at any scroll position: screenshots at about 10 positions across the scroll, at 16:9 and
  at a tall phone aspect. On the phone aspect, "Welcome to Atlantis" is fully visible at scroll 0.
- The glb and props JSON are within budget (10 MB). The draw-call and triangle counts are logged and within budget.
- Rerunning `export_hero.py` reproduces the glb.

## Left to the builder

- **Far skyline:** decimate and merge first; flat impostors only if that isn't enough.
- **Match:** "frames match the Blender renders" means framing, judged by eye. Colour and tone won't be
  identical to EEVEE.
- `export_hero.py` sits next to `build_city.py`.
- Exact cull margins, sample rate, LOD thresholds and simplification method.
- Prop meshes, people's look and walking paths, and the water shader.
- Night palette and light levels, within "lit city at night".
- Whether the camera eases and how strongly, and the scroll track length.
