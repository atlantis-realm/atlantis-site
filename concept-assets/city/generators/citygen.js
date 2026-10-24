// citygen.js: the Atlantis ring-city generator.
// One source of truth: the plan page inlines this file to draw the plan, and build_city.py runs it in
// node (citygen_cli.js) to get the exact geometry Blender builds. Coordinates are metres relative to
// the city centre, x east, y north, z up.
const CityGen = (() => {
  "use strict";
  const TAU = Math.PI * 2, SOUTH = -Math.PI / 2, NORTH = Math.PI / 2;
  const rad = (deg) => deg * (Math.PI / 180);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const angDist = (a, b) => Math.abs((((a - b + Math.PI) % TAU) + TAU) % TAU - Math.PI);
  const lerp = (a, b, f) => a + (b - a) * f;

  // ---------------------------------------------------------------- seeded generator (FNV-1a -> mulberry32)
  function rng(key) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(key)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    let a = h;
    const R = {
      random() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      randint: (lo, hi) => lo + Math.floor(R.random() * (hi - lo + 1)),
      uniform: (x, y) => x + R.random() * (y - x),
      choice: (arr) => arr[Math.floor(R.random() * arr.length)],
      normal() { const u = Math.max(1e-12, R.random()), v = R.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); },
    };
    return R;
  }

  // ---------------------------------------------------------------- terrain
  function makeTerrain(plan) {
    const sc = plan.scene, T = sc.terrain, ring = (id) => sc.rings.find((r) => r.id === id);
    const P = ring("promenade"), C1 = ring("canal1"), B = ring("belt"), C2 = ring("canal2"), K = ring("park"), IW = ring("inner_water"), I = ring("island");
    const lin = (r, r0, z0, r1, z1) => z0 + (z1 - z0) * (clamp(r, Math.min(r0, r1), Math.max(r0, r1)) - r0) / (r1 - r0);
    const beltZ = (r) => lin(r, B.r1, T.belt[0], B.r0, T.belt[1]);
    const parkZ = (r) => lin(r, K.r1, T.park[0], K.r0, T.park[1]);
    const islandZ = (r) => (r <= T.plateau_r ? T.island[1] : lin(r, I.r1, T.island[0], T.plateau_r, T.island[1]));
    const water = { canal1: C1.z, canal2: T.belt[1] - T.canal2_below, inner_water: T.park[1] - T.inner_below };
    const kindAt = (r) => (r >= P.r0 ? "promenade" : r >= C1.r0 ? "canal1" : r >= B.r0 ? "belt" : r >= C2.r0 ? "canal2" : r >= K.r0 ? "park" : r >= IW.r0 ? "inner_water" : "island");
    function G(r) {  // ground (land) or water surface
      const k = kindAt(r);
      if (k === "promenade") return T.promenade_z;
      if (k === "belt") return beltZ(r);
      if (k === "park") return parkZ(r);
      if (k === "island") return islandZ(r);
      return water[k];
    }
    const isWater = (r) => ["canal1", "canal2", "inner_water"].includes(kindAt(r));
    // canal crossings, outer bank -> inner bank (inner is higher)
    const crossings = [
      { id: "canal1", ri: C1.r0, ro: C1.r1, zin: beltZ(C1.r0), zout: T.promenade_z },
      { id: "canal2", ri: C2.r0, ro: C2.r1, zin: parkZ(C2.r0), zout: beltZ(C2.r1) },
      { id: "inner_water", ri: IW.r0, ro: IW.r1, zin: islandZ(IW.r0), zout: parkZ(IW.r1) },
    ];
    const old = T.old_levels;
    const oldLevel = (r) => { const k = kindAt(r); return k === "promenade" || k === "canal1" ? old.promenade : k === "belt" || k === "canal2" ? old.belt : k === "park" || k === "inner_water" ? old.park : old.island; };
    // how far something resting on the old flat decks must move to sit on the new ground at radius r
    // (over water: blend between the two banks so bridges and walkways stay continuous)
    const landDelta = (r) => G(r) - oldLevel(r);
    function deltaAt(r) {
      if (!isWater(r)) return landDelta(r);
      const c = crossings.find((c) => r >= c.ri && r <= c.ro);
      const dOut = landDelta(c.ro + 0.01), dIn = landDelta(c.ri - 0.01);
      return dIn + (dOut - dIn) * (r - c.ri) / (c.ro - c.ri);
    }
    return { G, isWater, kindAt, crossings, water, beltZ, parkZ, islandZ, oldLevel, deltaAt, templeLift: T.island[1] - sc.temple.base_z };
  }

  // Road and sidewalk heights along a spoke, by distance t from the centre.
  function makeProfile(plan, ter, skip) {
    const S = plan.spokes, g = S.grade, crossings = ter.crossings.filter((c) => !(skip || []).includes(c.id));
    const base = (t) => { if (!ter.isWater(t)) return ter.G(t); const c = ter.crossings.find((c) => t >= c.ri && t <= c.ro); return c ? c.zout : ter.G(t); };
    const road = (t) => { let z = base(t); for (const c of crossings) if (t >= c.ri) z = Math.max(z, c.zin - g * (t - c.ri)); return z; };
    // where each crossing's approach ramp meets the ground on the outer bank
    const rampEnd = crossings.map((c) => { let t = c.ri; while (t < c.ro + 2000 && road(t) > base(t) + 1e-3) t += 1; return t; });
    // a big drop at an outer abutment gets stairs + ramp; a small one is graded into the sidewalk
    const drops = crossings.map((c) => ({ c, t: c.ro, drop: road(c.ro) - ter.G(c.ro + 0.01) }));
    const steps = drops.filter((s) => s.drop > S.step_threshold);
    const graded = drops.filter((s) => s.drop > 0.02 && s.drop <= S.step_threshold);
    const walk = (t) => {
      if (ter.isWater(t)) return road(t);
      let z = ter.G(t);
      for (const s of graded) if (t >= s.t) z = Math.max(z, road(s.t) - S.ramp_slope * (t - s.t));
      return z;
    };
    return { road, walk, base, rampEnd, steps, crossings };
  }

  function spokeAngles(plan) {
    const S = plan.spokes, out = [];
    for (let k = 0; k < S.count; k++) out.push({ k, a: SOUTH + rad(S.offset_deg || 0) + k * TAU / S.count, hero: k === (S.hero_index || 0) });
    return out;
  }
  const blockHalf = (plan, sp) => (sp.hero ? Math.max(plan.spokes.hero_block_half, plan.spokes.corridor_half) : plan.spokes.corridor_half);
  // angle of a straight corridor edge (offset h from the spoke axis, on side s) at radius r
  const edgeAngle = (sp, h, s, r) => sp.a + s * Math.atan2(h, Math.sqrt(Math.max(r * r - h * h, 1)));
  // the paved wedge the hero avenue opens up (genSpokes' hero fill), plus a margin
  function inHeroWedge(plan, spokes, x, y, margin) {
    const S = plan.spokes, hero = spokes.find((sp) => sp.hero);
    if (!hero || !S.hero_fill_deg) return false;
    const along = x * Math.cos(hero.a) + y * Math.sin(hero.a), across = Math.abs(-x * Math.sin(hero.a) + y * Math.cos(hero.a));
    return along > 0 && across < Math.max(S.corridor_half, along * Math.tan(rad(S.hero_fill_deg)) + 12) + margin;
  }
  function inCorridor(plan, spokes, x, y, margin) {
    for (const sp of spokes) {
      const along = x * Math.cos(sp.a) + y * Math.sin(sp.a), across = Math.abs(-x * Math.sin(sp.a) + y * Math.cos(sp.a));
      if (along > 0 && across < blockHalf(plan, sp) + margin) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- geometry helpers
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const bilinear = (Q, u, v) => [
    (1 - u) * (1 - v) * Q[0][0] + u * (1 - v) * Q[1][0] + (1 - u) * v * Q[2][0] + u * v * Q[3][0],
    (1 - u) * (1 - v) * Q[0][1] + u * (1 - v) * Q[1][1] + (1 - u) * v * Q[2][1] + u * v * Q[3][1]];
  const quadUV = (Q, u0, u1, v0, v1) => [bilinear(Q, u0, v0), bilinear(Q, u1, v0), bilinear(Q, u1, v1), bilinear(Q, u0, v1)];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  function polyArea(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; }
  function inset(poly, m) {
    const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length, cy = poly.reduce((t, p) => t + p[1], 0) / poly.length;
    return poly.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1, f = Math.max(0, d - m) / d; return [cx + (x - cx) * f, cy + (y - cy) * f]; });
  }
  const spokePt = (sp, t, s) => [t * Math.cos(sp.a) - s * Math.sin(sp.a), t * Math.sin(sp.a) + s * Math.cos(sp.a)];
  function wobbler(key, amp) {
    const R = rng(key), p1 = R.uniform(0, TAU), p2 = R.uniform(0, TAU), p3 = R.uniform(0, TAU), k1 = R.randint(2, 4), k2 = R.randint(5, 9);
    return { w: (a) => amp * (0.62 * Math.sin(k1 * a + p1) + 0.38 * Math.sin(k2 * a + p2)), w2: (a) => amp * 0.3 * Math.sin(k2 * a + p3) };
  }

  // ---------------------------------------------------------------- cloud heightmap
  // Seeded fractal value noise over the whole city: soft patches that lift or drop the skyline on top
  // of the ring rules. cloud() is -1..1; cloudMul() turns it into a height multiplier 2^(amount*n).
  function lattice(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }
  function valueNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed), c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }
  function cloud(plan, x, y) {
    const C = plan.cloud;
    if (!C || C.enabled === false || !(C.scale > 0)) return 0;
    let sum = 0, amp = 1, norm = 0, f = 1 / C.scale;
    for (let o = 0; o < Math.max(1, Math.min(8, C.octaves || 4)); o++) {
      sum += amp * valueNoise(x * f + o * 17.31, y * f - o * 9.73, (C.seed || 0) + o * 101);
      norm += amp; amp *= C.persistence ?? 0.5; f *= 2;
    }
    return clamp(sum / norm * (C.contrast ?? 1.6) + (C.bias || 0), -1, 1);
  }
  const cloudMul = (plan, x, y, share = 1) => Math.pow(2, (plan.cloud?.amount || 0) * share * cloud(plan, x, y));

  // chaotic radial gradient of storeys, lifted or dropped by the cloud
  function storeysAt(plan, x, y, R, scale) {
    const K = plan.skyline, r = Math.hypot(x, y);
    const f = clamp((K.r_outer - r) / (K.r_outer - K.r_inner), 0, 1);
    let m = Math.exp(K.chaos * R.normal());
    if (R.random() < K.spike_chance) m *= R.uniform(K.spike[0], K.spike[1]);
    return clamp(Math.round(lerp(K.outer_storeys, K.inner_storeys, f) * m * (scale || 1) * cloudMul(plan, x, y)), K.min, K.max);
  }

  // ---------------------------------------------------------------- output builders
  function Out(withSolids) {
    const o = { lots: [], trees: [], rills: [], spokes: [], objects: [], instances: [], bands: {}, warnings: [], heroFill: [], heroWater: [], avenues: [], squares: [], cells: [], canals: [], canalLines: [], parks: [], basins: [], tanks: [], skywalks: [], skyAccess: [], boats: [], canalBridges: [], cellEdges: [], canalCuts: [], solar: [], blimps: [], noPlant: [] };
    o.obj = (name, coll, props) => { const ob = { name, coll, props: props || {}, prims: [] }; if (withSolids) o.objects.push(ob); return ob; };
    o.prism = (ob, poly, z0, z1, m) => { if (withSolids && z1 > z0 + 1e-3) ob.prims.push({ t: "prism", poly, z0, z1, m }); };
    o.solid = (ob, top, bot, m) => { if (withSolids) ob.prims.push({ t: "solid", top, bot, m }); };
    // rings of [x, y, z] points joined in order and capped at both ends (hulls, discs)
    o.loft = (ob, rings, m) => { if (withSolids) ob.prims.push({ t: "loft", rings, m }); };
    o.band = (key, r0, r1, z, top) => { const b = o.bands[key] || (o.bands[key] = { r0, r1, z, lo: Infinity, hi: -Infinity, n: 0 }); b.lo = Math.min(b.lo, top); b.hi = Math.max(b.hi, top); b.n++; };
    return o;
  }

  // A building on level ground: plinth takes up the slope, floor sits at the uphill corner.
  function building(o, ob, ter, poly, h, kind, opts = {}) {
    const zs = poly.map(([x, y]) => ter.G(Math.hypot(x, y)));
    const zmax = Math.max(...zs), zmin = Math.min(...zs), base = zmax + 0.05, top = base + h;
    if (zmax - zmin > 0.1) o.prism(ob, poly, zmin - 0.3, base, "plinth");
    o.prism(ob, poly, base - (zmax - zmin > 0.1 ? 0 : 0.3), top, "stone");
    if (opts.lip !== false) o.prism(ob, inset(poly, -0.35), top, top + 0.9, "lip");
    if (opts.roof !== false) o.prism(ob, inset(poly, 1.4), top + 0.9, top + 1.3, opts.roofMat || "roof");
    return { base, top: top + (opts.lip !== false ? 0.9 : 0), plinth: zmax - zmin };
  }

  function pointInPoly(x, y, q) {
    let ins = false;
    for (let a = 0, c = q.length - 1; a < q.length; c = a++) if ((q[a][1] > y) !== (q[c][1] > y) && x < (q[c][0] - q[a][0]) * (y - q[a][1]) / (q[c][1] - q[a][1]) + q[a][0]) ins = !ins;
    return ins;
  }

  // ---------------------------------------------------------------- energy
  // Solar farms and tethered wind-power blimps scattered through an orchard band (plan.energy):
  //   solar   clearings of tilted panel rows facing the equator (south), on short legs
  //   blimps  a streamlined envelope with fins and two rotor pods, flying high on a tether from a
  //           winch station in the orchard, nosed into the prevailing wind
  function genEnergy(plan, d, ter, spokes, o, band, bi) {
    const E = plan.energy || {};
    if (E.enabled === false) return;
    const S = E.solar || {}, Bm = E.blimps || {}, r0 = band.r0 + 8, r1 = band.r1 - 8;
    if (r1 - r0 < 20) return;
    const ob = o.obj(`ENERGY_${d.id}_b${bi}`, d.id, { use: "energy" });
    const clear = (q) => !q.some(([x, y]) => onCanalLine(o, x, y, 4) || inCorridor(plan, spokes, x, y, 6) || inHeroWedge(plan, spokes, x, y, 6)) && !o.noPlant.some((p2) => p2.some(([x, y]) => pointInPoly(x, y, q)) || q.some(([x, y]) => pointInPoly(x, y, p2)));
    spokes.forEach((sp, k) => {
      const rm = (r0 + r1) / 2, cut = sectorCuts(plan, spokes, k, rm, () => rm, () => rm), span = (cut.a1 - cut.a0) * rm;
      const R = rng(`${d.id}|energy|${bi}|${k}`);
      // solar farms: annular patches across most of the band
      for (let i = 0, n = S.per_sector ?? 2; i < n; i++) {
        const len = R.uniform(...(S.length || [50, 110])), am = cut.a0 + (i + 0.5 + R.uniform(-0.3, 0.3)) * (cut.a1 - cut.a0) / n, da = len / 2 / rm;
        const pr0 = r0 + R.uniform(0, 6), pr1 = Math.min(r1, pr0 + R.uniform(...(S.depth || [45, 80])));
        const patch = []; for (let j = 0; j <= 8; j++) patch.push(polar(pr0, am - da + 2 * da * j / 8)); for (let j = 8; j >= 0; j--) patch.push(polar(pr1, am - da + 2 * da * j / 8));
        if (!clear(patch)) continue;
        o.noPlant.push(patch); o.solar.push(patch);
        const gz = (x, y) => ter.G(Math.hypot(x, y));
        o.prism(ob, patch, Math.min(...patch.map(([x, y]) => gz(x, y))) - 0.3, Math.min(...patch.map(([x, y]) => gz(x, y))) + 0.05, "paver");
        // rows running east-west, 3.2 m deep panels tilted up toward the north edge, 2.6 m apart
        const ys = patch.map((p) => p[1]), y0 = Math.min(...ys) + 2, y1 = Math.max(...ys) - 2;
        for (let y = y0; y + 3.2 <= y1; y += 5.8) {
          const row = clipHalf(clipHalf(inset(patch, 2), 0, -1, -y), 0, 1, y + 3.2);
          if (row.length < 3 || Math.abs(signedArea(row)) < 8) continue;
          const top = row.map(([x, yy]) => [x, yy, gz(x, yy) + 0.7 + (yy - y) / 3.2 * 1.4]);
          o.solid(ob, top, top.map((t) => t[2] - 0.12), "panel");
          const xs = row.map((p) => p[0]);
          for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 1; x += 6) {
            if (!pointInPoly(x, y + 1.6, row)) continue;
            o.prism(ob, [[x - 0.1, y + 1.5], [x + 0.1, y + 1.5], [x + 0.1, y + 1.7], [x - 0.1, y + 1.7]], gz(x, y + 1.6), gz(x, y + 1.6) + 1.3, "lip");
          }
        }
      }
      // wind blimps on tethers
      for (let i = 0, n = Bm.per_sector ?? 1; i < n; i++) {
        const am = cut.a0 + (i + 0.5 + R.uniform(-0.35, 0.35)) * (cut.a1 - cut.a0) / n, rr = R.uniform(r0 + 10, r1 - 10), [x, y] = polar(rr, am);
        const pad = Array.from({ length: 12 }, (_, j) => [x + 9 * Math.cos(j * TAU / 12), y + 9 * Math.sin(j * TAU / 12)]);
        if (span < 60 || !clear(pad)) continue;
        o.noPlant.push(pad);
        const g = ter.G(rr), alt = g + R.uniform(...(Bm.altitude || [180, 300])), L = Bm.length || 45, Rr = L * 0.17;
        const wind = rad(E.wind_deg ?? 250), wx = Math.cos(wind), wy = Math.sin(wind), px = -wy, py = wx;  // nose points into the wind
        // winch station: pad, winch house, tether
        o.prism(ob, pad, g - 0.3, g + 0.15, "paver");
        o.prism(ob, [[x - 3, y - 2.5], [x + 3, y - 2.5], [x + 3, y + 2.5], [x - 3, y + 2.5]], g + 0.15, g + 4, "stone");
        o.prism(ob, [[x - 0.25, y - 0.25], [x + 0.25, y - 0.25], [x + 0.25, y + 0.25], [x - 0.25, y + 0.25]], g + 4, alt - Rr * 0.9, "lip");
        // envelope: an ellipsoid of revolution along the wind axis
        const ring = (cx, cy, cz, rad2, n2 = 14) => Array.from({ length: n2 }, (_, j) => { const t = j * TAU / n2; return [cx + px * rad2 * Math.cos(t), cy + py * rad2 * Math.cos(t), cz + rad2 * Math.sin(t)]; });
        const hull = [];
        for (let j = 0; j <= 10; j++) { const s2 = -L / 2 + L * j / 10, f = Math.sqrt(Math.max(0.02, 1 - (2 * s2 / L) ** 2)); hull.push(ring(x + wx * s2, y + wy * s2, alt, Rr * f)); }
        o.loft(ob, hull, "fabric");
        // tail fins: a cross of thin plates at the back
        for (const [fx, fy, fz] of [[px, py, 0], [-px, -py, 0], [0, 0, 1], [0, 0, -1]]) {
          const b0 = -L / 2 + L * 0.06, b1 = -L / 2 + L * 0.28, span2 = Rr * 0.9, th = 0.15;
          const P = (s2, out, side) => [x + wx * s2 + fx * out + px * side * (fz ? th : 0), y + wy * s2 + fy * out + py * side * (fz ? th : 0), alt + fz * out + (fz ? 0 : side * th)];
          o.loft(ob, [[P(b0, Rr * 0.3, -1), P(b1, Rr * 0.6, -1), P(b1, Rr * 0.6 + span2, -1), P(b0, Rr * 0.3 + span2 * 0.8, -1)], [P(b0, Rr * 0.3, 1), P(b1, Rr * 0.6, 1), P(b1, Rr * 0.6 + span2, 1), P(b0, Rr * 0.3 + span2 * 0.8, 1)]], "fabric");
        }
        // two rotor pods on short pylons either side, rotors facing the wind
        for (const sd of [-1, 1]) {
          const off = Rr * 1.35, cx = x + px * sd * off + wx * L * 0.12, cy = y + py * sd * off + wy * L * 0.12, cz = alt - Rr * 0.2;
          o.loft(ob, [ring(x + px * sd * Rr * 0.7 + wx * L * 0.1, y + py * sd * Rr * 0.7 + wy * L * 0.1, cz, 0.35, 6), ring(cx, cy, cz, 0.35, 6)].map((r2) => r2), "lip");
          const pod = [];
          for (let j = 0; j <= 4; j++) { const s2 = -3 + 6 * j / 4, f = Math.sqrt(Math.max(0.05, 1 - (s2 / 3) ** 2)); pod.push(Array.from({ length: 10 }, (_, q) => { const t = q * TAU / 10; return [cx + wx * s2 + px * 1.1 * f * Math.cos(t), cy + wy * s2 + py * 1.1 * f * Math.cos(t), cz + 1.1 * f * Math.sin(t)]; })); }
          o.loft(ob, pod, "lip");
          const hub = [cx + wx * 3.2, cy + wy * 3.2];
          o.loft(ob, [0, 0.25].map((s2) => Array.from({ length: 16 }, (_, q) => { const t = q * TAU / 16; return [hub[0] + wx * s2 + px * 5.5 * Math.cos(t), hub[1] + wy * s2 + py * 5.5 * Math.cos(t), cz + 5.5 * Math.sin(t)]; })), "panel");
        }
        o.blimps.push({ x, y, z: alt, ground: g, len: L, r: Rr, wind });
      }
    });
  }

  // ---------------------------------------------------------------- roofs
  // What goes on top of a plot building, drawn from a culture's mix:
  //   deco    a decorative top: a set-back crown with a cornice, and turrets or a finial
  //   open    a usable roof: paved terrace, pergola over part of it, a stair kiosk
  //   garden  a roof garden: soil beds, shrubs and small trees
  //   farm    a roof farm: rows of growing beds and a greenhouse
  // q is a footprint (rectangles get the full treatment), z the parapet top. Returns the extra height.
  const ROOF_KINDS = ["deco", "open", "garden", "farm"];
  function pickRoof(mix, R) {
    const w = ROOF_KINDS.map((k) => Math.max(0, (mix || {})[k] ?? 0)), tot = w.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) return "deco";
    let t = R.random() * tot;
    for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return ROOF_KINDS[i]; }
    return ROOF_KINDS[ROOF_KINDS.length - 1];
  }
  function roofTop(o, ob, ter, q, z, kind, R, treeColl, name) {
    const area = Math.abs(signedArea(q));
    if (area < 50) return 0;
    const rect = q.length === 4;
    // bilinear point in the footprint: u along q0->q1, v along q1->q2
    const P = (u, v) => { const a = [lerp(q[0][0], q[1][0], u), lerp(q[0][1], q[1][1], u)], b = [lerp(q[3][0], q[2][0], u), lerp(q[3][1], q[2][1], u)]; return [lerp(a[0], b[0], v), lerp(a[1], b[1], v)]; };
    const sub = (u0, u1, v0, v1) => (rect ? [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)] : inset(q, Math.min(u0, v0) * Math.sqrt(area)));
    const lu = rect ? dist(q[0], q[1]) : Math.sqrt(area), lv = rect ? dist(q[1], q[2]) : Math.sqrt(area);
    const m = (len, metres) => clamp(metres / len, 0, 0.45);  // metres as a fraction of a side
    const deck = z - 0.55;  // just inside the parapet
    if (kind === "deco") {
      const ins = R.uniform(0.12, 0.22), hgt = clamp(Math.sqrt(area) * R.uniform(0.12, 0.25), 3, 12);
      const crown = sub(ins, 1 - ins, ins, 1 - ins);
      o.prism(ob, crown, deck, z + hgt, "stone");
      o.prism(ob, inset(crown, -0.4), z + hgt, z + hgt + 0.7, "lip");  // cornice
      let extra = hgt + 0.7;
      const v = R.random();
      if (v < 0.4 && rect) {  // corner turrets
        const tw = Math.min(3.5, Math.min(lu, lv) * 0.12), th = R.uniform(2.5, 5);
        for (const [u0, v0] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const fu = m(lu, tw), fv = m(lv, tw), uu = u0 ? 1 - fu : 0, vv = v0 ? 1 - fv : 0;
          o.prism(ob, sub(uu, uu + fu, vv, vv + fv), deck, z + th, "tile");
        }
        extra = Math.max(extra, th);
      } else if (v < 0.75) {  // a stepped finial on the crown
        const s1 = inset(crown, Math.sqrt(Math.abs(signedArea(crown))) * 0.22), s2 = inset(crown, Math.sqrt(Math.abs(signedArea(crown))) * 0.38), f = R.uniform(2, 5);
        o.prism(ob, s1, z + hgt + 0.7, z + hgt + 0.7 + f, "stone");
        o.prism(ob, s2, z + hgt + 0.7 + f, z + hgt + 0.7 + f * 1.8, "tile");
        extra = hgt + 0.7 + f * 1.8;
      }
      return extra;
    }
    if (kind === "open") {
      o.prism(ob, inset(q, 0.4), deck, deck + 0.15, "paver");
      if (rect && lu > 8 && lv > 8) {
        // pergola over one end: posts on a grid, slats across
        const pu0 = R.uniform(0.45, 0.6), ph = 3.2, nu = Math.max(2, Math.round((1 - pu0) * lu / 4)), nv = Math.max(2, Math.round(lv / 4));
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
          const u = lerp(pu0, 0.92, i / nu), vv = lerp(0.08, 0.92, j / nv), c = P(u, vv);
          o.prism(ob, [[c[0] - 0.15, c[1] - 0.15], [c[0] + 0.15, c[1] - 0.15], [c[0] + 0.15, c[1] + 0.15], [c[0] - 0.15, c[1] + 0.15]], deck, deck + ph, "lip");
        }
        for (let i = 0; i <= nu * 2; i++) { const u = lerp(pu0, 0.92, i / (nu * 2)); o.prism(ob, sub(u - 0.004, u + 0.004 + m(lu, 0.12), 0.06, 0.94), deck + ph, deck + ph + 0.18, "lip"); }
        // stair and lift kiosk at the other end
        o.prism(ob, sub(0.06, 0.06 + m(lu, 5), 0.1, 0.1 + m(lv, 4)), deck, deck + 3, "stone");
      }
      return 3.4;
    }
    if (kind === "garden") {
      o.prism(ob, inset(q, 0.6), deck, deck + 0.45, "roof");
      const n = clamp(Math.round(area / 90), 1, 6);
      for (let i = 0; i < n; i++) {
        const c = rect ? P(R.uniform(0.15, 0.85), R.uniform(0.2, 0.8)) : centroid(q);
        tree(o, ter, treeColl, R.choice(["asset_Plant_shrub", "asset_Plant_sapling", "asset_Plant_open", "asset_Plant_fruit"]), c[0], c[1], R, `${name}_rooftree_${i}`, 0.45, 0.75, deck + 0.45);
      }
      return 5;
    }
    // farm: growing beds in rows along the long side, a greenhouse at one end
    o.prism(ob, inset(q, 0.4), deck, deck + 0.12, "paver");
    if (rect && lu > 6 && lv > 6) {
      const along = lu >= lv, L1 = along ? lv : lu, nb = Math.max(1, Math.floor((L1 - 1.5) / 2.2)), gh = R.uniform(0.25, 0.4);
      for (let i = 0; i < nb; i++) {
        const a0 = (0.75 + i * 2.2) / L1, a1 = a0 + 1.3 / L1;
        if (a1 > 0.97) break;
        o.prism(ob, along ? sub(0.06, 1 - gh, a0, a1) : sub(a0, a1, 0.06, 1 - gh), deck + 0.12, deck + 0.6, "roof");
      }
      const g = along ? sub(1 - gh + 0.02, 0.96, 0.08, 0.92) : sub(0.08, 0.92, 1 - gh + 0.02, 0.96);
      o.prism(ob, g, deck + 0.12, deck + 3.6, "glass");
      o.prism(ob, inset(g, 0.8), deck + 3.6, deck + 4.4, "glass");
      return 4.4;
    }
    o.prism(ob, inset(q, 0.8), deck + 0.12, deck + 0.6, "roof");
    return 0.6;
  }

  // ---------------------------------------------------------------- blocks between spokes
  function sectorCuts(plan, spokes, k, rm, r0w, r1w) {
    const sa = spokes[k], sb = spokes[(k + 1) % spokes.length];
    const ha = blockHalf(plan, sa), hb = blockHalf(plan, sb);
    let a0 = edgeAngle(sa, ha, +1, rm), a1 = edgeAngle(sb, hb, -1, rm);
    while (a1 <= a0) a1 += TAU;
    return {
      a0, a1,
      startCut: { ai: edgeAngle(sa, ha, +1, r0w(a0)), ao: edgeAngle(sa, ha, +1, r1w(a0)) },
      endCut: { ai: edgeAngle(sb, hb, -1, r0w(a1)), ao: edgeAngle(sb, hb, -1, r1w(a1)) },
    };
  }

  // Split a ring row into organic blocks: irregular lengths and streets, skewed cuts, the odd plaza.
  function rowBlocks(plan, spokes, key, row, street) {
    const K = plan.skyline, W = wobbler(key + "|wob", row.wobble || 0);
    const r0w = (a) => row.r0 + W.w(a), r1w = (a) => row.r1 + W.w(a) + W.w2(a), rm = (row.r0 + row.r1) / 2;
    const out = [];
    spokes.forEach((sp, k) => {
      const cut = sectorCuts(plan, spokes, k, rm, r0w, r1w), S = (cut.a1 - cut.a0) * rm;
      if (!(S > 8) || !(row.block > 5)) return;
      const R = rng(`${key}|sector|${k}`), segs = [];
      const depth = row.r1 - row.r0;
      let s = 0;
      while (s < S - 1e-6) {
        const L = row.block * (1 + K.block_var * (2 * R.random() - 1));
        const gap = street * (1 + K.street_var * (2 * R.random() - 1));
        const plaza = R.random() < K.plaza_chance;
        // one skew per cross street, shared by the blocks either side so their cuts stay parallel;
        // capped so the street keeps at least half its width at the row edges
        const maxSk = Math.atan2(Math.max(gap, 4) * 0.25 + Math.max(0, Math.min(L, row.block) * 0.25), depth / 2);
        const skew = Math.max(-maxSk, Math.min(maxSk, rad(R.uniform(-K.skew_deg, K.skew_deg))));
        let e = Math.min(S, s + L);
        if (S - e < row.block * 0.45) e = S;  // fold a short remainder into this block
        segs.push({ s, e, plaza, skewAfter: skew });
        s = e + gap;
        if (segs.length > 400) break;
      }
      segs.forEach((g, j) => {
        if (g.plaza || g.e - g.s < 8) return;
        const cutAt = (sPos, skew) => {
          if (sPos <= 1e-6) return cut.startCut;
          if (sPos >= S - 1e-6) return cut.endCut;
          const a = cut.a0 + sPos / rm, sk = Math.tan(skew) * depth / 2 / rm;
          return { ai: a - sk, ao: a + sk };
        };
        const c0 = cutAt(g.s, j > 0 ? segs[j - 1].skewAfter : 0), c1 = cutAt(g.e, g.skewAfter);
        const Q = [polar(r0w(c0.ai), c0.ai), polar(r0w(c1.ai), c1.ai), polar(r1w(c0.ao), c0.ao), polar(r1w(c1.ao), c1.ao)];
        out.push({ k, j, Q, am: cut.a0 + (g.s + g.e) / 2 / rm });
      });
    });
    return out;
  }

  // Lots round a perimeter block (front, back and side wings) or across a solid block.
  function blockLots(plan, Q, wing, R) {
    const K = plan.skyline;
    const Lb = (dist(Q[0], Q[1]) + dist(Q[2], Q[3])) / 2, D = (dist(Q[0], Q[2]) + dist(Q[1], Q[3])) / 2;
    const splits = (len, lo, hi) => { const cuts = [0]; let x = 0; while (len - x > hi) { x += R.uniform(lo, hi); if (len - x < lo) break; cuts.push(x / len); } cuts.push(1); return cuts; };
    const lots = [];
    if (D < 2.6 * wing || Lb < 2.6 * wing) {
      const us = splits(Lb, K.lot[0], K.lot[1]);
      for (let i = 0; i < us.length - 1; i++) lots.push(quadUV(Q, us[i], us[i + 1], 0, 1));
      return lots;
    }
    const wv = wing / D, wu = wing / Lb;
    for (const [v0, v1] of [[0, wv], [1 - wv, 1]]) {
      const us = splits(Lb, K.lot[0], K.lot[1]);
      for (let i = 0; i < us.length - 1; i++) lots.push(quadUV(Q, us[i], us[i + 1], v0, v1));
    }
    for (const [u0, u1] of [[0, wu], [1 - wu, 1]]) {
      const vs = splits(D - 2 * wing, K.lot[0], K.lot[1] * 1.4).map((f) => wv + f * (1 - 2 * wv));
      for (let i = 0; i < vs.length - 1; i++) lots.push(quadUV(Q, u0, u1, vs[i], vs[i + 1]));
    }
    return lots;
  }

  // ---------------------------------------------------------------- ring layout
  // Every ring carries two ring avenues; counted from the centre, the inner one runs clockwise and
  // the outer one anticlockwise. They split the ring into three bands that the districts fill.
  function ringLayout(plan, d) {
    const ring = plan.scene.rings.find((r) => r.id === d.ring);
    const inner = ring.r0 === 0 ? plan.scene.temple.r + (d.garden || 18) : ring.r0 + (d.quay_in ?? 12);
    const outer = ring.r1 - (d.quay_out ?? 12);
    const avenues = [...(d.avenues || [])].sort((a, b) => a.r - b.r).map((a, i) => ({ ...a, dir: i % 2 === 0 ? "cw" : "ccw", idx: i }));
    const edges = [inner, ...avenues.flatMap((a) => [a.r - a.w / 2, a.r + a.w / 2]), outer].map((e) => clamp(e, inner, outer));
    const bands = [];
    for (let i = 0; i < edges.length; i += 2) if (edges[i + 1] - edges[i] > 6) bands.push({ r0: edges[i], r1: edges[i + 1], i: i / 2 });
    return { ring, avenues, bands };
  }
  // split a band into block rows of about row_depth, local streets between them, kept off the edges by
  // the wobble so organic rows never spill into an avenue
  function bandRows(plan, d, band) {
    const depth = band.r1 - band.r0, n = Math.max(1, Math.round((depth + plan.side_street) / (d.row_depth + plan.side_street)));
    const rowD = (depth - (n - 1) * plan.side_street) / n, wob = Math.min(d.wobble || 0, rowD * 0.15), rows = [];
    for (let k = 0; k < n; k++) {
      const r0 = band.r0 + k * (rowD + plan.side_street), r1 = r0 + rowD;
      rows.push({ r0: r0 + wob, r1: r1 - 1.3 * wob, block: d.block, wobble: wob });
    }
    return rows;
  }

  // ---------------------------------------------------------------- voronoi blocks
  // Seeds scattered over each band (between two ring avenues or edges) and sector (between two spokes);
  // each seed's Voronoi cell is clipped to that band and sector, relaxed toward even sizes, then shrunk by
  // half a street so streets open up between neighbouring cells.
  const signedArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const centroid = (p) => {
    let A = 0, x = 0, y = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1]; A += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c; }
    return Math.abs(A) < 1e-9 ? p[0] : [x / (3 * A), y / (3 * A)];
  };
  // keep the side of the line where a*x + b*y <= c (Sutherland–Hodgman against one half-plane)
  function clipHalf(poly, a, b, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const dp = a * P[0] + b * P[1] - c, dq = a * Q[0] + b * Q[1] - c;
      if (dp <= 0) out.push(P);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
    return out;
  }
  // shrink a convex polygon by d (null when it collapses)
  const dedupe = (poly) => poly.filter((q, i) => { const n = poly[(i + 1) % poly.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 0.05; });
  function offsetConvex(poly, d) {
    let p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly);
    if (p.length < 3) return null;
    const n = p.length, lines = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const nx = -dy / L, ny = dx / L;  // inward for a counter-clockwise polygon
      lines.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx, dy });
    }
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const A = lines[(i + lines.length - 1) % lines.length], B = lines[i], den = A.dx * B.dy - A.dy * B.dx;
      if (Math.abs(den) < 1e-9) { out.push([B.px, B.py]); continue; }
      const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
      out.push([A.px + A.dx * t, A.py + A.dy * t]);
    }
    // collapsed if any edge flipped direction or the area went negative
    if (out.length < 3 || signedArea(out) <= 1) return null;
    for (let i = 0; i < out.length; i++) {
      const e = [out[(i + 1) % out.length][0] - out[i][0], out[(i + 1) % out.length][1] - out[i][1]];
      if (e[0] * lines[i].dx + e[1] * lines[i].dy < 0) return null;
    }
    return out;
  }

  // shrink any convex polygon by d by clipping against each edge moved inward; short edges simply vanish
  function insetClip(poly, d) {
    const p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly);
    let out = p;
    for (let i = 0; i < p.length && out.length >= 3; i++) {
      const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const nx = -dy / L, ny = dx / L;  // inward normal: keep n.p >= n.a + d
      out = clipHalf(out, -nx, -ny, -(nx * a[0] + ny * a[1] + d));
    }
    return out.length >= 3 && signedArea(out) > 1 ? out : null;
  }

  // shrink a convex polygon edge by edge: dist(a, b) gives how far each edge moves in (streets are half a
  // street wide, canal banks half a canal wide)
  function insetEdges(poly, dist) {
    const p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly);
    let out = p;
    for (let i = 0; i < p.length && out.length >= 3; i++) {
      const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const nx = -dy / L, ny = dx / L, d = dist(a, b);
      out = clipHalf(out, -nx, -ny, -(nx * a[0] + ny * a[1] + d));
    }
    return out.length >= 3 && signedArea(out) > 1 ? out : null;
  }
  const nodeKey = ([x, y]) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const edgeKey = (a, b) => { const ka = nodeKey(a), kb = nodeKey(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };

  // Canals along Voronoi edges: shortest path through the cells' shared edges from the band's inner side
  // to its outer side, steered toward a target bearing and kept off the band's own boundary.
  function canalPaths(cells, band, targets, opts = {}) {
    const nodes = new Map(), adj = new Map(), blocked = opts.blocked || (() => false);
    const node = (p) => { const k = nodeKey(p); if (!nodes.has(k)) { nodes.set(k, p); adj.set(k, []); } return k; };
    for (const c of cells) {
      if (!c) continue;
      const p = dedupe(c);
      for (let i = 0; i < p.length; i++) {
        if (blocked(...p[i]) || blocked(...p[(i + 1) % p.length])) continue;
        const ka = node(p[i]), kb = node(p[(i + 1) % p.length]);
        if (ka === kb || adj.get(ka).some((e) => e.to === kb)) continue;
        const L = dist(p[i], p[(i + 1) % p.length]);
        adj.get(ka).push({ to: kb, L }); adj.get(kb).push({ to: ka, L });
      }
    }
    const rOf = (k) => Math.hypot(...nodes.get(k)), onIn = (k) => rOf(k) <= band.r0 + 6, onOut = (k) => rOf(k) >= band.r1 - 6;
    const paths = [];
    for (const [ti, target] of targets.entries()) {
      const dev = (k) => { const [x, y] = nodes.get(k); return angDist(Math.atan2(y, x), target) * Math.hypot(x, y); };
      // continue from where this canal left the band inside, so it crosses the avenue straight
      const startB = (opts.startBearings || [])[ti];
      const startCost = (k) => { const [x, y] = nodes.get(k); return startB == null ? dev(k) * 4 : angDist(Math.atan2(y, x), startB) * Math.hypot(x, y) * 12; };
      const D = new Map(), prev = new Map(), done = new Set(), heap = [];
      for (const k of nodes.keys()) if (onIn(k)) { const c0 = startCost(k); D.set(k, c0); heap.push([c0, k]); }
      let end = null;
      while (heap.length) {
        heap.sort((a, b) => a[0] - b[0]);
        const [dk, k] = heap.shift();
        if (done.has(k)) continue;
        done.add(k);
        if (onOut(k)) { end = k; break; }
        for (const e of adj.get(k)) {
          if (done.has(e.to)) continue;
          // run along the band boundary costs a lot; drifting from the target bearing costs more as it grows
          const along = (onIn(k) && onIn(e.to)) || (onOut(k) && onOut(e.to)) ? 12 : 1;
          const c = dk + e.L * along * (1 + (dev(e.to) / 60) ** 2);
          if (c < (D.get(e.to) ?? Infinity)) { D.set(e.to, c); prev.set(e.to, k); heap.push([c, e.to]); }
        }
      }
      if (!end) { paths.push(null); continue; }
      const path = [];
      for (let k = end; k; k = prev.get(k)) path.unshift(nodes.get(k));
      paths.push(path);
    }
    return paths;
  }

  // on a canal's water (or within `extra` of it), quay included when asked
  const onCanalLine = (o, x, y, extra = 0, withQuay = true) => o.canalLines.some((cl) => distToPath(x, y, cl.line) < cl.width / 2 + (withQuay ? cl.quay || 0 : 0) + extra)
    || o.basins.some((b) => { const q = b.poly; let ins = false; for (let a = 0, c = q.length - 1; a < q.length; c = a++) if ((q[a][1] > y) !== (q[c][1] > y) && x < (q[c][0] - q[a][0]) * (y - q[a][1]) / (q[c][1] - q[a][1]) + q[a][0]) ins = !ins; return ins; });
  // a cell edge is a canal bank when it lies along a canal: its middle on the line and both ends close
  // (ends at the band boundary come from each cell's own clip, so they can sit a metre or two off)
  const bankOf = (canals, p, q) => canals.some((cn) => distToPath((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, cn.path) < 1 && distToPath(...p, cn.path) < 3.5 && distToPath(...q, cn.path) < 3.5);

  function voronoiCells(plan, spokes, key, band, spacing, street, canal) {
    const V = plan.voronoi || {}, jitter = V.jitter ?? 0.8, relax = V.relax ?? 1;
    const [sr, st] = spacing, out = [], canals = [], adj = [];
    spokes.forEach((sp, k) => {
      const sb = spokes[(k + 1) % spokes.length], ha = blockHalf(plan, sp), hb = blockHalf(plan, sb);
      const R = rng(`${key}|vor|${band.i}|${k}`);
      // jittered polar grid of seeds across the band and sector
      let seeds = [];
      const rows = Math.max(1, Math.round((band.r1 - band.r0) / sr));
      for (let ri = 0; ri < rows; ri++) {
        const r = band.r0 + (ri + 0.5) * (band.r1 - band.r0) / rows;
        let a0 = edgeAngle(sp, ha, +1, r), a1 = edgeAngle(sb, hb, -1, r);
        while (a1 <= a0) a1 += TAU;
        const n = Math.max(1, Math.round((a1 - a0) * r / st)), off = R.random();
        for (let j = 0; j < n; j++) {
          const rr = r + (R.random() - 0.5) * jitter * (band.r1 - band.r0) / rows;
          const aa = a0 + (j + (off + (R.random() - 0.5) * jitter) % 1) * (a1 - a0) / n;
          seeds.push(polar(clamp(rr, band.r0 + 1, band.r1 - 1), aa));
        }
      }
      if (!seeds.length) return;
      const span = Math.max(sr, st) * 2.6;
      const cellsOf = (seeds) => {
        // bucket seeds so each cell only clips against its neighbours
        const B = new Map(), bs = Math.max(sr, st), keyOf = (x, y) => `${Math.floor(x / bs)},${Math.floor(y / bs)}`;
        seeds.forEach((s, i) => { const kk = keyOf(...s); (B.get(kk) || B.set(kk, []).get(kk)).push(i); });
        return seeds.map((s, i) => {
          let c = [[s[0] - span, s[1] - span], [s[0] + span, s[1] - span], [s[0] + span, s[1] + span], [s[0] - span, s[1] + span]];
          const gx = Math.floor(s[0] / bs), gy = Math.floor(s[1] / bs);
          for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (const j of B.get(`${gx + dx},${gy + dy}`) || []) {
            if (j === i || c.length < 3) continue;
            const q = seeds[j], a = q[0] - s[0], b = q[1] - s[1];
            c = clipHalf(c, a, b, (q[0] * q[0] + q[1] * q[1] - s[0] * s[0] - s[1] * s[1]) / 2);
          }
          // stay out of both spoke corridors
          for (const [spk, h, side] of [[sp, ha, +1], [sb, hb, -1]]) {
            const nx = -Math.sin(spk.a), ny = Math.cos(spk.a);
            c = side > 0 ? clipHalf(c, -nx, -ny, -h) : clipHalf(c, nx, ny, -h);
          }
          // and inside the band: tangent lines at the seed's bearing (stray corners are pulled in later)
          const ua = Math.atan2(s[1], s[0]), ux = Math.cos(ua), uy = Math.sin(ua);
          c = clipHalf(clipHalf(c, -ux, -uy, -band.r0), ux, uy, band.r1);
          return c.length >= 3 ? c : null;
        });
      };
      let cells = cellsOf(seeds);
      for (let it = 0; it < relax; it++) {  // Lloyd relaxation: move each seed to its cell's centroid
        seeds = seeds.map((s, i) => (cells[i] ? centroid(cells[i]) : s));
        cells = cellsOf(seeds);
      }
      // canals: evenly spread across the sector, each threading the cell edges from inner to outer side
      const wet = new Set(), sectorCanals = [];
      if (canal && canal.per_sector > 0) {
        const rm = (band.r0 + band.r1) / 2;
        let a0 = edgeAngle(sp, ha, +1, rm), a1 = edgeAngle(sb, hb, -1, rm);
        while (a1 <= a0) a1 += TAU;
        const CR = rng(`${key}|canal|${k}`);
        const targets = Array.from({ length: canal.per_sector }, (_, c) => a0 + (c + 0.5 + CR.uniform(-0.15, 0.15)) * (a1 - a0) / canal.per_sector);
        const keep = canal.width / 2 + (canal.quay || 0) + 2;
        const blocked = (x, y) => inCorridor(plan, spokes, x, y, keep) || inHeroWedge(plan, spokes, x, y, keep);
        const startBearings = targets.map((_, c) => canal.prev?.get(`${k}|${c}`));
        canalPaths(cells, band, targets, { blocked, startBearings }).forEach((path, c) => {
          if (!path) return;
          // pick up exactly where the canal left the last band, so it crosses the avenue square on
          const sb2 = startBearings[c];
          if (sb2 != null) { const r0p = Math.hypot(...path[0]); if (angDist(Math.atan2(path[0][1], path[0][0]), sb2) * r0p < 80) path[0] = polar(r0p, sb2); }
          sectorCanals.push({ k, c, path });
          const e = path[path.length - 1];
          canal.prev?.set(`${k}|${c}`, Math.atan2(e[1], e[0]));
        });
      }
      canals.push(...sectorCanals);
      const kept = new Map();  // raw cell index -> index in out
      cells.forEach((c, i) => {
        if (!c) return;
        const CR = rng(`${key}|vor|${band.i}|${k}|${i}`);
        const gap = street / 2 * (1 + (plan.skyline.street_var || 0) * (2 * CR.random() - 1));
        const cw = canal ? canal.width / 2 + (canal.quay || 0) : gap;
        // an edge is a canal bank when both its ends lie on a canal line (matching corners alone misses
        // edges whose ends were computed separately at the band boundary)
        const onCanal = (p, q) => bankOf(sectorCanals, p, q);
        let b = insetEdges(c, (p, q) => (onCanal(p, q) ? Math.max(cw, gap) : gap));
        if (!b) return;
        // keep the whole plot clear of the water and quay, also where a canal only touches it at a bend
        if (canal) for (const cn of sectorCanals) {
          for (let si = 0; si < cn.path.length - 1 && b.length >= 3; si++) {
            const A = cn.path[si], B = cn.path[si + 1], Ls = dist(A, B); if (Ls < 0.5) continue;
            const ux = (B[0] - A[0]) / Ls, uy = (B[1] - A[1]) / Ls, nx = -uy, ny = ux, cen = centroid(b), sd = Math.sign(nx * (cen[0] - A[0]) + ny * (cen[1] - A[1])) || 1;
            const intrudes = b.some(([x, y]) => { const t = ux * (x - A[0]) + uy * (y - A[1]), d2 = sd * (nx * (x - A[0]) + ny * (y - A[1])); return t > 0 && t < Ls && d2 < cw - 0.05; });
            if (intrudes) b = clipHalf(b, -sd * nx, -sd * ny, -sd * (nx * A[0] + ny * A[1]) - cw);
          }
          for (const v of cn.path) {
            if (b.length < 3) break;
            const cen = centroid(b), dv = dist(v, cen) || 1, ux = (cen[0] - v[0]) / dv, uy = (cen[1] - v[1]) / dv;
            if (b.some(([x, y]) => Math.hypot(x - v[0], y - v[1]) < cw - 0.05)) b = clipHalf(b, -ux, -uy, -(ux * v[0] + uy * v[1]) - cw);
          }
        }
        if (b.length < 3) return;
        b = b.map(([x, y]) => { const r = Math.hypot(x, y), rc = clamp(r, band.r0 + gap, band.r1 - gap); return r > 1e-9 ? [x * rc / r, y * rc / r] : [x, y]; });
        if (Math.abs(signedArea(b)) < 250) return;
        kept.set(i, out.length);
        out.push({ k, j: i, poly: b, raw: c, plaza: CR.random() < plan.skyline.plaza_chance, R: CR, canalPaths: sectorCanals.map((cn) => cn.path) });
      });
      // neighbouring cells: pairs sharing a Voronoi edge (a street, or a cell-edge canal)
      const byEdge = new Map();
      cells.forEach((c, i) => { if (!c || !kept.has(i)) return; const p = dedupe(c); for (let e = 0; e < p.length; e++) { const a = p[e], b = p[(e + 1) % p.length]; if (dist(a, b) < 6) continue; const kk = edgeKey(a, b); (byEdge.get(kk) || byEdge.set(kk, []).get(kk)).push([i, a, b]); } });
      for (const [, list] of byEdge) if (list.length === 2) {
        const [, p, q] = list[0];
        adj.push({ a: kept.get(list[0][0]), b: kept.get(list[1][0]), p, q, wet: bankOf(sectorCanals, p, q) });
      }
    });
    return { cells: out, canals, adj };
  }

  // ---------------------------------------------------------------- neighbourhoods
  // A second, coarse Voronoi grid of neighbourhood seeds. Every building cell joins its nearest seed,
  // measured from a noise-warped position, so neighbourhoods are organic blobs whose edges follow the
  // building cells. With span_rings (default) a blob reaches across the ring canals into the next ring;
  // otherwise cells only join seeds in their own ring. Each seed gets one of up to six types from its
  // home ring's weights and a generated name.
  // A district can opt out of the blobs with `neighbourhood`: {mode: "whole"} makes its ring one
  // neighbourhood; {mode: "spokes", per: 2} splits it at every per-th spoke (from start_spoke), so
  // the college ring becomes three colleges of two spoke sectors each.
  const NB_WORDS = ["Coral", "Heron", "Tide", "Salt", "Amber", "Lantern", "Laurel", "Cedar", "Orchard", "Gull", "Kelp", "Reed",
    "Marble", "Copper", "Lark", "Myrtle", "Pearl", "Brine", "Willow", "Saffron", "Fig", "Olive", "Swan", "Cobalt", "Sable",
    "Juniper", "Moss", "Quill", "Bell", "Linden", "Wren", "Thistle", "Ember", "Shell", "Clover", "Ivory", "Rook", "Hazel",
    "Mariner", "Plover", "Bramble", "Garnet", "Sorrel", "Cormorant", "Tansy", "Alder", "Basalt", "Lapis", "Rosemary", "Kestrel"];
  function makeNeighbourhoods(plan) {
    const N = plan.neighbourhoods;
    if (!N || N.enabled === false || !(N.types || []).length) return null;
    const types = N.types.slice(0, 6);
    const fixedD = plan.districts.filter((d) => d.enabled !== false && d.neighbourhood && d.neighbourhood.mode);
    const fixedRing = new Map(fixedD.map((d) => [d.ring, d]));
    const rings = plan.scene.rings.filter((r) => r.kind === "land" && !fixedRing.has(r.id) && plan.districts.some((d) => d.ring === r.id && d.layout === "voronoi" && d.enabled !== false));
    const area = rings.reduce((t, r) => t + Math.PI * (r.r1 * r.r1 - r.r0 * r.r0), 0);
    const sp = Math.sqrt(area / Math.max(1, N.count || 40)), R = rng(`nb|seeds|${N.seed || 0}`), seeds = [];
    const ext = Math.max(...rings.map((r) => r.r1));
    for (let y = -ext; rings.length && y <= ext; y += sp) for (let x = -ext; x <= ext; x += sp) {
      const px = x + (R.random() - 0.5) * sp * 0.9, py = y + (R.random() - 0.5) * sp * 0.9, r = Math.hypot(px, py);
      const ring = rings.find((g) => r >= g.r0 && r < g.r1);
      if (!ring) continue;
      const d = plan.districts.find((dd) => dd.ring === ring.id), w = types.map((t) => Math.max(0, (d.neighbourhood_weights || {})[t.id] ?? 1));
      let tw = w.reduce((a, b) => a + b, 0) * R.random(), ti = 0;
      for (; ti < w.length - 1; ti++) { tw -= w[ti]; if (tw <= 0) break; }
      seeds.push({ id: `n${seeds.length}`, x: px, y: py, ring: ring.id, d: d.id, type: types[ti].id, cells: 0, sx: 0, sy: 0 });
    }
    // fixed neighbourhoods: stable ids (`<district>` or `<district>-<group>`) so renames survive a reseed
    const spk = spokeAngles(plan), step = TAU / spk.length, fixedSeeds = new Map();
    for (const d of fixedD) {
      const F = d.neighbourhood, type = types.some((t) => t.id === F.type) ? F.type : types[0].id;
      const per = Math.max(1, Math.min(spk.length, F.per || 2)), groups = F.mode === "spokes" ? Math.ceil(spk.length / per) : 1;
      fixedSeeds.set(d.ring, Array.from({ length: groups }, (_, g) => ({ id: groups > 1 ? `${d.id}-${g}` : d.id, ring: d.ring, d: d.id, type, names: F.names, per, start: spk[(F.start_spoke || 0) % spk.length].a, cells: 0, sx: 0, sy: 0 })));
    }
    // names: a seeded word plus the type's naming pattern, never repeating a word
    const words = [...NB_WORDS], NR = rng(`nb|names|${N.seed || 0}`);
    for (let i = words.length - 1; i > 0; i--) { const j = Math.floor(NR.random() * (i + 1)); [words[i], words[j]] = [words[j], words[i]]; }
    const allSeeds = [...seeds, ...[...fixedSeeds.values()].flat()];
    allSeeds.forEach((s, i) => {
      const t = types.find((tt) => tt.id === s.type), pats = (s.names && s.names.length) ? s.names : (t.names && t.names.length) ? t.names : ["{W} Quarter"];
      const w = words[i % words.length] + (i >= words.length ? ` ${Math.floor(i / words.length) + 1}` : "");
      const pat = pats[Math.floor(NR.random() * pats.length)];
      s.auto = pat.replace("{W}", w).replace("{w}", w.toLowerCase());
      s.name = (N.renames || {})[s.id] || s.auto;
    });
    const byRing = new Map(), span = N.span_rings !== false;
    for (const s of seeds) (byRing.get(s.ring) || byRing.set(s.ring, []).get(s.ring)).push(s);
    const warp = (N.warp ?? 0.6) * sp, ws = N.warp_scale || 600;
    const assign = (x, y, ringId) => {
      const fx = fixedSeeds.get(ringId);
      if (fx) {
        if (fx.length === 1) return fx[0];
        const t = ((Math.atan2(y, x) - fx[0].start) % TAU + TAU) % TAU;
        return fx[Math.min(fx.length - 1, Math.floor(Math.floor(t / step) / fx[0].per))];
      }
      const wx = x + warp * valueNoise(x / ws, y / ws, 911), wy = y + warp * valueNoise(x / ws + 5.3, y / ws - 2.1, 912);
      let best = null, bd = Infinity;
      for (const s of span ? seeds : byRing.get(ringId) || []) { const dd = (s.x - wx) ** 2 + (s.y - wy) ** 2; if (dd < bd) { bd = dd; best = s; } }
      return best;
    };
    return { seeds: allSeeds, types, typeOf: (id) => types.find((t) => t.id === id), assign, fixedRing };
  }

  // ---------------------------------------------------------------- land use
  // Every Voronoi cell gets a use. Each ring has a recipe: weights by use at the waterfront and inland,
  // blended by how far the cell is from water (ring canals and the cell-edge canals). Soft per-use noise
  // clusters the picks into neighbourhoods.
  // recipe uses, plus the water uses that only appear on ring-canal frontage by chance
  const RECIPE_USES = ["residential", "commercial", "industrial", "hydroponics", "entertainment", "park", "college"];
  const USES = [...RECIPE_USES, "harbour", "waterworks"];
  function pickUse(plan, d, x, y, wf, R, nbType) {
    const LU = plan.landuse || {}, rec = d.recipe || {}, w = [];
    for (const [ui, u] of RECIPE_USES.entries()) {
      let v = lerp(rec.waterfront?.[u] || 0, rec.inland?.[u] || 0, wf) * ((nbType && nbType.bias && nbType.bias[u] != null) ? nbType.bias[u] : 1);
      if (v > 0 && LU.clustering) {
        let n = 0, amp = 1, norm = 0, f = 1 / (LU.cluster_scale || 450);
        for (let oc = 0; oc < 3; oc++) { n += amp * valueNoise(x * f + 31.7 * ui, y * f - 12.9 * ui, 7001 + ui * 97 + oc * 13); norm += amp; amp *= 0.5; f *= 2; }
        v *= Math.pow(2, LU.clustering * 1.8 * n / norm);
      }
      w.push(v);
    }
    const total = w.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return "residential";
    let t = R.random() * total;
    for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return RECIPE_USES[i]; }
    return RECIPE_USES[RECIPE_USES.length - 1];
  }
  const distToPath = (x, y, path) => {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
  // the long axis of a polygon, for sheds and greenhouse halls
  function longAxis(p) {
    let best = 0, ex = 1, ey = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b); if (L > best) { best = L; ex = (b[0] - a[0]) / L; ey = (b[1] - a[1]) / L; } }
    return [ex, ey];
  }
  function strips(p, ex, ey, widths, gap, R) {
    const proj = p.map(([x, y]) => x * ex + y * ey), lo = Math.min(...proj), hi = Math.max(...proj), out = [];
    let s = lo;
    while (s < hi - 1e-6) {
      let e = s + R.uniform(widths[0], widths[1]);
      if (hi - e < widths[0] * 0.6) e = hi;
      const q = clipHalf(clipHalf(p, -ex, -ey, -s), ex, ey, e);
      if (q.length >= 3 && Math.abs(signedArea(q)) > 40) out.push(q);
      s = e + gap;
    }
    return out;
  }

  // Build one cell as its use: footprints with storeys (and storey height), plus park planting.
  function buildUse(plan, d, ter, o, ob, use, cell, key, opts) {
    const LU = plan.landuse || {}, T = (LU.types || {})[use] || {}, R = cell.R, poly = cell.poly;
    const [cx, cy] = centroid(poly), cloudM = cloudMul(plan, cx, cy);
    const parts = [];  // [poly, storeys, storeyHeight, roofMat]
    // plots (default): the cell is a plot of separate, squared-off buildings, each with its own height;
    // a neighbourhood's culture can restyle them (plan.neighbourhoods.types[].style)
    const PL = plan.plots || {}, byBldg = (PL.layout || "buildings") === "buildings";
    // blank fields from the page fall back to the city default; ranges edited one end at a time come
    // through as {0: a, 1: b} objects, so read them back into pairs
    const pair = (v, dflt) => (v == null ? dflt : Array.isArray(v) ? v : [v[0] ?? (dflt || [0, 0])[0], v[1] ?? (dflt || [0, 0])[1]]);
    const nbS = Object.fromEntries(Object.entries(opts.nbStyle || {}).filter(([, v]) => v !== "" && v != null));
    const style = { gap: PL.gap, setback: PL.setback, height_var: PL.height_var, roof: PL.roof, ...nbS };
    style.gap = pair(style.gap, [0, 0]); if (style.lot) style.lot = pair(style.lot, T.lot || plan.skyline.lot);
    // the plot's ground plate follows the slope corner to corner, so it meets the quays and streets
    const ground = (q, m) => { const top = q.map(([x, y]) => [x, y, ter.G(Math.hypot(x, y)) + 0.12]); o.solid(ob, top, top.map((t) => Math.min(...top.map((u) => u[2])) - 0.42), m); };
    if (use === "harbour" || use === "waterworks") return buildWaterCell(plan, d, ter, o, ob, use, cell, key, opts);
    if (use === "park") {
      ground(poly, "roof");
      o.parks.push(poly);
      const sp = T.tree_spacing || 14, [ax, ay] = longAxis(poly);
      for (const q of strips(poly, ax, ay, [sp, sp], 0, R)) {
        const [qx, qy] = centroid(q);
        if (R.random() < (T.clearing ?? 0.35)) continue;
        const TR = rng(`${key}|tree|${Math.round(qx)}|${Math.round(qy)}`);
        // scatter along the strip
        const [ex, ey] = [-ay, ax], proj = q.map(([x, y]) => x * ex + y * ey), lo = Math.min(...proj), hi = Math.max(...proj);
        for (let s = lo + sp / 2; s < hi; s += sp) {
          const x = qx + ex * (s - (qx * ex + qy * ey)) + TR.uniform(-3, 3), y = qy + ey * (s - (qx * ex + qy * ey)) + TR.uniform(-3, 3);
          const Cn = d.canals || {};
          if (!pointInPoly(x, y, poly) || onCanalLine(o, x, y, 1.5) || (cell.canalPaths || []).some((pth) => distToPath(x, y, pth) < (Cn.width || 0) / 2 + (Cn.quay || 0) + 1.5)) continue;
          tree(o, ter, d.id, TR.choice(PALETTE.grove), x, y, TR, `NBHD_${d.id}_park_${key.replace(/\|/g, "_")}_${o.trees.length}`, 0.8, 1.3);
        }
      }
      return;
    }
    if (use === "industrial") {
      ground(poly, "paver");  // yard
      const core = (byBldg && solidRect(insetEdges(poly, () => 4) || poly)) || insetEdges(poly, () => 4) || poly, [ex, ey] = longAxis(core);
      for (const q of strips(core, -ey, ex, T.bay || [26, 48], 6, R)) parts.push([q, R.randint(...(T.storeys || [1, 2])), T.storey || 7.5, "lip"]);
    } else if (use === "hydroponics") {
      ground(poly, "paver");
      const core = (byBldg && solidRect(insetEdges(poly, () => 3) || poly)) || insetEdges(poly, () => 3) || poly, [ex, ey] = longAxis(core);
      for (const q of strips(core, -ey, ex, T.hall || [12, 16], 4, R)) parts.push([q, R.randint(...(T.storeys || [2, 4])), T.storey || 4.5, "glass"]);
    } else if (use === "entertainment") {
      ground(poly, "paver");  // plaza round the venue
      const vIn = insetEdges(poly, () => Math.max(6, Math.sqrt(Math.abs(signedArea(poly))) * 0.16)) || poly, venue = (byBldg && solidRect(vIn)) || vIn;
      parts.push([venue, R.randint(...(T.storeys || [3, 6])), T.storey || 6, "lip"]);
    } else if (use === "college") {
      const K = plan.skyline, lo = (d.storeys || [2, 6])[0], hi = (d.storeys || [2, 6])[1];
      if (byBldg) ground(poly, "paver");
      for (const q of byBldg ? plotBuildings(plan, poly, { depth: opts.wing || 13, ...style }, R) : cellLots(plan, poly, (opts.wing || 13), R)) parts.push([q, clamp(Math.round(R.uniform(lo, hi) * Math.exp(K.chaos * 0.6 * R.normal())), 1, hi + 3), plan.storey, "roof"]);
    } else {
      // residential and commercial: lots round a courtyard (commercial: bigger lots, deeper wings, taller)
      const lotPlan = T.lot ? { ...plan, skyline: { ...plan.skyline, lot: T.lot } } : plan;
      const C = d.canals || {}, reach = (C.width || 0) / 2 + (C.quay || 0) + (opts.gap || 6) + 3;
      const canalFront = (cell.canalPaths || []).length ? (a, b) => cell.canalPaths.some((pth) => distToPath((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pth) < reach) : null;
      if (byBldg) ground(poly, "paver");  // the plot: yards and courtyards round the buildings
      const lots = byBldg ? plotBuildings(plan, poly, { lot: T.lot || plan.skyline.lot, depth: T.wing || opts.wing || 13, ...style }, R, canalFront) : cellLots(lotPlan, poly, T.wing || opts.wing, R, canalFront);
      for (const q of lots) parts.push([q, null, plan.storey, "roof"]);
    }
    // one roof height per cell by default, so a block reads as one building instead of stripes of lots
    const perCell = !byBldg && (plan.skyline.roof_by || "cell") === "cell";
    const cellSt = storeysAt(plan, cx, cy, rng(`${key}|roof`), (d.height_scale || 1) * (T.height || 1) * (opts.nbHeight || 1));
    const cellFixed = parts.length ? parts[0][1] : null;
    const summary = { use, base: Infinity, top: Infinity };
    for (const [li, [q, st0, sh, roofM]] of parts.entries()) {
      const LR = rng(`${key}|${li}`), [qx, qy] = centroid(q);
      const hv = style.height_var ?? 0.22, own = byBldg ? Math.exp(hv * LR.normal()) : 1;
      const st = st0 == null
        ? clamp(Math.round(byBldg ? cellSt * own : perCell ? cellSt : storeysAt(plan, qx, qy, LR, (d.height_scale || 1) * (T.height || 1) * (opts.nbHeight || 1))), plan.skyline.min, Math.round(plan.skyline.max * (T.height || 1)))
        : clamp(Math.round((perCell && cellFixed != null ? cellFixed : st0) * cloudM * (opts.nbHeight || 1)), 1, 60);
      if (!byBldg && q.canal || (byBldg && style.roof === "gable" && q.length === 4)) {  // a canal house (or a gabled culture): its own height, a storey either side of the block, under a gable
        const cs = clamp(st + LR.randint(-1, 1), plan.skyline.min, plan.skyline.max);
        const bld = building(o, ob, ter, q, cs * sh, use, { roof: false, lip: false });
        const top = bld.top, ridge = top + Math.min(8, dist(q[0], q[1]) * 0.75);
        const mf = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], mb = [(q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2];
        // two roof halves, ridge running from the canal back into the block, gable end facing the water
        o.solid(ob, [[...q[0], top], [...mf, ridge], [...mb, ridge], [...q[3], top]], [top, top, top, top], "tile");
        o.solid(ob, [[...mf, ridge], [...q[1], top], [...q[2], top], [...mb, ridge]], [top, top, top, top], "tile");
        o.lots.push({ d: d.id, use, nb: opts.nb, row: opts.row, key: `${key}|${li}`, poly: q, base: bld.base, top: ridge, storeys: cs, plinth: bld.plinth, area: polyArea(q), label: q.canal ? "Canal house" : (T.label || use) });
        o.band(`${d.id}|${opts.row}`, opts.band.r0, opts.band.r1, bld.base, ridge);
        summary.base = Math.min(summary.base, bld.base); summary.top = Math.min(summary.top, top);
        continue;
      }
      // plot buildings get a roof from the culture's mix (halls and greenhouses keep their plain roofs);
      // canal houses lean to decorative tops and terraces
      const roofKind = byBldg && use !== "industrial" && use !== "hydroponics" ? pickRoof(q.canal ? { deco: 0.6, open: 0.3, garden: 0.1 } : style.roofs || PL.roofs, LR) : null;
      const bld = building(o, ob, ter, q, (q.canal ? clamp(st + LR.randint(-1, 1), plan.skyline.min, plan.skyline.max) : st) * sh, use, { roofMat: roofM, roof: !roofKind });
      const extra = roofKind ? roofTop(o, ob, ter, q, bld.top, roofKind, LR, d.id, `NBHD_${d.id}_${key.replace(/\|/g, "_")}_${li}`) : 0;
      o.lots.push({ d: d.id, use, nb: opts.nb, row: opts.row, key: `${key}|${li}`, poly: q, base: bld.base, top: bld.top + extra, roofTop: bld.top, roof: roofKind, storeys: st, plinth: bld.plinth, area: polyArea(q), label: q.canal ? "Canal house" : T.label || use });
      o.band(`${d.id}|${opts.row}`, opts.band.r0, opts.band.r1, bld.base, bld.top);
      summary.base = Math.min(summary.base, bld.base); summary.top = Math.min(summary.top, bld.top);
    }
    return summary;
  }

  // A cell on a ring canal turned into water: a boat harbour (basin, quays, piers) or a waterworks
  // (settling tanks and a pump hall), each with a channel cut through the quay to the ring canal.
  function buildWaterCell(plan, d, ter, o, ob, use, cell, key, opts) {
    const R = cell.R, poly = cell.poly, band = opts.band, side = opts.waterSide, wl = opts.waterLevel;
    const [cx, cy] = centroid(poly), am = Math.atan2(cy, cx), gz = ter.G(Math.hypot(cx, cy));
    const near = poly.filter(([x, y]) => (side < 0 ? Math.hypot(x, y) <= band.r0 + opts.gap + 4 : Math.hypot(x, y) >= band.r1 - opts.gap - 4));
    const span = near.length >= 2 ? Math.max(...near.map(([x, y]) => angDist(Math.atan2(y, x), am))) * Math.hypot(cx, cy) : 20;
    const r0 = side < 0 ? opts.ringEdge - 2 : band.r1 - opts.gap - 6, r1 = side < 0 ? band.r0 + opts.gap + 6 : opts.ringEdge + 2;
    const chan = (hw) => { const rm = (r0 + r1) / 2, da = hw / rm; return [polar(r0, am - da), polar(r1, am - da), polar(r1, am + da), polar(r0, am + da)]; };
    const water = [], gAt = (x, y) => ter.G(clamp(Math.hypot(x, y), band.r0 + 0.1, band.r1 - 0.1));
    // the channel to the ring canal: a strip between two bearings, cut through everything on the cell
    const chw = Math.min(12, Math.max(5, span * 0.35)), cda = chw / ((r0 + r1) / 2), ch = chan(chw);
    const nA = [-Math.sin(am + cda), Math.cos(am + cda)], nB = [-Math.sin(am - cda), Math.cos(am - cda)];
    const inChan = (x, y) => nA[0] * x + nA[1] * y < 0 && nB[0] * x + nB[1] * y > 0;
    const besideChan = (q) => [clipHalf(q, -nA[0], -nA[1], 0), clipHalf(q, nB[0], nB[1], 0)].filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 4);
    if (use === "harbour") {
      const basin = insetEdges(poly, () => 2) || poly;
      o.prism(ob, basin, wl - 3, wl, "water");
      water.push(basin);
      for (let i = 0; i < basin.length; i++) {  // quay walls round the basin, open where the channel enters
        const a = basin[i], b = basin[(i + 1) % basin.length], L = dist(a, b);
        if (L < 1) continue;
        const nx = -(b[1] - a[1]) / L * 2, ny = (b[0] - a[0]) / L * 2, n = Math.max(1, Math.ceil(L / 2));
        for (let k = 0; k < n; k++) {
          const p0 = [lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)], p1 = [lerp(a[0], b[0], (k + 1) / n), lerp(a[1], b[1], (k + 1) / n)];
          if (inChan((p0[0] + p1[0]) / 2 - nx / 2, (p0[1] + p1[1]) / 2 - ny / 2)) continue;
          const top = [p0, p1, [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]].map(([x, y]) => [x, y, Math.max(gAt(x, y), wl + 0.6) + 0.35]);
          o.solid(ob, top, top.map(() => wl - 3), "stone");
        }
      }
      const [ex, ey] = longAxis(basin), n = R.randint(2, 4);  // piers out from the long side
      const proj = basin.map(([x, y]) => x * ex + y * ey), lo = Math.min(...proj), hi = Math.max(...proj);
      for (let i = 1; i <= n; i++) {
        const s = lo + (hi - lo) * i / (n + 1), pier = clipHalf(clipHalf(basin, -ex, -ey, -(s - 1.6)), ex, ey, s + 1.6);
        const [px, py] = longAxis(pier), cut = clipHalf(pier, px * 0 + ey, -ex, ey * cx - ex * cy);
        if (cut.length >= 3 && !cut.some(([x, y]) => inChan(x, y))) o.prism(ob, cut, wl - 2, wl + 1.1, "paver");
      }
    } else {
      for (const q of besideChan(poly)) ground(q);  // yard paving either side of the channel
      const core0 = insetEdges(poly, () => 6) || poly, sides = besideChan(core0).sort((p1, p2) => Math.abs(signedArea(p2)) - Math.abs(signedArea(p1)));
      const core = sides[0] ? insetEdges(sides[0], () => 3) : null;
      if (!core || Math.abs(signedArea(core)) < 200) { water.push(ch); o.prism(ob, ch, wl - 3, wl, "water"); o.basins.push(...water.map((p) => ({ use, poly: p }))); o.canalCuts.push({ poly: ch, z0: wl - 4, z1: gz + 4 }); return null; }
      const [ex, ey] = longAxis(core), area = Math.abs(signedArea(core));
      const rr = clamp(Math.sqrt(area) * 0.16, 6, 14), n = clamp(Math.floor(Math.sqrt(area) / (rr * 2.6)), 1, 4);
      const [kx, ky] = centroid(core), proj = core.map(([x, y]) => x * ex + y * ey), lo = Math.min(...proj), hi = Math.max(...proj), mid = kx * -ey + ky * ex;
      const hallEnd = lo + Math.min(24, (hi - lo) * 0.3), t0 = hallEnd + rr + 2, t1 = hi - rr - 1;
      const nT = t1 >= t0 ? Math.min(n, 1 + Math.floor((t1 - t0) / (2 * rr + 2))) : 0;
      for (let i = 0; i < nT; i++) {  // round settling tanks in a row along the long axis, clear of the hall
        const s = nT === 1 ? (t0 + t1) / 2 : t0 + (t1 - t0) * i / (nT - 1);
        const tx = ex * s - ey * mid, ty = ey * s + ex * mid, ring = [], inner = [];
        for (let k = 0; k < 20; k++) { const t = k * TAU / 20; ring.push([tx + rr * Math.cos(t), ty + rr * Math.sin(t)]); inner.push([tx + (rr - 1) * Math.cos(t), ty + (rr - 1) * Math.sin(t)]); }
        const tg = ring.map(([x, y]) => gAt(x, y)), tb = Math.min(...tg) - 0.3, tt = Math.max(...tg) + 0.12 + 3.2;
        o.prism(ob, ring, tb, tt, "stone");
        o.prism(ob, inner, tt, tt + 0.1, "water");
        o.tanks.push({ x: tx, y: ty, r: rr });
      }
      const hall = clipHalf(core, ex, ey, hallEnd);  // pump hall at one end
      if (hall.length >= 3) {
        const bld = building(o, ob, ter, hall, R.randint(2, 3) * 5, use, { roofMat: "lip" });
        o.lots.push({ d: d.id, use, nb: opts.nb, row: opts.row, key: `${key}|hall`, poly: hall, base: bld.base, top: bld.top, storeys: 2, plinth: bld.plinth, area: polyArea(hall), label: "Pump hall" });
      }
    }
    // channel through the quay to the ring canal, walled both sides
    o.prism(ob, ch, wl - 3, wl, "water");
    for (const [a0, s2] of [[am - cda, -1], [am + cda, 1]]) {
      const da2 = s2 * 1.2 / ((r0 + r1) / 2), wq = [polar(r0, a0), polar(r1, a0), polar(r1, a0 + da2), polar(r0, a0 + da2)];
      const top = wq.map(([x, y]) => [x, y, Math.max(gAt(x, y), wl + 0.6) + 0.35]);
      o.solid(ob, top, top.map(() => wl - 3), "stone");
    }
    water.push(ch);
    o.basins.push(...water.map((p) => ({ use, poly: p })));
    for (const p of water) o.canalCuts.push({ poly: p, z0: wl - 4, z1: Math.max(...p.map(([x, y]) => gAt(x, y))) + 4 });
    return null;
    function ground(q) { const top = q.map(([x, y]) => [x, y, gAt(x, y) + 0.12]); o.solid(ob, top, top.map((t) => t[2] - 0.42), "paver"); }
  }

  // Fill one band of a ring with Voronoi cells, cell-edge canals and land uses.
  function genVoronoiBand(plan, d, ter, spokes, o, band, cfg) {
    const ring = plan.scene.rings.find((r) => r.id === d.ring), LU = plan.landuse || {};
    const { cells, canals, adj } = voronoiCells(plan, spokes, cfg.key, band, cfg.spacing, cfg.street, d.canals ? { ...d.canals, prev: cfg.canalEnds } : null);
    const rings = [...plan.scene.rings].sort((a, b) => a.r0 - b.r0), ri = rings.indexOf(ring);
    const L = ringLayout(plan, d), first = band.i === Math.min(...L.bands.map((b) => b.i)), last = band.i === Math.max(...L.bands.map((b) => b.i));
    const waterIn = ri > 0 && rings[ri - 1].kind === "water" && first ? rings[ri - 1] : null;
    const waterOut = ri < rings.length - 1 && rings[ri + 1].kind === "water" && last ? rings[ri + 1] : null;
    const H = d.harbours || {}, summaries = [];
    for (const cn of canals) o.canals.push({ d: d.id, band: band.i, k: cn.k, c: cn.c, path: cn.path, width: d.canals.width });
    for (const cell of cells) {
      if (cell.plaza) { o.squares.push(cell.poly); continue; }
      const [cx, cy] = centroid(cell.poly), r = Math.hypot(cx, cy);
      let dw = Math.min(r - ring.r0, ring.r1 - r);
      for (const cn of canals) if (cn.k === cell.k) dw = Math.min(dw, distToPath(cx, cy, cn.path));
      const wf = clamp(dw / (LU.waterfront_depth || 160), 0, 1);
      const UR = rng(`${cfg.key}|use|${band.i}|${cell.k}|${cell.j}`);
      const nb = o.nb ? o.nb.assign(cx, cy, ring.id) : null, nbType = nb ? o.nb.typeOf(nb.type) : null;
      if (nb) { nb.cells++; nb.sx += cx; nb.sy += cy; (nb.rings || (nb.rings = new Set())).add(ring.id); }
      let use = cfg.forceUse || pickUse(plan, d, cx, cy, wf, UR, nbType);
      // a small chance that a cell on a ring canal becomes part of the water
      const rs = cell.raw.map(([x, y]) => Math.hypot(x, y));
      const side = waterIn && Math.min(...rs) <= band.r0 + 3 ? -1 : waterOut && Math.max(...rs) >= band.r1 - 3 ? 1 : 0;
      const HR = rng(`${cfg.key}|harbour|${band.i}|${cell.k}|${cell.j}`);
      if (side && H.chance > 0 && HR.random() < H.chance) {
        const wl0 = ter.water[(side < 0 ? waterIn : waterOut).id], gMin = Math.min(...cell.poly.map(([x, y]) => ter.G(clamp(Math.hypot(x, y), band.r0 + 0.1, band.r1 - 0.1))));
        if (wl0 <= gMin - 1 && wl0 >= gMin - (H.max_depth ?? 9) && !inHeroWedge(plan, spokes, cx, cy, 10)) use = HR.random() < (H.waterworks_share ?? 0.4) ? "waterworks" : "harbour";
      }
      const key = `${cfg.key}|v${band.i}|${cell.k}|${cell.j}`;
      const ob = o.obj(`NBHD_${d.id}_${use.slice(0, 4)}_v${band.i}_s${cell.k}_${String(cell.j).padStart(4, "0")}`, d.id,
        nb ? { use, nb: nb.id, nb_name: nb.name, nb_type: nb.type } : { use });
      o.cells.push({ d: d.id, use, poly: cell.poly, nb: nb ? nb.id : null, sky: nbType ? (nbType.skywalk ?? 1) : 1 });
      const wr = side < 0 ? waterIn : waterOut;
      summaries[cells.indexOf(cell)] = buildUse(plan, d, ter, o, ob, use, cell, key, {
        wing: cfg.wing, row: `v${band.i}`, band, waterSide: side, gap: cfg.street / 2,
        ringEdge: side < 0 ? ring.r0 : ring.r1, waterLevel: wr ? ter.water[wr.id] : 0, nbHeight: nbType ? (nbType.height ?? 1) : 1, nbStyle: nbType ? nbType.style : null, nb: nb ? nb.id : null });
      summaries[cells.indexOf(cell)] && (summaries[cells.indexOf(cell)].sky = nbType ? (nbType.skywalk ?? 1) : 1);
    }
    for (const e of adj) {
      const A = summaries[e.a], B = summaries[e.b];
      if (A && B && !cells[e.a].plaza && !cells[e.b].plaza) o.cellEdges.push({ d: d.id, band, p: e.p, q: e.q, wet: e.wet, uses: [A.use, B.use], sky: [A.sky ?? 1, B.sky ?? 1], top: Math.min(A.top, B.top), base: Math.max(A.base, B.base) });
    }
  }

  // Skywalks a couple of storeys up, bridging the street (or a cell-edge canal) between neighbouring
  // cells. Commercial and entertainment pairs get them most; homes now and then; never industry or parks.
  function buildSkywalks(plan, d, ter, o, cells, adj, summaries, cfg, band) {
    const SW = plan.skywalks;
    if (!SW || SW.enabled === false) return;
    const ob = o.obj(`SKYWALKS_${d.id}_v${band.i}`, "skywalks", { use: "skywalk" });
    const tier = { commercial: "c", entertainment: "e", residential: "r" };
    for (const e of adj) {
      const A = summaries[e.a], B = summaries[e.b];
      if (!A || !B || !tier[A.use] || !tier[B.use] || cells[e.a].plaza || cells[e.b].plaza) continue;
      const pair = [tier[A.use], tier[B.use]].sort().join("");
      const chance = (SW.chance || {})[pair] || 0, R = rng(`${cfg.key}|sky|${band.i}|${e.a}|${e.b}`);
      if (!(R.random() < chance)) continue;
      const level = R.randint(...(SW.levels || [2, 3])), z = Math.max(A.base, B.base) + level * plan.storey;
      if (Math.min(A.top, B.top) < z + plan.storey * 1.2) continue;  // both buildings must rise past the deck
      const mx = (e.p[0] + e.q[0]) / 2, my = (e.p[1] + e.q[1]) / 2, L = dist(e.p, e.q);
      const ex = (e.q[0] - e.p[0]) / L, ey = (e.q[1] - e.p[1]) / L, nx = -ey, ny = ex;
      const reach = (e.wet && d.canals ? d.canals.width / 2 + (d.canals.quay || 0) : cfg.street * 0.7) + 2.5, hw = (SW.width || 4) / 2;
      const a = [mx - nx * reach, my - ny * reach], b = [mx + nx * reach, my + ny * reach];
      const deck = [[a[0] - ex * hw, a[1] - ey * hw], [b[0] - ex * hw, b[1] - ey * hw], [b[0] + ex * hw, b[1] + ey * hw], [a[0] + ex * hw, a[1] + ey * hw]];
      o.prism(ob, deck, z - 0.5, z, "paver");
      for (const s of [-1, 1]) {
        const o1 = s * hw, o2 = s * (hw - 0.15);
        o.prism(ob, [[a[0] + ex * o2, a[1] + ey * o2], [b[0] + ex * o2, b[1] + ey * o2], [b[0] + ex * o1, b[1] + ey * o1], [a[0] + ex * o1, a[1] + ey * o1]], z, z + 1.1, "lip");
      }
      o.skywalks.push({ d: d.id, a, b, z, uses: [A.use, B.use] });
    }
  }

  // Join each canal's band paths across the ring avenues and run it on into the ring water at both ends,
  // then build it: water a couple of metres below the ground, quay walls either side, and no walls where
  // a ring avenue bridges over it.
  function buildCanals(plan, d, ter, o, L) {
    if (!d.canals || !(d.canals.per_sector > 0)) return;
    const ring = L.ring, W = d.canals.width, depth = d.canals.depth ?? 2.2, mine = o.canals.filter((c) => c.d === d.id);
    const rings = [...plan.scene.rings].sort((x, y) => x.r0 - y.r0), ri = rings.indexOf(ring);
    const wIn = ri > 0 && rings[ri - 1].kind === "water" ? ter.water[rings[ri - 1].id] : null;
    const wOut = ri < rings.length - 1 && rings[ri + 1].kind === "water" ? ter.water[rings[ri + 1].id] : null;
    const groups = new Map();
    for (const c of mine) { const g = `${c.k}|${c.c}`; (groups.get(g) || groups.set(g, []).get(g)).push(c); }
    const ob = o.obj(`CANALS_${d.id}`, d.id, { use: "canal" });
    for (const parts of groups.values()) {
      parts.sort((x, y) => x.band - y.band);
      const line = [];
      parts.forEach((p) => line.push(...p.path));
      if (line.length < 2) continue;
      // run straight out to the ring's own water at both ends (stopping at the ring edge)
      const at = (p, r) => polar(r, Math.atan2(p[1], p[0]));
      line.unshift(at(line[0], ring.r0 + 0.05));
      line.push(at(line[line.length - 1], ring.r1 - 0.05));
      o.canalLines.push({ d: d.id, line, width: W });
      // a dense centreline with mitred normals: points along a segment take its normal, corners the
      // bisector scaled so offset edges meet (clamped on sharp turns), so walls and quays join at bends.
      // Segments are also split where they cross an avenue's edges, so walls stop exactly at the avenue.
      const segN = (p, q) => { const Lq = dist(p, q) || 1; return [-(q[1] - p[1]) / Lq, (q[0] - p[0]) / Lq]; };
      const edgesR = L.avenues.flatMap((av) => [av.r - av.w / 2, av.r + av.w / 2]);
      const crossT = (p, q, R0) => {  // where |p + t(q-p)| = R0, for t in (0,1)
        const dx = q[0] - p[0], dy = q[1] - p[1], A2 = dx * dx + dy * dy, B2 = 2 * (p[0] * dx + p[1] * dy), C2 = p[0] * p[0] + p[1] * p[1] - R0 * R0, D2 = B2 * B2 - 4 * A2 * C2;
        if (D2 < 0 || A2 < 1e-9) return [];
        return [(-B2 - Math.sqrt(D2)) / (2 * A2), (-B2 + Math.sqrt(D2)) / (2 * A2)].filter((t) => t > 1e-4 && t < 1 - 1e-4);
      };
      const dense = [];
      for (let i = 0; i < line.length - 1; i++) {
        const a2 = line[i], b2 = line[i + 1], n = Math.max(1, Math.ceil(dist(a2, b2) / 15)), sn = segN(a2, b2);
        const ts = new Set(Array.from({ length: n }, (_, k) => k / n));
        for (const R0 of edgesR) for (const t of crossT(a2, b2, R0)) ts.add(t);
        [...ts].sort((x, y) => x - y).forEach((t, k) => dense.push({ p: [lerp(a2[0], b2[0], t), lerp(a2[1], b2[1], t)], n: sn, corner: k === 0 ? i : -1 }));
      }
      dense.push({ p: line[line.length - 1], n: segN(line[line.length - 2], line[line.length - 1]), corner: -1 });
      for (const dp of dense) if (dp.corner > 0) {
        const n0 = segN(line[dp.corner - 1], line[dp.corner]), n1 = segN(line[dp.corner], line[dp.corner + 1]);
        let bx = n0[0] + n1[0], by = n0[1] + n1[1]; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
        const c = Math.max(0.45, bx * n1[0] + by * n1[1]);
        dp.n = [bx / c, by / c];
      }
      {
        const reachOf = (dp) => { const nl = Math.hypot(...dp.n), c = 1 / nl; return (W / 2 + (d.canals.quay || 0)) * Math.sqrt(Math.max(0, 1 - c * c)) / Math.max(c, 1e-3) + 1; };
        const corners = dense.filter((dp) => dp.corner > 0);
        for (let i = dense.length - 2; i > 0; i--) if (dense[i].corner < 0 || dense[i].corner === 0) {
          if (corners.some((cn) => cn !== dense[i] && dist(cn.p, dense[i].p) < reachOf(cn))) dense.splice(i, 1);
        }
      }
      const off = (dp, dd) => [dp.p[0] + dp.n[0] * dd, dp.p[1] + dp.n[1] * dd];
      // a quad whose sides cross (it folded on the inside of a bend)
      const segX = (a, b, c, e) => { const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), d2 = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]), d3 = (e[0] - c[0]) * (a[1] - c[1]) - (e[1] - c[1]) * (a[0] - c[0]), d4 = (e[0] - c[0]) * (b[1] - c[1]) - (e[1] - c[1]) * (b[0] - c[0]); return d1 * d2 < 0 && d3 * d4 < 0; };
      const folded = (q) => segX(q[0], q[1], q[2], q[3]) || segX(q[1], q[2], q[3], q[0]);
      // walls and quays stop on the avenue's edge: clip by the tangent of each avenue edge the piece reaches
      const clipAv = (q) => {
        for (const av of L.avenues) {
          if (q.length < 3) break;
          const rs = q.map((v) => Math.hypot(...v)), mid = centroid(q), rm = Math.hypot(...mid), ux = mid[0] / rm, uy = mid[1] / rm;
          if (!rs.some((r) => Math.abs(r - av.r) < av.w / 2)) continue;
          q = rm > av.r ? clipHalf(q, -ux, -uy, -(av.r + av.w / 2)) : clipHalf(q, ux, uy, av.r - av.w / 2);
        }
        return q;
      };
      const Q = d.canals.quay || 0, nP = dense.length - 1, gAt = (x, y) => ter.G(clamp(Math.hypot(x, y), ring.r0 + 0.1, ring.r1 - 0.1));
      const inAvenue = (rm) => L.avenues.some((av) => Math.abs(rm - av.r) < av.w / 2);
      // pounds: the water holds level while the ground slopes, and steps down at a lock when the quay
      // would come too close to it (or the cutting gets too deep). Near a ring canal the pounds step down
      // as a flight of locks, so the canal meets the ring water at its level instead of in one big dam.
      const C = d.canals, stepMax = C.lock_step ?? 1.2, lockGap = C.lock_spacing ?? 25;
      const piece = [], sAt = [0];
      for (let j = 0; j < nP; j++) {
        const A = dense[j], B2 = dense[j + 1], mid = [(A.p[0] + B2.p[0]) / 2, (A.p[1] + B2.p[1]) / 2], rm = Math.hypot(...mid);
        piece.push({ A, B2, Lj: dist(A.p, B2.p), rm, gz: gAt(...mid), av: inAvenue(rm) });
        sAt.push(sAt[j] + dist(A.p, B2.p));
      }
      // natural pounds start at the inner ring water (or the ground) and step at most stepMax at a time,
      // locks at least lockGap apart and never under (or within 4 m of) an avenue
      const total = sAt[nP], zw = new Array(nP);
      const nearAv = (j) => { const ra = Math.hypot(...piece[j].A.p), rb = Math.hypot(...piece[j].B2.p), lo = Math.min(ra, rb), hi = Math.max(ra, rb);
        return L.avenues.some((av) => hi > av.r - av.w / 2 - 4 && lo < av.r + av.w / 2 + 4); };
      let cur = wIn ?? (piece.length ? piece[0].gz - depth : 0), lastS = -Infinity;
      for (let j = 0; j < nP; j++) {
        const f = piece[j].gz - cur, can = !nearAv(j) && sAt[j] - lastS >= lockGap;
        if (f < depth - 0.01 && (can || f < 0.6)) { cur -= stepMax; lastS = sAt[j]; }
        else if (f > depth + stepMax + 0.6 && can) { cur = Math.min(cur + stepMax, piece[j].gz - depth); lastS = sAt[j]; }
        zw[j] = cur;
      }
      // the flight down to the outer ring water: locks every lockGap back from the mouth, stepMax each
      // (counted in whole pieces from the mouth, so the locks keep an even spacing of at least lockGap)
      if (wOut != null) {
        let k = 0, acc = 0;
        for (let j = nP - 1; j >= 0; j--) {
          zw[j] = Math.min(zw[j], wOut + stepMax * k);
          acc += piece[j].Lj;
          if (acc >= lockGap - 1e-6 && !nearAv(j) && !(j > 0 && nearAv(j - 1))) { k++; acc = 0; }
        }
      }
      // a step that lands near an avenue moves out of it: the run takes the lower neighbouring level
      for (let j = 0; j < nP; j++) if (nearAv(j)) {
        let e = j; while (e + 1 < nP && nearAv(e + 1)) e++;
        if (j > 0 && e < nP - 1) { const lo = Math.min(zw[j - 1], zw[e + 1]); for (let k = j; k <= e; k++) zw[k] = Math.min(zw[k], lo); }
        j = e;
      }
      // steps too small to be worth a lock are levelled out
      for (let j = 1; j < nP; j++) { const dz = zw[j - 1] - zw[j]; if (Math.abs(dz) > 1e-6 && Math.abs(dz) < 0.3 && !(j === nP - 1 && wOut != null)) zw[j] = zw[j - 1]; }
      if (wIn != null) zw[0] = wIn;
      if (wOut != null) zw[nP - 1] = wOut;
      const locks = [];  // dense index where the water steps
      for (let j = 1; j < nP; j++) if (Math.abs(zw[j] - zw[j - 1]) > 0.05) locks.push({ j, s: sAt[j], p: piece[j].A.p });
      const nearLock = (x, y, m) => locks.some((lk) => Math.hypot(lk.p[0] - x, lk.p[1] - y) < m);
      // bridges at the middle of straight stretches, square to the canal, away from locks, avenues and each other
      const BR = C.bridge_chance || 0, bridgesHere = [], bw = 3.5, half = W / 2 + 2.5;
      for (let i = 0; i < line.length - 1; i++) {
        const a2 = line[i], b2 = line[i + 1], Ls = dist(a2, b2);
        if (Ls < 2 * bw + 16) continue;
        const nd = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], rn = Math.hypot(...nd);
        if (!(rng(`${d.id}|bridge|${Math.round(nd[0])}|${Math.round(nd[1])}`).random() < BR)) continue;
        if (rn < ring.r0 + 30 || rn > ring.r1 - 30 || L.avenues.some((av) => Math.abs(rn - av.r) < av.w / 2 + bw + 6)) continue;
        if (inCorridor(plan, o.spokeListRef, nd[0], nd[1], W) || nearLock(nd[0], nd[1], bw + 6)) continue;
        if ([...bridgesHere, ...o.canalBridges.map((q2) => centroid(q2))].some((q2) => dist(q2, nd) < 45)) continue;
        const tx = (b2[0] - a2[0]) / Ls, ty = (b2[1] - a2[1]) / Ls, px = -ty, py = tx, gz = gAt(...nd);
        const pt = (s2, w) => [nd[0] + px * s2 + tx * w, nd[1] + py * s2 + ty * w];
        for (const [s0, s1] of [[-half, 0], [0, half]]) {
          const z0 = s0 === 0 ? gz + 1.5 : gz + 0.1, z1 = s1 === 0 ? gz + 1.5 : gz + 0.1;
          const top = [[...pt(s0, -bw), z0], [...pt(s1, -bw), z1], [...pt(s1, bw), z1], [...pt(s0, bw), z0]];
          o.solid(ob, top, top.map((q2) => q2[2] - 0.7), "stone");
          for (const w of [-bw, bw - 0.25]) {  // parapets
            const pq = [[...pt(s0, w), z0 + 1], [...pt(s1, w), z1 + 1], [...pt(s1, w + 0.25), z1 + 1], [...pt(s0, w + 0.25), z0 + 1]];
            o.solid(ob, pq, [z0, z1, z1, z0], "lip");
          }
        }
        o.canalBridges.push([pt(-half, -bw), pt(half, -bw), pt(half, bw), pt(-half, bw)]);
        bridgesHere.push(nd);
      }
      const solidQ = (q, topOff, botZ, mat) => { const top = q.map(([x, y]) => [x, y, gAt(x, y) + topOff]); o.solid(ob, top, top.map(() => botZ), mat); };
      const narrow = W < 16;
      for (let j = 0; j < nP; j++) {
        const { A, B2, Lj, rm, av } = piece[j], z = zw[j];
        if (Lj < 0.2) continue;
        const water = [off(A, -W / 2), off(B2, -W / 2), off(B2, W / 2), off(A, W / 2)];
        if (!folded(water)) o.prism(ob, water, z - 0.6, z, "water");
        // a lock: gate walls across the canal with a walkway over the top, wherever the water steps
        if (j > 0 && Math.abs(zw[j - 1] - z) > 0.05) {
          const tx = (B2.p[0] - A.p[0]) / Lj, ty = (B2.p[1] - A.p[1]) / Lj, e1 = off(A, -W / 2), e2 = off(A, W / 2), hi = Math.max(zw[j - 1], z);
          o.prism(ob, [e1, e2, [e2[0] + tx * 1.2, e2[1] + ty * 1.2], [e1[0] + tx * 1.2, e1[1] + ty * 1.2]], Math.min(zw[j - 1], z) - 1, hi + 0.5, "stone");
          o.prism(ob, [[e1[0] - tx * 0.6, e1[1] - ty * 0.6], [e2[0] - tx * 0.6, e2[1] - ty * 0.6], [e2[0] + tx * 1.8, e2[1] + ty * 1.8], [e1[0] + tx * 1.8, e1[1] + ty * 1.8]], hi + 0.5, hi + 0.7, "lip");
        }
        if (av) continue;  // under a ring avenue: its deck bridges the water
        const PR = rng(`${d.id}|gracht|${Math.round(A.p[0])}|${Math.round(A.p[1])}`);
        const mouth = (j === 0 && wIn != null) || (j === nP - 1 && wOut != null);
        let moored = false;
        for (const sd of [-1, 1]) {
          // canal wall, its coping following the sloping ground, down past the water
          const wq = [off(A, sd * (W / 2 - 1.2)), off(B2, sd * (W / 2 - 1.2)), off(B2, sd * W / 2), off(A, sd * W / 2)];
          if (!folded(wq)) { const c2 = clipAv(wq); if (c2.length >= 3) solidQ(c2, 0.35, z - 1, "stone"); }
          if (!(Q > 0) || mouth) continue;
          // the quay street: cobbles from the canal wall to the canal houses (skipped where a sharp bend folds it)
          const qq = [off(A, sd * W / 2), off(B2, sd * W / 2), off(B2, sd * (W / 2 + Q)), off(A, sd * (W / 2 + Q))];
          const qOk = !folded(qq) && ((qq[2][0] - qq[3][0]) * (B2.p[0] - A.p[0]) + (qq[2][1] - qq[3][1]) * (B2.p[1] - A.p[1])) > 0;
          if (qOk) { const c2 = clipAv(qq); if (c2.length >= 3) solidQ(c2, 0.06, Math.min(...c2.map(([x, y]) => gAt(x, y))) - 0.3, "paver"); }
          // a houseboat moored along the wall now and then: not under bridges or avenues, clear of locks,
          // only one side on a narrow canal
          if (Lj > 10 && !(narrow && moored) && PR.random() < (C.houseboat_chance || 0)) {
            const mx = (A.p[0] + B2.p[0]) / 2, my = (A.p[1] + B2.p[1]) / 2;
            if (bridgesHere.some((nd) => Math.hypot(nd[0] - mx, nd[1] - my) < half + 12) || nearLock(mx, my, Lj / 2 + 4)) continue;
            if (L.avenues.some((av2) => Math.abs(rm - av2.r) < av2.w / 2 + 14) || (j > 0 && Math.abs(zw[j - 1] - z) > 0.05) || (j < nP - 1 && Math.abs(zw[j + 1] - z) > 0.05)) continue;
            const beam = Math.min(4.2, W * 0.25), bl = Math.min(Lj * 0.85, 20), f0 = (1 - bl / Lj) / 2, f1 = f0 + bl / Lj, inn = W / 2 - 1.4, out = inn - beam;
            const P = (f, o2) => { const q = { p: [lerp(A.p[0], B2.p[0], f), lerp(A.p[1], B2.p[1], f)], n: A.n.map((v, k) => lerp(v, B2.n[k], f)) }; return off(q, sd * o2); };
            const hull = [P(f0, out), P(f1, out), P(f1, inn), P(f0, inn)];
            o.prism(ob, hull, z - 0.4, z + 1.0, "lip");
            o.prism(ob, [P(f0 + 0.1 * bl / Lj, out + 0.6), P(f1 - 0.1 * bl / Lj, out + 0.6), P(f1 - 0.1 * bl / Lj, inn - 0.6), P(f0 + 0.1 * bl / Lj, inn - 0.6)], z + 1.0, z + 3.0, "stone");
            o.boats.push(hull);
            moored = true;
          }
        }
      }
      // the mouths run on through the ring canal's bank into its water: water at the ring level, walled both sides
      for (const [end, nxt, wl] of [[line[0], line[1], wIn], [line[line.length - 1], line[line.length - 2], wOut]]) {
        if (wl == null) continue;
        const Le = dist(end, nxt) || 1, ux = (end[0] - nxt[0]) / Le, uy = (end[1] - nxt[1]) / Le, px = -uy, py = ux, ext = 10;
        const P = (s2, w) => [end[0] + ux * s2 + px * w, end[1] + uy * s2 + py * w], bank = ter.G(clamp(Math.hypot(...end), ring.r0 + 0.5, ring.r1 - 0.5)) + 0.35;
        o.prism(ob, [P(-0.5, -W / 2), P(ext, -W / 2), P(ext, W / 2), P(-0.5, W / 2)], wl - 0.6, wl, "water");
        for (const sd of [-1, 1]) o.prism(ob, [P(-0.5, sd * (W / 2 - 1.2)), P(ext, sd * (W / 2 - 1.2)), P(ext, sd * (W / 2)), P(-0.5, sd * (W / 2))], wl - 1, Math.max(bank, wl + 0.6), "stone");
      }
      o.canalLines[o.canalLines.length - 1].quay = Q;
      // footprints Blender cuts out of the hand-built ground decks and ring-canal walls: one per piece, down
      // to just under that piece's wall foot; at a ring-water end the cut runs on through the bank
      for (let j = 0; j < nP; j++) {
        const { A, B2 } = piece[j], q = [off(A, -W / 2), off(B2, -W / 2), off(B2, W / 2), off(A, W / 2)];
        if (piece[j].Lj < 0.2 || folded(q)) continue;
        o.canalCuts.push({ poly: q, z0: zw[j] - 1.2, z1: Math.max(...q.map(([x, y]) => gAt(x, y))) + 4 });
      }
      for (const [end, nxt, wl] of [[line[0], line[1], wIn], [line[line.length - 1], line[line.length - 2], wOut]]) {
        if (wl == null) continue;
        const Le = dist(end, nxt) || 1, ux = (end[0] - nxt[0]) / Le, uy = (end[1] - nxt[1]) / Le, px = -uy, py = ux, hw = W / 2;
        const P = (s2, w) => [end[0] + ux * s2 + px * w, end[1] + uy * s2 + py * w];
        o.canalCuts.push({ poly: [P(-0.5, -hw), P(10, -hw), P(10, hw), P(-0.5, hw)], z0: wl - 1.2, z1: ter.G(clamp(Math.hypot(...end), ring.r0 + 0.5, ring.r1 - 0.5)) + 4 });
      }
      o.canalLines[o.canalLines.length - 1].levels = { min: Math.min(...zw), max: Math.max(...zw), locks: locks.length, steps: locks.map((lk) => ({ s: lk.s, dz: zw[lk.j - 1] - zw[lk.j], r: Math.hypot(...lk.p) })), freeboard: Math.min(...piece.map((pc, j) => (j === 0 || j === nP - 1 ? Infinity : pc.gz - zw[j]))) };
      // elms along both quays, measured along the mitred quay line, kept out of every canal's water
      const ts = d.canals.tree_spacing || 0;
      if (ts >= 3 && Q > 0) for (const sd of [-1, 1]) {
        let acc = ts / 2;
        for (let j = 1; j < nP - 1; j++) {
          const A = dense[j], B2 = dense[j + 1], pa = off(A, sd * (W / 2 + 2.5)), pb = off(B2, sd * (W / 2 + 2.5)), Lq = dist(pa, pb);
          for (; acc < Lq; acc += ts) {
            const f = acc / Lq, tx = lerp(pa[0], pb[0], f), ty = lerp(pa[1], pb[1], f), rm = Math.hypot(tx, ty);
            if (inAvenue(rm) || inCorridor(plan, o.spokeListRef, tx, ty, 2)) continue;
            if (o.canalLines.some((cl) => distToPath(tx, ty, cl.line) < cl.width / 2 + 1)) continue;
            if (bridgesHere.some((nd) => Math.hypot(nd[0] - tx, nd[1] - ty) < half + 4) || nearLock(tx, ty, W / 2 + 4)) continue;
            const TR = rng(`${d.id}|elm|${Math.round(tx)}|${Math.round(ty)}`);
            tree(o, ter, d.id, TR.choice(["asset_Plant_civic", "asset_Plant_column", "asset_Plant_open"]), tx, ty, TR, `CANAL_${d.id}_elm_${o.trees.length}`, 0.9, 1.2, gAt(tx, ty) + 0.06);
          }
          acc -= Lq;
        }
      }
    }
  }


  // ---------------------------------------------------------------- plots
  // A Voronoi cell is a plot, not a building. Buildings inside it are rectangles squared to the
  // street edge they face; odd corners are left as yards. Each street edge gets a run of buildings
  // `depth` deep (narrow canal houses on a canal edge), longest edges first; a building that would
  // overlap one already placed is shortened from that end or dropped. A plot too shallow for a
  // courtyard becomes one deep building along its longest edge.
  // style: { lot: [min, max] frontage, depth, gap: [min, max] between buildings, setback }
  function plotChord(p, ux, uy, nx, ny, c) {  // u-extent of a convex polygon along the line n·x = c
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
      if (da === 0) { const u = ux * a[0] + uy * a[1]; lo = Math.min(lo, u); hi = Math.max(hi, u); }
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db), u = ux * (a[0] + (b[0] - a[0]) * t) + uy * (a[1] + (b[1] - a[1]) * t); lo = Math.min(lo, u); hi = Math.max(hi, u); }
    }
    return hi > lo ? [lo, hi] : null;
  }
  // separating-axis test for two convex quads (touching doesn't count)
  function quadsOverlap(A, B, tol = 0.25) {
    for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = dist(a, b) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      const pa = A.map((q) => q[0] * nx + q[1] * ny), pb = B.map((q) => q[0] * nx + q[1] * ny);
      if (Math.max(...pa) <= Math.min(...pb) + tol || Math.max(...pb) <= Math.min(...pa) + tol) return false;
    }
    return true;
  }
  // the biggest rectangle squared to one of the polygon's edges (for halls, venues, small plots)
  function solidRect(poly) {
    const p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly);
    let best = null;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b);
      if (L < 4) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux, c0 = nx * a[0] + ny * a[1];
      const maxT = Math.max(...p.map((v) => nx * v[0] + ny * v[1] - c0));
      for (let k = 1; k <= 12; k++) {
        const t = maxT * k / 12, c1 = plotChord(p, ux, uy, nx, ny, c0 + 0.05), c2 = plotChord(p, ux, uy, nx, ny, c0 + t - 0.05);
        if (!c1 || !c2) continue;
        const lo = Math.max(c1[0], c2[0]), hi = Math.min(c1[1], c2[1]);
        if (hi - lo < 3) continue;
        const area = (hi - lo) * t;
        if (!best || area > best.area) best = { area, q: [[lo * ux + c0 * nx, lo * uy + c0 * ny], [hi * ux + c0 * nx, hi * uy + c0 * ny], [hi * ux + (c0 + t) * nx, hi * uy + (c0 + t) * ny], [lo * ux + (c0 + t) * nx, lo * uy + (c0 + t) * ny]] };
      }
    }
    return best ? best.q : null;
  }
  function plotBuildings(plan, poly, style, R, canalFront) {
    const p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly), CH = plan.canal_houses || {};
    if (p.length < 3) return [];
    const lotW = style.lot || plan.skyline.lot, gap = style.gap || [0, 0], setback = style.setback || 0, want = style.depth || 13;
    const edges = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b);
      if (L < 6) continue;
      const front = !!(canalFront && CH.enabled !== false && canalFront(a, b));
      edges.push({ a, b, L, front });
    }
    edges.sort((e1, e2) => (e2.front - e1.front) || (e2.L - e1.L));
    const placed = [];
    let solid = false;
    for (const e of edges) {
      if (solid && !e.front) break;
      const ux = (e.b[0] - e.a[0]) / e.L, uy = (e.b[1] - e.a[1]) / e.L, nx = -uy, ny = ux, c0 = nx * e.a[0] + ny * e.a[1] + (e.front ? 0 : setback);
      const maxT = Math.max(...p.map((v) => nx * v[0] + ny * v[1])) - c0;
      if (maxT < 5) continue;
      let depth = e.front ? Math.min(CH.depth || 13, maxT) : Math.min(want, maxT);
      if (!e.front && !placed.length && maxT < 2 * want + 8) { depth = maxT; solid = true; }  // no room for a courtyard
      const c1 = plotChord(p, ux, uy, nx, ny, c0 + 0.05), c2 = plotChord(p, ux, uy, nx, ny, c0 + depth - 0.05);
      if (!c1 || !c2) continue;
      const lo = Math.max(c1[0], c2[0], Math.min(ux * e.a[0] + uy * e.a[1], ux * e.b[0] + uy * e.b[1])), hi = Math.min(c1[1], c2[1], Math.max(ux * e.a[0] + uy * e.a[1], ux * e.b[0] + uy * e.b[1]));
      const widths = e.front ? (CH.lot || [6, 9.5]) : lotW;
      if (hi - lo < widths[0] * 0.6) continue;
      const P = (u, t) => [u * ux + (c0 + t) * nx, u * uy + (c0 + t) * ny];
      const rect = (s0, s1) => [P(s0, 0), P(s1, 0), P(s1, depth), P(s0, depth)];
      let s = lo;
      while (s < hi - 1) {
        let w = R.uniform(widths[0], widths[1]);
        if (hi - (s + w) < widths[0] * 0.6) w = hi - s;
        let s0 = s, s1 = s + w;
        // shorten from whichever end runs into a building already placed
        for (let guard = 0; guard < 60 && s1 - s0 >= widths[0] * 0.6; guard++) {
          const hit = placed.find((q) => quadsOverlap(rect(s0, s1), q));
          if (!hit) break;
          const hu = centroid(hit)[0] * ux + centroid(hit)[1] * uy;
          if (hu > (s0 + s1) / 2) s1 -= 1; else s0 += 1;
        }
        if (s1 - s0 >= widths[0] * 0.6 && !placed.some((q) => quadsOverlap(rect(s0, s1), q))) {
          const q = rect(s0, s1);
          if (e.front) q.canal = true;
          placed.push(q);
        }
        s += w + (e.front ? 0 : R.uniform(gap[0], gap[1]));
      }
    }
    if (!placed.length) { const q = solidRect(p); if (q) placed.push(q); }
    return placed;
  }

  // Lots for a Voronoi block: perimeter lots round a courtyard when there is room, otherwise strips
  // across the block's long axis. (The older layout, used when plan.plots.layout is "cell".)
  function cellLots(plan, poly, wing, R, canalFront) {
    const K = plan.skyline, p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly), CH = plan.canal_houses || {};
    const inner = offsetConvex(p, wing), area = Math.abs(signedArea(p));
    const lots = [];
    if (inner && Math.abs(signedArea(inner)) > area * 0.12) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], qa = inner[i], qb = inner[(i + 1) % inner.length], L = dist(a, b);
        if (L < 3) continue;
        // canal frontage gets narrow canal-house lots
        const front = canalFront && CH.enabled !== false && canalFront(a, b), lw = front ? (CH.lot || [6, 9.5]) : K.lot;
        const cuts = [0]; let x = 0;
        while (L - x > lw[1]) { x += R.uniform(lw[0], lw[1]); if (L - x < lw[0]) break; cuts.push(x / L); }
        cuts.push(1);
        const at = (P, Q, u) => [P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u];
        for (let c = 0; c < cuts.length - 1; c++) {
          const lot = [at(a, b, cuts[c]), at(a, b, cuts[c + 1]), at(qa, qb, cuts[c + 1]), at(qa, qb, cuts[c])];
          if (front) lot.canal = true;
          lots.push(lot);
        }
      }
      return lots;
    }
    // solid block: a row of canal houses along any canal edge first, then strips across the rest
    let rest = p;
    if (canalFront && CH.enabled !== false) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b);
        if (L < 8 || !canalFront(a, b)) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux;  // inward for a CCW polygon
        const depth = Math.min(CH.depth || 13, Math.sqrt(Math.abs(signedArea(p))) * 0.45), lw = CH.lot || [6, 9.5];
        const c0 = nx * a[0] + ny * a[1];
        let x = 0;
        while (x < L - 1) {
          let w = R.uniform(lw[0], lw[1]);
          if (L - x - w < lw[0]) w = L - x;
          // a slice of the block between two perpendiculars to the canal edge, the house's depth deep
          let q = clipHalf(clipHalf(p, -ux, -uy, -(ux * a[0] + uy * a[1] + x)), ux, uy, ux * a[0] + uy * a[1] + x + w);
          q = clipHalf(q, nx, ny, c0 + depth);
          if (q.length === 4 && Math.abs(signedArea(q)) > 20) {
            // order the corners canal side first so the gable faces the water
            const byN = [...q].sort((m1, m2) => (nx * m1[0] + ny * m1[1]) - (nx * m2[0] + ny * m2[1]));
            const fr = byN.slice(0, 2).sort((m1, m2) => (ux * m1[0] + uy * m1[1]) - (ux * m2[0] + uy * m2[1]));
            const bk = byN.slice(2).sort((m1, m2) => (ux * m2[0] + uy * m2[1]) - (ux * m1[0] + uy * m1[1]));
            const house = [fr[0], fr[1], bk[0], bk[1]];
            house.canal = true;
            lots.push(house);
          } else if (q.length >= 3 && Math.abs(signedArea(q)) > 20) lots.push(q);
          x += w;
        }
        rest = clipHalf(rest, -nx, -ny, -(c0 + depth));
      }
      if (rest.length < 3 || Math.abs(signedArea(rest)) < 60) return lots;
    }
    let best = 0, ex = 1, ey = 0;
    for (let i = 0; i < rest.length; i++) { const a = rest[i], b = rest[(i + 1) % rest.length], L = dist(a, b); if (L > best) { best = L; ex = (b[0] - a[0]) / L; ey = (b[1] - a[1]) / L; } }
    const proj = rest.map(([x, y]) => x * ex + y * ey), lo = Math.min(...proj), hi = Math.max(...proj);
    let s = lo;
    while (s < hi - 1e-6) {
      let e = s + R.uniform(K.lot[0], K.lot[1]);
      if (hi - e < K.lot[0]) e = hi;
      const strip = clipHalf(clipHalf(rest, -ex, -ey, -s), ex, ey, e);
      if (strip.length >= 3 && Math.abs(signedArea(strip)) > 20) lots.push(strip);
      s = e;
    }
    return lots;
  }

  // ---------------------------------------------------------------- districts
  function genPerimeter(plan, d, ter, spokes, o) {
    const L = ringLayout(plan, d);
    if (d.layout === "voronoi") {
      const street = plan.side_street;
      const canalEnds = new Map();  // bands run inside-out, each canal picks up where it left the last band
      for (const band of L.bands) genVoronoiBand(plan, d, ter, spokes, o, band, { key: d.id, spacing: [d.row_depth + street, d.block + street], street, wing: d.wing, canalEnds });
      buildCanals(plan, d, ter, o, L);
      return;
    }
    L.bands.forEach((band) => bandRows(plan, d, band).forEach((row, k) => {
      const ri = `${band.i}${k}`;
      for (const b of rowBlocks(plan, spokes, `${d.id}|${ri}`, row, plan.side_street)) {
        const R = rng(`${d.id}|${ri}|${b.k}|${b.j}`), ob = o.obj(`NBHD_${d.id}_b${ri}_s${b.k}_${String(b.j).padStart(3, "0")}`, d.id);
        for (const [li, poly] of blockLots(plan, b.Q, d.wing, R).entries()) {
          const LR = rng(`${d.id}|${ri}|${b.k}|${b.j}|${li}`), cx = poly.reduce((t, p) => t + p[0], 0) / 4, cy = poly.reduce((t, p) => t + p[1], 0) / 4;
          const st = storeysAt(plan, cx, cy, LR, d.height_scale), h = st * plan.storey;
          const bld = building(o, ob, ter, poly, h, "lot");
          o.lots.push({ d: d.id, row: ri, key: `${d.id}|${ri}|${b.k}|${b.j}|${li}`, poly, base: bld.base, top: bld.top, storeys: st, plinth: bld.plinth, area: polyArea(poly) });
          o.band(`${d.id}|${ri}`, row.r0, row.r1, bld.base, bld.top);
        }
      }
    }));
  }

  function tree(o, ter, coll, asset, x, y, R, name, s0, s1, z) {
    const zz = z ?? ter.G(Math.hypot(x, y));
    o.trees.push([x, y]);
    o.instances.push({ coll, name, asset, x, y, z: zz, rot: R.uniform(0, TAU), scale: R.uniform(s0, s1) });
  }

  // concentric planting rows across a band, skipping the spoke corridors
  function plantBand(plan, d, ter, spokes, o, key, r0, r1, spacing, jitter, clearing, palette) {
    if (!(spacing >= 1)) return;
    let n = 0;
    for (let rr = r0; rr <= r1 + 1e-6; rr += spacing) {
      const m = Math.floor(TAU * rr / spacing);
      const phase = rng(`${key}|${Math.floor(rr + 0.5)}|phase`).random();  // stagger rows: no radial moire
      for (let j = 0; j < m; j++) {
        const a = SOUTH + (j + phase) * TAU / m, R = rng(`${key}|${Math.floor(rr + 0.5)}|${j}`);
        if (clearing && R.random() < clearing) continue;
        const [x, y] = polar(rr + R.uniform(-jitter, jitter), a + R.uniform(-jitter, jitter) / rr);
        if (inCorridor(plan, spokes, x, y, 2)) continue;
        if (onCanalLine(o, x, y, 1.5) || o.noPlant.some((q) => pointInPoly(x, y, q))) continue;
        tree(o, ter, d.id, R.choice(palette), x, y, R, `NBHD_${d.id}_${key}_${String(n++).padStart(5, "0")}`, 0.75, 1.3);
      }
    }
  }
  const PALETTE = {
    orchard: ["asset_Plant_fruit", "asset_Plant_fruit", "asset_Plant_open", "asset_Plant_sapling"],
    grove: ["asset_Plant_civic", "asset_Plant_column", "asset_Plant_open", "asset_Plant_shrub", "asset_Plant_fruit"],
  };

  // Park ring: colleges (courts, pavilions, halls) in the middle band, groves and orchards either side,
  // an irrigation rill down the middle of each planted band.
  function genCampus(plan, d, ter, spokes, o) {
    const K = plan.skyline, L = ringLayout(plan, d), kinds = d.band_kinds || ["grove", "campus", "orchard"];
    const rillOb = o.obj(`NBHD_${d.id}_rills`, d.id);
    if (d.layout === "voronoi") {
      // colleges first, so their cell-edge canals exist before the groves and orchards are planted round them
      L.bands.forEach((band, bi) => {
        if ((kinds[bi] || "campus") !== "campus") return;
        const c = d.campus;
        genVoronoiBand(plan, d, ter, spokes, o, band, { key: `${d.id}campus`, spacing: [c.row_depth + c.street, c.block + c.street], street: c.street, wing: c.wing, canalEnds: new Map() });
      });
      buildCanals(plan, d, ter, o, L);
    }
    L.bands.forEach((band, bi) => {
      const kind = kinds[bi] || "campus";
      if (kind === "campus" && d.layout === "voronoi") return;  // built in the first pass above
      if (kind === "campus") {
        bandRows(plan, { ...d, row_depth: d.campus.row_depth, block: d.campus.block, wobble: d.campus.wobble }, band).forEach((row, k) => {
          for (const b of rowBlocks(plan, spokes, `${d.id}|campus${bi}${k}`, row, d.campus.street)) {
            const R = rng(`${d.id}|${bi}${k}|${b.k}|${b.j}`), roll = R.random(), ob = o.obj(`NBHD_${d.id}_college_b${bi}${k}_s${b.k}_${String(b.j).padStart(3, "0")}`, d.id);
            const lowStoreys = () => clamp(Math.round(R.uniform(d.storeys[0], d.storeys[1]) * Math.exp(K.chaos * 0.6 * R.normal())), 1, d.storeys[1] + 3);
            let polys, label;
            if (roll < 0.45) { polys = blockLots(plan, b.Q, d.campus.wing, R); label = "College court"; }
            else if (roll < 0.75) {
              polys = [quadUV(b.Q, 0.06, 0.44, 0.12, 0.88), quadUV(b.Q, 0.56, 0.94, 0.12, 0.88)]; label = "Pavilion pair";
              const gz = ter.G(Math.hypot(...bilinear(b.Q, 0.5, 0.5)));
              o.prism(ob, quadUV(b.Q, 0.46, 0.54, 0.2, 0.8), gz - 0.2, gz + 0.3, "roof");
            } else { polys = [quadUV(b.Q, 0.2, 0.8, 0.2, 0.8)]; label = "Planted hall"; }
            for (const [li, poly] of polys.entries()) {
              const [px, py] = centroid(poly), st = clamp(Math.round(lowStoreys() * cloudMul(plan, px, py)), 1, d.storeys[1] + 4);
              const bld = building(o, ob, ter, poly, st * plan.storey, "campus");
              o.lots.push({ d: d.id, row: `${bi}${k}`, key: `${d.id}|${bi}${k}|${b.k}|${b.j}|${li}`, poly, base: bld.base, top: bld.top, storeys: st, plinth: bld.plinth, area: polyArea(poly), label });
              o.band(`${d.id}|${bi}${k}`, row.r0, row.r1, bld.base, bld.top);
            }
          }
        });
        return;
      }
      const P = d[kind] || {};
      if (kind === "orchard") genEnergy(plan, d, ter, spokes, o, band, bi);
      plantBand(plan, d, ter, spokes, o, `${kind}${bi}`, band.r0 + 4, band.r1 - 4, P.spacing, kind === "orchard" ? 0.6 : 4.0, P.clearing || 0, PALETTE[kind] || PALETTE.grove);
      // irrigation rill down the middle of the band, broken at the spokes
      const rr = (band.r0 + band.r1) / 2, z = ter.G(rr);
      spokes.forEach((sp, k) => {
        const cut = sectorCuts(plan, spokes, k, rr, () => rr, () => rr);
        o.rills.push({ r: rr, a0: cut.a0, a1: cut.a1 });
        const n = Math.max(2, Math.ceil((cut.a1 - cut.a0) * rr / 12));
        for (let i = 0; i < n; i++) {
          const a = lerp(cut.a0, cut.a1, i / n), b = lerp(cut.a0, cut.a1, (i + 1) / n);
          if (onCanalLine(o, ...polar(rr, (a + b) / 2), 1)) continue;
          o.prism(rillOb, [polar(rr - 1.2, a), polar(rr - 1.2, b), polar(rr + 1.2, b), polar(rr + 1.2, a)], z - 0.4, z + 0.05, "water");
        }
      });
    });
  }

  function genTowers(plan, d, ter, spokes, o) {
    const sc = plan.scene, temple = sc.temple, island = sc.rings.find((r) => r.id === d.ring);
    const spireTop = temple.spire_top + ter.templeLift, hero = spokes.find((s) => s.hero), K = plan.skyline;
    // island deck: plateau round the temple, sloping down to the quay, with a quay wall to the inner water
    const deck = o.obj(`NBHD_${d.id}_deck`, d.id), r1 = island.r1 - 2, N = Math.ceil(TAU * island.r1 / 14);
    const pr = Math.min(plan.scene.terrain.plateau_r, r1 - 1);
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N, b = (i + 1) * TAU / N;
      for (const [ra, rb] of [[temple.r, pr], [pr, r1]]) {
        const top = [[...polar(ra, a), ter.G(ra)], [...polar(rb, a), ter.G(rb)], [...polar(rb, b), ter.G(rb)], [...polar(ra, b), ter.G(ra)]];
        o.solid(deck, top, top.map((p) => p[2] - 1.0), "paver");
      }
      const wz = ter.water.inner_water - 0.5, gz = ter.G(island.r1 - 0.5) + 1.1;
      if (!inCorridor(plan, spokes, ...polar(island.r1 - 2, (a + b) / 2), 2) && !spokes.some((sp) => angDist(sp.a, (a + b) / 2) < Math.asin(Math.min(1, (plan.spokes.corridor_half + 2) / island.r1))))
        o.prism(deck, [polar(island.r1 - 4, a), polar(island.r1, a), polar(island.r1, b), polar(island.r1 - 4, b)], wz, gz, "stone");
      const ca = SOUTH + rad(8), span = TAU - rad(16);
      const ga = ca + span * i / N, gb = ca + span * (i + 1) / N, gz2 = ter.G(temple.r + 1);
      o.prism(deck, [polar(temple.r + 1, ga), polar(temple.r + 15, ga), polar(temple.r + 15, gb), polar(temple.r + 1, gb)], gz2, gz2 + 0.5, "roof");
    }
    const [plo, phi] = d.podium_storeys, cap = spireTop - d.spire_clearance;
    ringLayout(plan, d).bands.forEach((row, ri) => {
      const hr = (d.band_heights || [])[ri] || [80, 150];
      const rm = (row.r0 + row.r1) / 2, n = Math.max(4, Math.min(400, Math.floor(TAU * rm / (d.block + d.street))));
      for (let i = 0; i < n; i++) {
        const R = rng(`${d.id}|${ri}|${i}`), step = TAU / n, jit = (d.jitter || 0) * step;
        const ac = SOUTH + (i + 0.5) * step + R.uniform(-jit, jit), half = step / 2 - d.street / 2 / rm;
        const a0 = ac - half * R.uniform(0.8, 1.0), a1 = ac + half * R.uniform(0.8, 1.0), am = (a0 + a1) / 2;
        if (hero && angDist(am, hero.a) < rad(d.forecourt_deg)) continue;
        const corners = [polar(row.r0, a0), polar(row.r1, a0), polar(row.r0, a1), polar(row.r1, a1)];
        if (corners.some(([x, y]) => inCorridor(plan, spokes, x, y, 1))) continue;
        // a wide sector can straddle a spoke with all four corners outside its corridor
        if (spokes.some((sp) => { const pad = Math.asin(Math.min(1, (blockHalf(plan, sp) + 1) / row.r0)); return angDist(sp.a, am) < (a1 - a0) / 2 + pad; })) continue;
        const flank = Math.pow(Math.abs(Math.cos(am)), d.flank_power);
        let H = (hr[0] + (hr[1] - hr[0]) * flank * R.uniform(0.8, 1.0)) * Math.exp(K.chaos * 0.45 * R.normal());
        if (R.random() < K.spike_chance * 1.5) H *= R.uniform(1.08, 1.22);
        H *= cloudMul(plan, ...polar((row.r0 + row.r1) / 2, am), plan.cloud?.tower_share ?? 0.5);
        if (angDist(am, NORTH) < rad(d.north_cap_deg)) H = Math.min(H, hr[0] * d.north_cap_factor);
        const podium = R.randint(plo, Math.max(plo, phi)) * plan.storey;
        const zs = corners.map(([x, y]) => ter.G(Math.hypot(x, y))), base = Math.max(...zs) + 0.05, zmin = Math.min(...zs);
        // keep the drawn top (podium lip + shaft + needle) under the cap, not just the nominal height
        const Hmax = podium + Math.max(4, (cap - base - podium - 1) / 1.08);
        const capped = H >= Hmax - 1e-6;
        H = Math.min(H, Hmax);
        const ob = o.obj(`NBHD_${d.id}_tower_b${ri}_${String(i).padStart(3, "0")}`, d.id, { height_m: Math.round(H * 10) / 10 });
        const pod = [], m = Math.max(2, Math.ceil((a1 - a0) * row.r1 / 6));
        for (let k = 0; k <= m; k++) pod.push(polar(row.r1, lerp(a0, a1, k / m)));
        for (let k = m; k >= 0; k--) pod.push(polar(row.r0, lerp(a0, a1, k / m)));
        if (Math.max(...zs) - zmin > 0.1) o.prism(ob, pod, zmin - 0.3, base, "plinth");
        o.prism(ob, pod, base, base + podium, "stone");
        o.prism(ob, inset(pod, -0.4), base + podium, base + podium + 1, "lip");
        const rect = (s) => { const w = (a1 - a0) * rm * 0.66 * s, dd = (row.r1 - row.r0) * 0.72 * s, [cx, cy] = polar(rm, am), tx = -Math.sin(am), ty = Math.cos(am), rx = Math.cos(am), ry = Math.sin(am);
          return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [cx + sx * w / 2 * tx + sy * dd / 2 * rx, cy + sx * w / 2 * ty + sy * dd / 2 * ry]); };
        const b0 = base + podium + 1, span = Math.max(H - podium, 4);
        for (const [t0, t1, s] of [[0, 0.58, 1], [0.58, 0.78, 0.8], [0.78, 0.91, 0.6], [0.91, 1, 0.4]]) {
          o.prism(ob, rect(s), b0 + span * t0, b0 + span * t1, "stone");
          o.prism(ob, rect(s + 0.04), b0 + span * t1 - 0.6, b0 + span * t1 + 0.4, "lip");
        }
        const needle = H > hr[0] * 0.9 ? span * 0.08 : 0;
        if (needle) o.prism(ob, rect(0.06), b0 + span, b0 + span + needle, "lip");
        o.lots.push({ d: d.id, row: ri, key: `${d.id}|${ri}|${i}`, poly: pod, tower: rect(1), crown: rect(0.4), base, top: b0 + span + needle, podiumTop: base + podium, height: H, capped, storeys: Math.round(H / plan.storey), area: polyArea(pod) });
        o.band(`${d.id}|${ri}`, row.r0, row.r1, base, b0 + span + needle);
      }
    });
  }

  // ---------------------------------------------------------------- ring avenues
  // One-way ring roads: level along their radius, broken only where a spoke crosses. Chevrons on the
  // carriageway point the way traffic runs; the boulevard avenue gets a double tree row.
  function genRingAvenues(plan, ter, spokes, o) {
    const S = plan.spokes, species = ["asset_Plant_civic", "asset_Plant_fruit", "asset_Plant_open", "asset_Plant_column"];
    for (const d of plan.districts) {
      if (d.enabled === false) continue;
      for (const av of ringLayout(plan, d).avenues) {
        const ob = o.obj(`RINGAVE_${d.id}_${av.idx}_${av.dir}`, "avenues", { one_way: av.dir === "cw" ? "clockwise" : "anticlockwise", radius: av.r });
        const road = Math.min(av.road || 12, av.w - 4), z = ter.G(av.r), sign = av.dir === "cw" ? -1 : 1;
        const info = { d: d.id, r: av.r, w: av.w, road, dir: av.dir, arcs: [] };
        spokes.forEach((sp, k) => {
          const sb = spokes[(k + 1) % spokes.length];
          let a0 = edgeAngle(sp, S.road_half, +1, av.r), a1 = edgeAngle(sb, S.road_half, -1, av.r);
          while (a1 <= a0) a1 += TAU;
          info.arcs.push([a0, a1]);
          const n = Math.max(2, Math.ceil((a1 - a0) * av.r / 12));
          for (let i = 0; i < n; i++) {
            const a = lerp(a0, a1, i / n), b = lerp(a0, a1, (i + 1) / n);
            const q = (r0, r1) => [polar(r0, a), polar(r0, b), polar(r1, b), polar(r1, a)];
            o.prism(ob, q(av.r - road / 2, av.r + road / 2), z - 0.4, z + 0.02, "road");
            o.prism(ob, q(av.r - av.w / 2, av.r - road / 2), z - 0.4, z + 0.15, "paver");
            o.prism(ob, q(av.r + road / 2, av.r + av.w / 2), z - 0.4, z + 0.15, "paver");
          }
          // direction chevrons every ~70 m
          for (let s = 35; s < (a1 - a0) * av.r - 20; s += 70) {
            const a = a0 + s / av.r, tip = a + sign * 3 / av.r, tail = a - sign * 2 / av.r;
            for (const off of [-road * 0.28, road * 0.28]) {
              const p0 = polar(av.r + off, tail), p1 = polar(av.r, tip), px = 0.4 * Math.cos(a), py = 0.4 * Math.sin(a);
              o.prism(ob, [p0, p1, [p1[0] + px, p1[1] + py], [p0[0] + px, p0[1] + py]], z + 0.02, z + 0.06, "lip");
            }
          }
          if (av.tree_spacing >= 1) for (const [side, rr] of [["in", av.r - av.w / 2 + 3], ["out", av.r + av.w / 2 - 3]]) {
            let t0 = edgeAngle(sp, blockHalf(plan, sp) + 2, +1, rr), t1 = edgeAngle(sb, blockHalf(plan, sb) + 2, -1, rr);
            while (t1 <= t0) t1 += TAU;
            const m = Math.floor((t1 - t0) * rr / av.tree_spacing);
            for (let j = 0; j < m; j++) {
              const R = rng(`${d.id}ave${av.idx}|${side}|${k}|${j}`), a = t0 + (j + 0.5) * (t1 - t0) / m;
              const [x, y] = polar(rr + R.uniform(-0.6, 0.6), a + R.uniform(-0.3, 0.3) / rr);
              if (onCanalLine(o, x, y, 2, false)) continue;  // the avenue bridges a canal here
              tree(o, ter, "avenues", R.choice(species), x, y, R, `RINGAVE_${d.id}_${av.idx}_tree_${side}_${k}_${String(j).padStart(4, "0")}`, 0.8, 1.25, z + 0.15);
            }
          }
        });
        o.avenues.push(info);
      }
    }
  }

  // ---------------------------------------------------------------- skywalks
  // Every ring gets one continuous network, a couple of storeys up:
  //   spines  a complete loop along each of the ring's two avenues, on the side facing the ring's middle
  //           band, bridged over every spoke
  //   rungs   per sector, links between the two spines along the cell-edge streets of the middle band
  //           (straight bridges where the band has no cells, as on the island)
  //   over    straight sky bridges from spine to spine high over the roofs of the middle band, each at
  //           the lowest of a few nearby lines, with a lift tower at both ends down past the spine
  //   links   ring to ring along the spokes: from one ring's outer spine to the next ring's inner spine,
  //           over the spoke's sidewalk and across the ring canal, climbing or dropping between levels
  //   extras  galleries on the avenues' other sides where commercial or entertainment blocks front them,
  //           and street walkways, kept only where they join the network (bridged back to a spine)
  function genSkywalks(plan, ter, spokes, o) {
    const SW = plan.skywalks;
    if (!SW || SW.enabled === false) return;
    try { return genSkywalksInner(plan, ter, spokes, o); } finally {
      // avenue trees can't stand under a deck: drop any within the deck's width (plus crown room)
      const arcs = o.skywalks.filter((w) => w.kind === "arc"), Wd = (SW.width || 4) / 2 + 2.5;
      const under = (x, y) => { const r = Math.hypot(x, y), a = Math.atan2(y, x); return arcs.some((w) => Math.abs(r - w.r) < Wd && angDist(a, (w.a0 + w.a1) / 2) <= (w.a1 - w.a0) / 2 + 1e-4); };
      const links = o.skywalks.filter((w) => w.over === "spoke-link");
      const underLink = (x, y) => links.some((w) => { const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L2 = dx * dx + dy * dy || 1, t = clamp(((x - w.a[0]) * dx + (y - w.a[1]) * dy) / L2, 0, 1); return Math.hypot(x - w.a[0] - t * dx, y - w.a[1] - t * dy) < Wd; });
      const keep = o.instances.map((it) => !((it.coll === "avenues" && under(it.x, it.y)) || (it.coll === "spokes" && underLink(it.x, it.y))));
      const drop = new Set(o.instances.filter((_, i) => !keep[i]).map((it) => `${it.x.toFixed(2)},${it.y.toFixed(2)}`));
      o.instances = o.instances.filter((_, i) => keep[i]);
      o.trees = o.trees.filter(([x, y]) => !drop.has(`${x.toFixed(2)},${y.toFixed(2)}`));
    }
  }
  function genSkywalksInner(plan, ter, spokes, o) {
    const SW = plan.skywalks;
    const W = SW.width || 4, F = SW.frontage || { commercial: 1, entertainment: 1, residential: 0.25, college: 0.3 }, CH = plan.spokes.corridor_half;
    const cs = 80, grid = new Map();
    o.cells.forEach((c, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of c.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let gx = Math.floor(x0 / cs); gx <= Math.floor(x1 / cs); gx++) for (let gy = Math.floor(y0 / cs); gy <= Math.floor(y1 / cs); gy++) (grid.get(`${gx},${gy}`) || grid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)).push(i);
    });
    const cellAt = (x, y) => {
      for (const i of grid.get(`${Math.floor(x / cs)},${Math.floor(y / cs)}`) || []) {
        const q = o.cells[i].poly; let inside = false;
        for (let a = 0, b = q.length - 1; a < q.length; b = a++) if ((q[a][1] > y) !== (q[b][1] > y) && x < (q[b][0] - q[a][0]) * (y - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
        if (inside) return i;
      }
      return null;
    };
    const ob = o.obj("SKYWALKS", "skywalks", { use: "skywalk" });
    const levelOf = (dId) => rng(`sky|level|${dId}`).randint(...(SW.levels || [2, 3]));
    const zAt = (dId, x, y) => ter.G(Math.hypot(x, y)) + levelOf(dId) * plan.storey;
    const deckArc = (r, a0, a1, z, ring) => {
      const n = Math.max(1, Math.ceil((a1 - a0) * r / 8));
      for (let i = 0; i < n; i++) {
        const a = lerp(a0, a1, i / n), b = lerp(a0, a1, (i + 1) / n), q = (r0, r1) => [polar(r0, a), polar(r0, b), polar(r1, b), polar(r1, a)];
        o.prism(ob, q(r - W / 2, r + W / 2), z - 0.5, z, "paver");
        o.prism(ob, q(r - W / 2, r - W / 2 + 0.15), z, z + 1.1, "lip");
        o.prism(ob, q(r + W / 2 - 0.15, r + W / 2), z, z + 1.1, "lip");
      }
      for (let s2 = 12; s2 < (a1 - a0) * r; s2 += 24) {
        const a = a0 + s2 / r;
        if (onCanalLine(o, ...polar(r, a), 1, false)) continue;  // no columns in the canals
        o.prism(ob, [polar(r - 0.35, a - 0.35 / r), polar(r + 0.35, a - 0.35 / r), polar(r + 0.35, a + 0.35 / r), polar(r - 0.35, a + 0.35 / r)], ter.G(r), z - 0.5, "stone");
      }
      o.skywalks.push({ kind: "arc", r, a0, a1, z, w: W, ring });
    };
    // a straight deck that may slope between two heights, with rails and a column or two
    const deckLine = (p, q2, z0, z1, ring, over, colOk) => {
      const L = dist(p, q2); if (L < 0.5) return;
      const nx = -(q2[1] - p[1]) / L * W / 2, ny = (q2[0] - p[0]) / L * W / 2, rx = nx / (W / 2) * 0.15, ry = ny / (W / 2) * 0.15;
      const top = [[p[0] - nx, p[1] - ny, z0], [q2[0] - nx, q2[1] - ny, z1], [q2[0] + nx, q2[1] + ny, z1], [p[0] + nx, p[1] + ny, z0]];
      o.solid(ob, top, top.map((t) => t[2] - 0.5), "paver");
      for (const sd of [-1, 1]) {
        const rt = [[p[0] + nx * sd, p[1] + ny * sd, z0 + 1.1], [q2[0] + nx * sd, q2[1] + ny * sd, z1 + 1.1], [q2[0] + nx * sd - rx * sd, q2[1] + ny * sd - ry * sd, z1 + 1.1], [p[0] + nx * sd - rx * sd, p[1] + ny * sd - ry * sd, z0 + 1.1]];
        o.solid(ob, rt, [z0, z1, z1, z0], "lip");
      }
      for (let s2 = 14; s2 < L - 4; s2 += 24) {
        const f = s2 / L, cx = lerp(p[0], q2[0], f), cy = lerp(p[1], q2[1], f);
        if ((colOk && !colOk(cx, cy)) || onCanalLine(o, cx, cy, 1, false)) continue;
        o.prism(ob, [[cx - 0.35, cy - 0.35], [cx + 0.35, cy - 0.35], [cx + 0.35, cy + 0.35], [cx - 0.35, cy + 0.35]], ter.G(Math.hypot(cx, cy)), lerp(z0, z1, f) - 0.5, "stone");
      }
      o.skywalks.push({ kind: "line", a: p, b: q2, z: (z0 + z1) / 2, w: W, ring, over });
    };
    const access = (r, a0, z, kind, slide = true) => {
      // a lift or stair tower stands on dry, open ground: spine and gallery towers slide along their deck
      // to find some; a tower at the end of a link stays put or isn't built
      const span = kind === "lift" ? 3 : 14, w = kind === "lift" ? 1.8 : 1.3;
      const ok = (b) => [0, 0.5, 1].every((f) => { const p0 = polar(r, b + f * span / r); return !onCanalLine(o, ...p0, 2.5, false) && [-w, w].every((dw) => roofAt(...polar(r + dw, b + f * span / r)) == null); });
      let a = a0;
      for (let k = 1; slide && !ok(a) && k <= 12; k++) a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6 / r;
      if (!ok(a)) return;
      const g = ter.G(r), [x, y] = polar(r, a);
      if (kind === "lift") o.prism(ob, [polar(r - 1.8, a - 1.8 / r), polar(r + 1.8, a - 1.8 / r), polar(r + 1.8, a + 1.8 / r), polar(r - 1.8, a + 1.8 / r)], g, z + 2.8, "glass");
      else for (let i = 0, n = 6, len = 12; i < n; i++) {
        const b0 = a + (i * len / n) / r, b1 = a + ((i + 1) * len / n) / r;
        o.prism(ob, [polar(r - 1.3, b0), polar(r + 1.3, b0), polar(r + 1.3, b1), polar(r - 1.3, b1)], g, g + (z - g) * (i + 1) / n, "stair");
      }
      o.skyAccess.push({ x, y, kind });
    };
    // roof heights, for bridges that pass over the buildings
    const lotGrid = new Map();
    o.lots.forEach((l, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of l.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let gx = Math.floor(x0 / cs); gx <= Math.floor(x1 / cs); gx++) for (let gy = Math.floor(y0 / cs); gy <= Math.floor(y1 / cs); gy++) (lotGrid.get(`${gx},${gy}`) || lotGrid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)).push(i);
    });
    const roofAt = (x, y) => {
      let top = null;
      for (const i of lotGrid.get(`${Math.floor(x / cs)},${Math.floor(y / cs)}`) || []) {
        const q = o.lots[i].poly; let inside = false;
        for (let a = 0, b = q.length - 1; a < q.length; b = a++) if ((q[a][1] > y) !== (q[b][1] > y) && x < (q[b][0] - q[a][0]) * (y - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
        if (inside) top = Math.max(top ?? -Infinity, o.lots[i].top);
      }
      return top;
    };
    const nS = spokes.length;
    const sectorSpan = (k, r) => { const a0 = edgeAngle(spokes[k], CH, +1, r); let a1 = edgeAngle(spokes[(k + 1) % nS], CH, -1, r); while (a1 <= a0) a1 += TAU; return [a0, a1]; };
    let accessIdx = 0;
    const ringSpines = [];
    for (const d of plan.districts) {
      if (d.enabled === false) continue;
      const avs = o.avenues.filter((a) => a.d === d.id).sort((a, b) => a.r - b.r);
      if (avs.length < 2) continue;
      const [A, B] = avs, ring = d.id, level = levelOf(d.id);
      // spines on the middle-band side of each avenue
      const spineR = [A.r + (A.w / 2 - W / 2 - 0.5), B.r - (B.w / 2 - W / 2 - 0.5)];
      ringSpines.push({ d: d.id, spineR, level });
      spineR.forEach((rw) => {
        const z = ter.G(rw) + level * plan.storey;
        for (let k = 0; k < nS; k++) {
          const [a0, a1] = sectorSpan(k, rw);
          deckArc(rw, a0, a1, z, ring);
          const [b0] = sectorSpan((k + 1) % nS, rw);
          deckLine(polar(rw, a1), polar(rw, b0), z, z, ring, "spoke");  // over the spoke avenue
          const len = (a1 - a0) * rw, n = Math.max(1, Math.round(len / (SW.access_every || 220)));
          for (let j = 0; j < n; j++) access(rw + (rw === spineR[0] ? 1 : -1) * (W / 2 + 1.6), a0 + (j + 0.5) * (a1 - a0) / n, z, accessIdx++ % 2 ? "stairs" : "lift");
        }
      });
      const L = ringLayout(plan, d), mid = L.bands.find((b) => b.r0 >= A.r && b.r1 <= B.r);
      const edges = mid ? o.cellEdges.filter((e) => e.d === d.id && e.band.i === mid.i) : [];
      // rungs between the two spines, per sector
      const rungKeys = new Set(), kOf = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
      for (let k = 0; k < nS; k++) {
        const [s0, s1] = sectorSpan(k, (A.r + B.r) / 2), nR = Math.max(1, SW.rungs_per_sector || 2);
        for (let ri = 0; ri < nR; ri++) {
          const target = s0 + (ri + 0.5) * (s1 - s0) / nR;
          const sector = edges.filter((e) => [e.p, e.q].every((p) => { const b = Math.atan2(p[1], p[0]); return angDist(b, (s0 + s1) / 2) < (s1 - s0) / 2; }));
          let path = null;
          if (sector.length) {
            const nodes = new Map(), adj = new Map(), add = (p) => { const kk = kOf(p); if (!nodes.has(kk)) { nodes.set(kk, p); adj.set(kk, []); } return kk; };
            for (const e of sector) {
              const ka = add(e.p), kb = add(e.q), L2 = dist(e.p, e.q);
              const good = e.uses.filter((u) => u === "commercial" || u === "entertainment").length;
              const cost = L2 * (good === 2 ? 1 : good === 1 ? 1.5 : 2.5) * (e.wet ? 2 : 1);
              adj.get(ka).push({ to: kb, c: cost }); adj.get(kb).push({ to: ka, c: cost });
            }
            const rOf = (kk) => Math.hypot(...nodes.get(kk)), dev = (kk) => { const [x, y] = nodes.get(kk); return angDist(Math.atan2(y, x), target) * Math.hypot(x, y); };
            const D = new Map(), prev = new Map(), done = new Set(), heap = [];
            for (const kk of nodes.keys()) if (rOf(kk) <= mid.r0 + 6) { D.set(kk, dev(kk) * 3); heap.push([dev(kk) * 3, kk]); }
            let end = null;
            while (heap.length) {
              heap.sort((x, y) => x[0] - y[0]);
              const [dk, kk] = heap.shift();
              if (done.has(kk)) continue;
              done.add(kk);
              if (rOf(kk) >= mid.r1 - 6) { end = kk; break; }
              for (const e of adj.get(kk)) {
                if (done.has(e.to)) continue;
                const c = dk + e.c * (1 + (dev(e.to) / 90) ** 2);
                if (c < (D.get(e.to) ?? Infinity)) { D.set(e.to, c); prev.set(e.to, kk); heap.push([c, e.to]); }
              }
            }
            if (end) { path = []; for (let kk = end; kk; kk = prev.get(kk)) path.unshift(nodes.get(kk)); }
          }
          if (!path) path = [polar(mid ? mid.r0 : spineR[0], target), polar(mid ? mid.r1 : spineR[1], target)];  // no cells: a straight rung
          const pts = [polar(spineR[0], Math.atan2(path[0][1], path[0][0])), ...path, polar(spineR[1], Math.atan2(path[path.length - 1][1], path[path.length - 1][0]))];
          for (let i = 0; i < pts.length - 1; i++) deckLine(pts[i], pts[i + 1], zAt(d.id, ...pts[i]), zAt(d.id, ...pts[i + 1]), ring, "rung");
          path.forEach((p) => rungKeys.add(kOf(p)));
          const m = pts[Math.floor(pts.length / 2)];
          access(Math.hypot(...m), Math.atan2(m[1], m[0]), zAt(d.id, ...m), accessIdx++ % 2 ? "stairs" : "lift", false);
        }
      }
      // sky bridges over the roofs, spine to spine, between the rungs
      const OV = SW.over || {};
      if (OV.per_sector > 0) for (let k = 0; k < nS; k++) {
        const rm = (spineR[0] + spineR[1]) / 2, [s0, s1] = sectorSpan(k, rm), nO = OV.per_sector, zSpine = Math.max(...spineR.map((r) => ter.G(r))) + level * plan.storey;
        const rA = spineR[0] + W / 2 + 2.2, rB = spineR[1] - W / 2 - 2.2;  // lift towers just inside each spine
        for (let j = 0; j < nO; j++) {
          const base = s0 + (j + 0.5) * (s1 - s0) / nO;
          let best = null;
          for (let t = -3; t <= 3; t++) {  // try a few parallel lines, keep the one with the lowest roofs
            const a = base + t * 8 / rm;
            if (a < s0 + 20 / rm || a > s1 - 20 / rm) continue;
            let top = -Infinity;
            for (let r = rA; r <= rB; r += 3) for (const w of [-W / 2, 0, W / 2]) { const [x, y] = polar(r, a), rt = roofAt(x - Math.sin(a) * w, y + Math.cos(a) * w); if (rt != null) top = Math.max(top, rt); }
            if (!best || top < best.top) best = { a, top };
          }
          if (!best) continue;
          const z = Math.max(zSpine + 2 * plan.storey, best.top + (OV.clearance ?? 3) + 0.5);
          if (z - Math.min(ter.G(rA), ter.G(rB)) > (OV.max_storeys || 16) * plan.storey) continue;  // too tall here: leave it to the rungs
          const pa = polar(rA, best.a), pb = polar(rB, best.a);
          deckLine(pa, pb, z, z, ring, "roofs", (x, y) => roofAt(x, y) == null);
          for (const [r, sr] of [[rA, spineR[0]], [rB, spineR[1]]]) {
            access(r, best.a, z, "lift", false);
            const zs = ter.G(sr) + level * plan.storey;  // a short link from the tower to the spine at spine level
            deckLine(polar(sr, best.a), polar(r, best.a), zs, zs, ring, "link");
          }
        }
      }
      // extras 1: galleries on the avenues' outer sides, each bridged back to its spine
      for (const [av, side, spine] of [[A, -1, spineR[0]], [B, 1, spineR[1]]]) {
        const rw = av.r + side * (av.w / 2 - W / 2 - 0.5), rf = av.r + side * (av.w / 2 + (plan.side_street || 10) / 2 + 5), z = ter.G(rw) + level * plan.storey;
        for (let k = 0; k < nS; k++) {
          const [a0, a1] = sectorSpan(k, rw), step = 8 / rw, runs = [];
          let cur = null;
          for (let a = a0; a < a1 - 1e-9; a += step) {
            const ci = cellAt(...polar(rf, a)), use = ci == null ? null : o.cells[ci].use, w = use ? (F[use] || 0) * (o.cells[ci].sky ?? 1) : 0;
            const on = w >= 1 || (w > 0 && rng(`sky|cell|${ci}`).random() < w);
            if (on) { if (!cur) cur = { a0: a, a1: a }; cur.a1 = Math.min(a1, a + step); } else if (cur) { runs.push(cur); cur = null; }
          }
          if (cur) runs.push(cur);
          const joined = [];
          for (const r2 of runs) { const last = joined[joined.length - 1]; if (last && (r2.a0 - last.a1) * rw < (SW.join_gap ?? 40)) last.a1 = r2.a1; else joined.push({ ...r2 }); }
          for (const r2 of joined.filter((x) => (x.a1 - x.a0) * rw >= (SW.min_run ?? 50))) {
            deckArc(rw, r2.a0, r2.a1, z, ring);
            const len = (r2.a1 - r2.a0) * rw, n = Math.max(1, Math.floor(len / (SW.cross_every || 450)));
            for (let j = 0; j < n; j++) {  // bridges back across the avenue to the spine
              const a = r2.a0 + (j + 0.5) * (r2.a1 - r2.a0) / n;
              deckLine(polar(rw, a), polar(spine, a), z, ter.G(spine) + level * plan.storey, ring, "avenue");
            }
            access(rw - side * (W / 2 + 1.6), r2.a1 - 14 / rw, z, accessIdx++ % 2 ? "stairs" : "lift");
          }
        }
      }
      // extras 2: street walkways, kept only where they join a rung, or meet a spine at the middle band's edge
      const E = SW.edges || {}, picked = [];
      for (const e of o.cellEdges.filter((x) => x.d === d.id)) {
        if (e.wet && !E.over_canals) continue;
        const w = (F[e.uses[0]] || 0) * (F[e.uses[1]] || 0) * (E.chance ?? 0.6) * (e.sky ? Math.sqrt(e.sky[0] * e.sky[1]) : 1);
        if (rng(`sky|edge|${Math.round(e.p[0])}|${Math.round(e.p[1])}|${Math.round(e.q[0])}`).random() < w) picked.push(e);
      }
      const par = new Map(), find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
      for (const e of picked) for (const p of [e.p, e.q]) if (!par.has(kOf(p))) par.set(kOf(p), kOf(p));
      for (const e of picked) { const ra = find(kOf(e.p)), rb = find(kOf(e.q)); if (ra !== rb) par.set(ra, rb); }
      const joins = new Map();  // component -> how it meets the network
      for (const e of picked) for (const p of [e.p, e.q]) {
        const c = find(kOf(p)), r = Math.hypot(...p);
        if (rungKeys.has(kOf(p))) joins.set(c, joins.get(c) || { rung: true });
        else if (mid && e.band.i === mid.i && (r <= mid.r0 + 6 || r >= mid.r1 - 6) && !joins.has(c)) joins.set(c, { link: p, spine: r <= mid.r0 + 6 ? spineR[0] : spineR[1] });
      }
      for (const e of picked) {
        const j = joins.get(find(kOf(e.p)));
        if (!j) continue;  // would float free of the ring's network
        deckLine(e.p, e.q, zAt(d.id, ...e.p), zAt(d.id, ...e.q), ring, "street");
      }
      for (const j of joins.values()) if (j.link) {
        const b = Math.atan2(j.link[1], j.link[0]), sp2 = polar(j.spine, b);
        deckLine(j.link, sp2, zAt(d.id, ...j.link), zAt(d.id, ...sp2), ring, "street");
      }
    }
    // links between neighbouring rings along the spokes, on the sidewalk side of the road
    const LK = SW.spoke_links || {};
    if (LK.enabled !== false && ringSpines.length > 1) {
      const prof = makeProfile(plan, ter), S = plan.spokes, off = S.road_half + S.verge + W / 2 + 0.5;
      const minClear = (LK.clearance_storeys ?? 2) * plan.storey, sides = LK.sides === 2 ? [-1, 1] : [1];
      ringSpines.sort((a, b) => a.spineR[0] - b.spineR[0]);
      let maxGrade = 0;
      for (let i = 0; i < ringSpines.length - 1; i++) {
        const lo = ringSpines[i], hi = ringSpines[i + 1], t0 = lo.spineR[1], t1 = hi.spineR[0];
        const z0 = ter.G(t0) + lo.level * plan.storey, z1 = ter.G(t1) + hi.level * plan.storey;
        for (const sp of spokes) for (const sd of sides) {
          if (sp.hero && LK.skip_hero) continue;
          const ca = Math.cos(sp.a), sa = Math.sin(sp.a), P = (t) => [t * ca - sd * off * sa, t * sa + sd * off * ca];
          // sample the spoke, keep the deck a couple of storeys over the sidewalk and bridges
          const n = Math.max(2, Math.ceil((t1 - t0) / 20)), zs = [];
          for (let j = 0; j <= n; j++) { const t = lerp(t0, t1, j / n); zs.push(Math.max(lerp(z0, z1, j / n), Math.max(prof.walk(t), prof.road(t)) + minClear)); }
          zs[0] = z0; zs[n] = z1;
          for (let j = 0; j < n; j++) {
            const ta = lerp(t0, t1, j / n), tb = lerp(t0, t1, (j + 1) / n);
            maxGrade = Math.max(maxGrade, Math.abs(zs[j + 1] - zs[j]) / (tb - ta));
            deckLine(P(ta), P(tb), zs[j], zs[j + 1], `${lo.d}>${hi.d}`, "spoke-link");
          }
          // a lift where the link lands on each bank of the canal between the rings
          const wr = plan.scene.rings.find((r) => r.kind === "water" && r.r0 >= t0 && r.r1 <= t1);
          if (wr) for (const t of [wr.r0 - 8, wr.r1 + 8]) {
            const j = clamp(Math.round((t - t0) / (t1 - t0) * n), 0, n), [x, y] = P(t);
            access(Math.hypot(x, y), Math.atan2(y, x) + sd * (W / 2 + 1.6) / Math.hypot(x, y), zs[j], "lift", false);
          }
        }
      }
      if (maxGrade > 1 / 12 + 1e-6) o.warnings.push(`A ring-to-ring skywalk link climbs at 1:${(1 / maxGrade).toFixed(1)}, steeper than a 1:12 ramp.`);
    }
  }

  // ---------------------------------------------------------------- spoke avenues
  function genSpokes(plan, ter, spokes, o) {
    const S = plan.spokes, walkW = S.corridor_half - S.road_half - S.verge, split = S.road_half + S.verge + walkW * S.ramp_share;
    const species = ["asset_Plant_civic", "asset_Plant_fruit", "asset_Plant_open", "asset_Plant_column", "asset_Plant_sapling"];
    for (const sp of spokes) {
      const prof = makeProfile(plan, ter, sp.hero ? S.hero_skip_crossings : []);
      const ranges = sp.hero ? subtract([[S.r_inner, S.r_outer]], S.hero_kit_ranges) : [[S.r_inner, S.r_outer]];
      const ob = o.obj(`SPOKE_${sp.k}${sp.hero ? "_hero" : ""}`, "spokes", { bearing_deg: Math.round(((sp.a * 180 / Math.PI) + 360) % 360) });
      const info = { k: sp.k, a: sp.a, hero: sp.hero, ranges, stairs: [], ramps: [], bridges: [], profile: prof };
      // breakpoints: ring edges, ramp ends, stair zones, every 10 m
      const brk = new Set();
      for (const r of plan.scene.rings) { brk.add(r.r0); brk.add(r.r1); }
      prof.rampEnd.forEach((t) => brk.add(t));
      const zones = [];
      for (const st of prof.steps) {
        const top = prof.road(st.t), n = Math.max(1, Math.ceil(st.drop / S.riser_max));
        const landings = Math.floor((n - 1) / S.landing_every), run = n * S.tread + landings * S.landing;
        const slopeG = Math.max(0, (ter.G(st.t + 5) - ter.G(st.t + 15)) / 10);
        const rampLen = st.drop / Math.max(0.01, S.ramp_slope - slopeG);
        zones.push({ t: st.t, top, n, run, rampLen, landings });
        brk.add(st.t); brk.add(st.t + run); brk.add(st.t + rampLen);
      }
      for (const [t0, t1] of ranges) { brk.add(t0); brk.add(t1); for (let t = Math.ceil(t0 / 10) * 10; t < t1; t += 10) brk.add(t); }
      const ts = [...brk].filter((t) => t >= S.r_inner - 1e-6 && t <= S.r_outer + 1e-6).sort((a, b) => a - b);
      const inRanges = (a, b) => ranges.some(([r0, r1]) => a >= r0 - 1e-6 && b <= r1 + 1e-6);
      const strip = (ta, tb, s0, s1, za, zb, botA, botB, m) => {
        const top = [[...spokePt(sp, ta, s0), za], [...spokePt(sp, tb, s0), zb], [...spokePt(sp, tb, s1), zb], [...spokePt(sp, ta, s1), za]];
        o.solid(ob, top, [botA, botB, botB, botA], m);
      };
      for (let i = 0; i < ts.length - 1; i++) {
        const ta = ts[i], tb = ts[i + 1], tm = (ta + tb) / 2;
        if (tb - ta < 1e-3 || !inRanges(ta, tb)) continue;
        const ra = prof.road(ta), rb = prof.road(tb), water = ter.isWater(tm);
        // sample ground and sidewalk just inside the segment: at a ring edge G() belongs to the other ring
        const ia = ta + 1e-4, ib = tb - 1e-4, ga = ter.G(ia), gb = ter.G(ib);
        const wA = water ? ra : prof.walk(ia), wB = water ? rb : prof.walk(ib);
        const bot = (z, g) => (water ? z - 1.4 : Math.min(z, g) - 0.4);
        strip(ta, tb, -S.road_half, S.road_half, ra, rb, bot(ra, ga), bot(rb, gb), "road");
        strip(ta, tb, -2.2, 2.2, ra + 0.15, rb + 0.15, ra - 0.1, rb - 0.1, water ? "lip" : "roof");
        for (const side of [-1, 1]) {
          const sv0 = side * S.road_half, sv1 = side * (S.road_half + S.verge);
          strip(ta, tb, Math.min(sv0, sv1), Math.max(sv0, sv1), ra + 0.12, rb + 0.12, bot(ra, ga), bot(rb, gb), "roof");
          const zone = zones.find((z) => tm > z.t && tm < z.t + Math.max(z.run, z.rampLen));
          const bands = [[S.road_half + S.verge, split, "ramp"], [split, S.corridor_half, "stair"]];
          for (const [b0, b1, kind] of bands) {
            const s0 = side * b0, s1 = side * b1, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
            if (zone && kind === "stair" && tm < zone.t + zone.run) continue;       // stair flight drawn below
            if (zone && kind === "ramp" && tm < zone.t + zone.rampLen) {            // 1:12 ramp up to the bridge
              const f = (t) => zone.top + (ter.G(zone.t + zone.rampLen) - zone.top) * (t - zone.t) / zone.rampLen;
              strip(ta, tb, lo, hi, f(ta), f(tb), ga - 0.4, gb - 0.4, "paver");
              continue;
            }
            strip(ta, tb, lo, hi, wA, wB, water ? wA - 1.4 : Math.min(wA, ga) - 0.4, water ? wB - 1.4 : Math.min(wB, gb) - 0.4, "paver");
          }
          // retaining wall + parapet where the road rides above the sidewalk on its approach ramp
          if (!water && (ra - wA > 0.3 || rb - wB > 0.3)) {
            const e = side * (S.road_half + S.verge), w0 = Math.min(e, e + side * 0.45), w1 = Math.max(e, e + side * 0.45);
            strip(ta, tb, w0, w1, ra + 1.05, rb + 1.05, Math.min(wA, ga) - 0.3, Math.min(wB, gb) - 0.3, "stone");
          }
          if (water) {
            const e = side * S.corridor_half, w0 = Math.min(e, e - side * 0.4), w1 = Math.max(e, e - side * 0.4);
            strip(ta, tb, w0, w1, wA + 1.1, wB + 1.1, wA - 1.4, wB - 1.4, "stone");
          }
        }
        if (water) info.bridges.push([ta, tb]);
      }
      // stair flights (building side) at each outer abutment
      for (const z of zones) {
        if (!inRanges(z.t, z.t + z.run)) continue;
        const zBottom = ter.G(z.t + z.run + 0.01), rise = (z.top - zBottom) / z.n;
        let t = z.t + z.run;
        for (let s = 0; s < z.n; s++) {
          if (s > 0 && s % S.landing_every === 0) {  // landing at the height of the step below it
            for (const side of [-1, 1]) {
              const s0 = side * split, s1 = side * S.corridor_half;
              o.prism(ob, [spokePt(sp, t - S.landing, s0), spokePt(sp, t, s0), spokePt(sp, t, s1), spokePt(sp, t - S.landing, s1)], zBottom - 0.4, zBottom + s * rise, "stair");
            }
            t -= S.landing;
          }
          const t1 = t - S.tread, zt = zBottom + (s + 1) * rise;
          for (const side of [-1, 1]) {
            const s0 = side * split, s1 = side * S.corridor_half;
            o.prism(ob, [spokePt(sp, t1, s0), spokePt(sp, t, s0), spokePt(sp, t, s1), spokePt(sp, t1, s1)], zBottom - 0.4, zt, "stair");
          }
          t = t1;
        }
        info.stairs.push({ t: z.t, run: z.run, n: z.n, rise: z.top - zBottom });
        info.ramps.push({ t: z.t, len: z.rampLen });
      }
      // the hand-built rings leave a wide wedge open round the hero avenue: give the new blocks ground
      if (sp.hero && S.hero_fill_deg) {
        const fill = o.obj(`SPOKE_${sp.k}_hero_ground`, "spokes");
        const quads = (o.heroFill = []), wquads = (o.heroWater = []);
        for (const ring of plan.scene.rings) {
          const wet = ring.kind === "water";
          if (wet && (S.hero_skip_crossings || []).includes(ring.id)) continue;  // the kit's own water is there
          // stop where even the corridor-edge corner would leave the ring
          const t0 = Math.max(ring.r0 + 0.05, S.r_inner), t1 = Math.min(Math.sqrt(Math.max(0, (ring.r1 - 0.05) ** 2 - S.corridor_half ** 2)), S.r_outer);
          for (let ta = t0; ta < t1 - 1e-6; ta += 10) {
            const tb = Math.min(t1, ta + 10);
            // wedge half-width, kept on this ring so the fill never overhangs the next canal
            const wOf = (t) => Math.max(S.corridor_half, Math.min(t * Math.tan(rad(S.hero_fill_deg)) + 12, Math.sqrt(Math.max(0, (ring.r1 - 0.05) ** 2 - t * t))));
            // the first strip of a ring starts on the ring's inner circle, not on the straight line t = r0
            const tIn = (w) => (ta === t0 ? Math.max(S.r_inner, Math.sqrt(Math.max(0, (ring.r0 + 0.05) ** 2 - w * w))) : ta);
            for (const side of [-1, 1]) {
              const pts = [spokePt(sp, tIn(S.corridor_half), side * S.corridor_half), spokePt(sp, tb, side * S.corridor_half), spokePt(sp, tb, side * wOf(tb)), spokePt(sp, tIn(wOf(ta)), side * wOf(ta))];
              if (side < 0) pts.reverse();
              // water rings get a water surface at the canal's level; land follows the ground
              const top = pts.map(([x, y]) => [x, y, wet ? ter.water[ring.id] : ter.G(Math.hypot(x, y)) - 0.03]);
              o.solid(fill, top, top.map((p) => p[2] - (wet ? 0.3 : 1.2)), wet ? "water" : "paver");
              (wet ? wquads : quads).push(pts);
            }
          }
        }
      }
      // verge trees on the new spokes (the hero avenue keeps its own planting)
      if (!sp.hero) {
        for (const side of [-1, 1]) {
          for (let t = S.r_inner + 6; t < S.r_outer - 4; t += S.tree_spacing) {
            if (ter.isWater(t) || !inRanges(t, t) || o.avenues.some((av) => Math.abs(t - av.r) < av.w / 2 + 3)) continue;
            const R = rng(`spoke${sp.k}|${side}|${Math.round(t)}`);
            const [x, y] = spokePt(sp, t + R.uniform(-1.5, 1.5), side * (S.road_half + S.verge / 2));
            tree(o, ter, "spokes", R.choice(species), x, y, R, `SPOKE_${sp.k}_tree_${side > 0 ? "L" : "R"}_${String(Math.round(t)).padStart(4, "0")}`, 0.85, 1.2, prof.road(t) + 0.12);
          }
        }
      }
      o.spokes.push(info);
    }
  }
  function subtract(ranges, cuts) {
    let out = ranges.map((r) => [...r]);
    for (const [c0, c1] of cuts || []) out = out.flatMap(([a, b]) => (c1 <= a || c0 >= b ? [[a, b]] : [[a, Math.min(b, c0)], [Math.max(a, c1), b]].filter(([x, y]) => y - x > 0.5)));
    return out;
  }

  // ---------------------------------------------------------------- entry
  function generate(plan, opts = {}) {
    const o = Out(!!opts.solids), ter = makeTerrain(plan), prof = makeProfile(plan, ter), spokes = spokeAngles(plan);
    o.spokeListRef = spokes;
    o.nb = makeNeighbourhoods(plan);
    for (const d of plan.districts) {
      if (d.enabled === false) continue;
      if (d.type === "perimeter") genPerimeter(plan, d, ter, spokes, o);
      else if (d.type === "campus") genCampus(plan, d, ter, spokes, o);
      else if (d.type === "towers") genTowers(plan, d, ter, spokes, o);
    }
    if (o.nb) for (const l of o.lots) if (!l.nb && o.nb.fixedRing.has(plan.districts.find((d) => d.id === l.d)?.ring)) {
      const [cx, cy] = centroid(l.poly), s = o.nb.assign(cx, cy, plan.districts.find((d) => d.id === l.d).ring);
      if (s) { l.nb = s.id; s.cells++; s.sx += cx; s.sy += cy; (s.rings || (s.rings = new Set())).add(s.ring); }
    }
    genRingAvenues(plan, ter, spokes, o);
    genSkywalks(plan, ter, spokes, o);
    o.neighbourhoods = o.nb ? o.nb.seeds.filter((s) => s.cells > 0).map((s) => ({ id: s.id, name: s.name, auto: s.auto, type: s.type, ring: s.ring, d: s.d, rings: [...(s.rings || [])], cells: s.cells, x: s.sx / s.cells, y: s.sy / s.cells })) : [];
    genSpokes(plan, ter, spokes, o);
    o.terrain = ter; o.profile = prof; o.spokeList = spokes;
    // checks the plan page shows
    const S = plan.spokes;
    if (S.grade < 0.02 || S.grade > 0.1) o.warnings.push(`Road grade ${Math.round(S.grade * 1000) / 10}% is outside 2–10%.`);
    for (const c of prof.crossings) {
      const step = prof.road(c.ri - 0.01) - ter.G(c.ri - 0.01);
      if (step > S.step_threshold) o.warnings.push(`At this road grade the ${c.id.replace("_", " ")} bridge lands ${Math.round(step * 10) / 10} m above the inner bank; raise the grade.`);
    }
    const hero = spokes.find((s) => s.hero);
    const hp = hero && makeProfile(plan, ter, S.hero_skip_crossings);
    if (hp) for (const [c0, c1] of S.hero_kit_ranges || []) hp.rampEnd.forEach((t, i) => { if (t > c0 && t < c1) o.warnings.push(`The ${hp.crossings[i].id.replace("_", " ")} approach ramp runs into the existing hero-avenue kit (ramp starts ${Math.round(t)} m from the centre).`); });
    return o;
  }

  return { generate, rng, makeTerrain, makeProfile, spokeAngles, ringLayout, cloud, cloudMul, USES, RECIPE_USES, SOUTH, NORTH, TAU, rad, angDist };
})();
if (typeof module !== "undefined") module.exports = CityGen;
