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
    const o = { lots: [], trees: [], rills: [], spokes: [], objects: [], instances: [], bands: {}, warnings: [], heroFill: [], heroWater: [], avenues: [], squares: [], quarters: [], cells: [], canals: [], canalLines: [], parks: [], basins: [], tanks: [], skywalks: [], skyAccess: [], boats: [], canalBridges: [], cellEdges: [], canalCuts: [], solar: [], blimps: [], noPlant: [] };
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

  // ---------------------------------------------------------------- Old Town settings
  // Every field has a default, because the planner's saved plan can predate any of them.
  const OLD_TOWN_DEFAULTS = {
    grid: { block: 46, street: 12, square: 100, forms: {} },
    quarters: { count: 15, block: [30, 46], seed: 1, cultures: [], weights: {} },
    heights: { grid: [120, 220], band: [200, 300], landmark: [25, 80] },
    lantern: { height: 500, base: 60, taper: 0.82, heart: [0.4, 0.8], clearance: 60 },
    landmarks: { embassies: 6, guild_halls: 6 },
    second_avenue: false,
    quay: 12,
  };
  function oldTownConfig(d) {
    const merge = (def, src) => {
      if (Array.isArray(def)) return Array.isArray(src) ? src.slice() : def.slice();
      if (def && typeof def === "object") {
        const s = src && typeof src === "object" && !Array.isArray(src) ? src : {}, out = {};
        for (const k of new Set([...Object.keys(def), ...Object.keys(s)])) out[k] = k in def ? (k in s ? merge(def[k], s[k]) : merge(def[k], undefined)) : s[k];
        return out;
      }
      return src === undefined || src === null ? def : src;
    };
    const c = merge(OLD_TOWN_DEFAULTS, d || {}), D = OLD_TOWN_DEFAULTS;
    // Normalise what the planner can push out of shape: ranges must be two finite numbers (else the
    // default) and come out as [lo, hi]; the Lantern's numbers must be finite and in range.
    const fin = (x) => (typeof x === "number" || (typeof x === "string" && x.trim() !== "")) && Number.isFinite(+x);
    const range = (v, def, min = 0) => (Array.isArray(v) && v.length === 2 && v.every(fin)
      ? [Math.max(min, Math.min(+v[0], +v[1])), Math.max(min, +v[0], +v[1])] : def.slice());
    const num = (v, def, ok) => (fin(v) && ok(+v) ? +v : def);
    for (const k of Object.keys(D.heights)) c.heights[k] = range(c.heights[k], D.heights[k]);
    c.quarters.block = range(c.quarters.block, D.quarters.block, 1);
    const L = c.lantern, LD = D.lantern;
    L.height = num(L.height, LD.height, (x) => x > 0);
    L.base = num(L.base, LD.base, (x) => x > 0);
    L.taper = num(L.taper, LD.taper, (x) => x > 0 && x <= 1);
    L.clearance = num(L.clearance, LD.clearance, (x) => x >= 0);
    // the heart sits between 5 % and 90 % of the height, so it stays below the crown (92 %), at least 5 % tall
    const [h0, h1] = range(L.heart, LD.heart), lo = clamp(h0, 0.05, 0.85);
    L.heart = [lo, clamp(h1, lo + 0.05, 0.9)];
    return c;
  }

  // Old Town tower massing per culture type (neighbourhoods.types[].style.tower):
  //   podium [lo, hi] storeys, tiers 1–5, taper 0–0.5, plan rect|round|stepped|twin,
  //   crown flat|needle|fins|lantern|garden
  // plan.json carries the same values; these cover a store doc that predates them.
  const TOWER_DEFAULT = { podium: [2, 5], tiers: 3, taper: 0.3, plan: "rect", crown: "flat" };
  const TOWER_BY_TYPE = {
    harbourside: { podium: [3, 5], tiers: 2, taper: 0.2, plan: "rect", crown: "fins" },
    market: { podium: [4, 6], tiers: 4, taper: 0.35, plan: "stepped", crown: "needle" },
    gardens: { podium: [2, 4], tiers: 3, taper: 0.25, plan: "twin", crown: "garden" },
    scholars: { podium: [3, 6], tiers: 3, taper: 0.3, plan: "round", crown: "lantern" },
    works: { podium: [2, 3], tiers: 1, taper: 0, plan: "rect", crown: "flat" },
    lantern: { podium: [4, 7], tiers: 5, taper: 0.45, plan: "round", crown: "needle" },
  };
  const nbTypes = (plan) => (plan.neighbourhoods && Array.isArray(plan.neighbourhoods.types) ? plan.neighbourhoods.types : []).filter((t) => t && t.id);
  const isRange = (a) => Array.isArray(a) && a.length === 2 && a.every((x) => Number.isFinite(+x));
  // a culture's building style for Old Town (an unknown or missing id gets the generic tower)
  function cultureStyle(plan, id) {
    const t = nbTypes(plan).find((x) => x.id === id), st = (t && t.style) || {};
    const T = { ...TOWER_DEFAULT, ...(TOWER_BY_TYPE[id] || {}), ...(st.tower && typeof st.tower === "object" ? st.tower : {}) };
    const pod = isRange(T.podium) ? T.podium.map((x) => Math.max(0, Math.round(+x))) : TOWER_DEFAULT.podium;
    T.podium = [Math.min(...pod), Math.max(...pod)];
    T.tiers = clamp(Math.round(+T.tiers) || 1, 1, 5);
    T.taper = clamp(+T.taper || 0, 0, 0.5);
    const gap = isRange(st.gap) ? st.gap.map(Number) : [0, 0];
    return { tower: T, roofs: st.roofs || {}, lot: isRange(st.lot) ? st.lot.map(Number) : null, gap: [Math.min(...gap), Math.max(...gap)], setback: Math.max(0, +st.setback || 0), storey: plan.storey || 4.3 };
  }
  // a seeded type id: weighted over `weights` (known ids with weight > 0), else uniform over the types
  function pickType(plan, weights, R) {
    const ids = nbTypes(plan).map((t) => t.id);
    if (!ids.length) return null;
    const w = ids.map((id) => Math.max(0, +(weights || {})[id] || 0)), tot = w.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) return R.choice(ids);
    let t = R.random() * tot;
    for (let i = 0; i < ids.length; i++) { t -= w[i]; if (t <= 0 && w[i] > 0) return ids[i]; }
    for (let i = ids.length - 1; i >= 0; i--) if (w[i] > 0) return ids[i];
    return ids[0];
  }
  // how far bearing a is from b's grid directions (b or b + 90°), in [0, 45°]
  const offGrid = (a, b) => { const q = TAU / 4, m = (((a - b) % q) + q) % q; return Math.min(m, q - m); };

  // ---------------------------------------------------------------- ring layout
  // Every ring carries two ring avenues; counted from the centre, the inner one runs clockwise and
  // the outer one anticlockwise. They split the ring into three bands that the districts fill.
  function ringLayout(plan, d) {
    const ring = plan.scene.rings.find((r) => r.id === d.ring), old = d.type === "oldtown", cfg = old ? oldTownConfig(d) : null;
    const inner = ring.r0 === 0 ? (old ? 0 : plan.scene.temple.r + (d.garden || 18)) : ring.r0 + (d.quay_in ?? 12);
    const outer = ring.r1 - (old ? cfg.quay : d.quay_out ?? 12);
    let avs = [...(d.avenues || [])].sort((a, b) => a.r - b.r);
    if (old && !cfg.second_avenue) avs = avs.slice(0, 1);
    const avenues = avs.map((a, i) => ({ ...a, dir: i % 2 === 0 ? "cw" : "ccw", idx: i }));
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
    for (let i = 0; i < p.length; i++) { const r = rectOnEdge(p, i); if (r && (!best || r.area > best.area)) best = r; }
    return best ? best.q : null;
  }
  // the biggest rectangle standing on edge i of a counter-clockwise convex polygon ({area, q} or null)
  function rectOnEdge(p, i) {
    const a = p[i], b = p[(i + 1) % p.length], L = dist(a, b);
    if (L < 4) return null;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux, c0 = nx * a[0] + ny * a[1];
    const maxT = Math.max(...p.map((v) => nx * v[0] + ny * v[1] - c0));
    let best = null;
    for (let k = 1; k <= 12; k++) {
      const t = maxT * k / 12, c1 = plotChord(p, ux, uy, nx, ny, c0 + 0.05), c2 = plotChord(p, ux, uy, nx, ny, c0 + t - 0.05);
      if (!c1 || !c2) continue;
      const lo = Math.max(c1[0], c2[0]), hi = Math.min(c1[1], c2[1]);
      if (hi - lo < 3) continue;
      const area = (hi - lo) * t;
      if (!best || area > best.area) best = { area, q: [[lo * ux + c0 * nx, lo * uy + c0 * ny], [hi * ux + c0 * nx, hi * uy + c0 * ny], [hi * ux + (c0 + t) * nx, hi * uy + (c0 + t) * ny], [lo * ux + (c0 + t) * nx, lo * uy + (c0 + t) * ny]] };
    }
    return best;
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

  // Old Town (the core district), built in a fixed order: ground and Lantern first, then (later tasks)
  // the grid and quarter blocks, landmarks, and towers on the blocks left over.
  // Old Town heights stay under the Lantern's heart top by `clearance` (absolute z).
  // The cap never drops below a podium (OLD_TOWN_FLOOR_STOREYS) above the square, even when the clearance
  // asks for more than the heart's height; generate() warns when that happens.
  const OLD_TOWN_FLOOR_STOREYS = 4;
  function oldTownCapInfo(plan, ter, d) {
    const L = oldTownConfig(d).lantern, ground = ter.G(0);
    const want = ground + L.height * L.heart[1] - L.clearance, floor = ground + OLD_TOWN_FLOOR_STOREYS * (plan.storey || 4.3);
    return { cap: Math.max(want, floor), want, floor, ground, heartTop: L.height * L.heart[1], clearance: L.clearance };
  }
  function oldTownCap(plan, ter, d) {
    return oldTownCapInfo(plan, ter, d).cap;
  }
  // a spoke corridor crossing the canal edge at angle a (the old centre quay wall's test)
  const edgeInSpoke = (plan, spokes, r1, a) => inCorridor(plan, spokes, ...polar(r1 - 2, a), 2)
    || spokes.some((sp) => angDist(sp.a, a) < Math.asin(Math.min(1, (plan.spokes.corridor_half + 2) / r1)));
  function genOldTown(plan, d, ter, spokes, o) {
    const cfg = oldTownConfig(d), L = ringLayout(plan, d), r1 = L.ring.r1, rq = r1 - cfg.quay;
    // ground: pavers following the terrain out to the quay, then the canal edge (quay walk + wall)
    const ob = o.obj(`NBHD_${d.id}_ground`, d.id), N = Math.ceil(TAU * r1 / 14);
    const gz = (r) => ter.G(Math.min(r, r1 - 0.01));
    const pr = plan.scene.terrain.plateau_r, breaks = [0, ...(pr > 0 && pr < rq ? [pr] : []), rq];
    // the wall's coping sits 0.35 m above the quay, flush like the other ring canals' banks and the
    // gracht walls: no parapet, so the edge reads as a canal quay rather than a rampart
    const wz = ter.water.inner_water - 0.5, wtop = gz(r1 - 0.5) + 0.35;
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N, b = (i + 1) * TAU / N;
      const pave = (ra, rb) => {
        const top = ra === 0 ? [[0, 0, gz(0)], [...polar(rb, a), gz(rb)], [...polar(rb, b), gz(rb)]]
          : [[...polar(ra, a), gz(ra)], [...polar(rb, a), gz(rb)], [...polar(rb, b), gz(rb)], [...polar(ra, b), gz(ra)]];
        o.solid(ob, top, top.map((q) => q[2] - 1.0), "paver");
      };
      for (let k = 0; k + 1 < breaks.length; k++) pave(breaks[k], breaks[k + 1]);
      if (edgeInSpoke(plan, spokes, r1, (a + b) / 2)) continue;
      pave(rq, r1);
      o.prism(ob, [polar(r1 - 1.2, a), polar(r1, a), polar(r1, b), polar(r1 - 1.2, b)], wz, wtop, "stone");
    }
    genLantern(plan, d, ter, o, cfg, spokes);
    // collect the blocks (layout only): the grid inside the first ring avenue, the quarters beyond it
    const grid = oldTownGrid(plan, d, spokes.find((sp) => sp.hero));
    o.lantern.square = grid.square;
    o.squares.push(grid.square);
    const qs = oldTownQuarters(plan, d, spokes);
    o.quarters = qs.quarters.map(({ k, culture, poly, angle, a0, a1, block }) => ({ k, culture, poly, angle, a0, a1, block }));
    const blocks = [...grid.blocks, ...qs.blocks];
    // then the landmarks claim their blocks, and towers go on every other block
    const assigns = oldTownLandmarks(plan, d, blocks, grid.square, spokes.find((sp) => sp.hero));
    const claimed = new Set(assigns.flatMap((a) => a.keys)), rest = blocks.filter((b) => !claimed.has(b.key));
    buildLandmarks(plan, d, ter, o, cfg, assigns);
    buildGridLots(plan, d, ter, o, cfg, rest.filter((b) => b.zone === "grid"), grid.gridR);
    buildBandLots(plan, d, ter, o, cfg, rest.filter((b) => b.zone === "band"), qs.r0, qs.r1);
  }

  // Old Town's central grid, Manhattan style, aligned to the hero bearing (u along it, v across it).
  // Street centrelines sit at k·pitch, so the k = 0 street is the hero avenue's line into the centre;
  // block centres sit at (k + 0.5)·pitch. The square snaps outward to whole street lines (half-size
  // n·pitch) and holds no block. Blocks are clipped to the disc inside the first ring avenue (a 48-gon),
  // trimmed and never dropped; a piece under 300 m² is a fragment. Each block's polygon is
  // counter-clockwise and starts at its corner nearest the centre, so its first edge lies on a street.
  // Layout only: genOldTown builds on the blocks.
  function oldTownGrid(plan, d, hero) {
    const G = oldTownConfig(d).grid, L = ringLayout(plan, d), av = L.avenues[0];
    const ha = typeof hero === "number" ? hero : hero ? hero.a : SOUTH, ux = Math.cos(ha), uy = Math.sin(ha);
    const at = (u, v) => [u * ux - v * uy, u * uy + v * ux];
    const pitch = G.block + G.street, h = G.block / 2, n = Math.ceil(G.square / 2 / pitch), sh = n * pitch;
    const gridR = av ? av.r - av.w / 2 - 2 : L.bands[0].r1 - 2, NG = 48, rim = gridR * Math.cos(Math.PI / NG);
    const sides = Array.from({ length: NG }, (_, k) => { const m = ha + (k + 0.5) * TAU / NG; return [Math.cos(m), Math.sin(m)]; });
    const K = Math.ceil(gridR / pitch) + 1, blocks = [];
    for (let i = -K; i < K; i++) for (let j = -K; j < K; j++) {
      if (i >= -n && i < n && j >= -n && j < n) continue;  // the square
      const cu = (i + 0.5) * pitch, cv = (j + 0.5) * pitch, su = Math.sign(cu), sv = Math.sign(cv);
      if (Math.hypot(Math.abs(cu) - h, Math.abs(cv) - h) >= gridR) continue;  // nearest corner off the disc
      // counter-clockwise from the corner nearest the centre
      const uvs = [[-h, -h], [h, -h], [h, h], [-h, h]], k0 = uvs.findIndex(([du, dv]) => Math.sign(du) === -su && Math.sign(dv) === -sv);
      let poly = [0, 1, 2, 3].map((t) => { const [du, dv] = uvs[(k0 + t) % 4]; return at(cu + du, cv + dv); });
      if (poly.some(([x, y]) => Math.hypot(x, y) > rim)) {
        for (const [a, b] of sides) poly = clipHalf(poly, a, b, rim);
        poly = dedupe(poly);
      }
      const area = poly.length >= 3 ? polyArea(poly) : 0;
      if (area < 0.5) continue;
      blocks.push({ key: `${d.id}|g|${i}|${j}`, i, j, poly, zone: "grid", fragment: area < 300 });
    }
    const square = [[-sh, -sh], [sh, -sh], [sh, sh], [-sh, sh]].map(([u, v]) => at(u, v));
    return { blocks, square, gridR, pitch, axis: ha };
  }

  // Old Town's outer band, from the first ring avenue to the quay, as patchwork quarters: count slices whose
  // boundaries include every spoke bearing (the rest spread evenly, jittered ±25 %). Each quarter takes a
  // culture, and lays its own street grid at its own angle (never within 12° of radial or ring-following)
  // with blocks sized from the culture's lot range. Blocks are clipped clear of the spoke corridors
  // (blockHalf + 2), half a street off the other seams, 2 m off the avenue and the quay, and with the second
  // avenue on, 2 m off that too. Layout only: genOldTown builds on the blocks.
  const QUARTER_STREET = 10;
  // the biggest rectangle standing on any edge of a convex polygon that runs along axis (or square to it)
  function alignedRect(poly, axis) {
    const p = dedupe(signedArea(poly) < 0 ? [...poly].reverse() : poly);
    let best = null;
    for (let e = 0; e < p.length; e++) {
      const a = p[e], b = p[(e + 1) % p.length];
      if (offGrid(Math.atan2(b[1] - a[1], b[0] - a[0]), axis) >= rad(0.5)) continue;
      const r = rectOnEdge(p, e);
      if (r && (!best || r.area > best.area)) best = r;
    }
    return best;
  }
  function oldTownQuarters(plan, d, spokes) {
    const cfg = oldTownConfig(d), Q = cfg.quarters, L = ringLayout(plan, d), av = L.avenues[0];
    const r0 = av ? av.r + av.w / 2 : 0, r1 = L.ring.r1 - cfg.quay, out = { quarters: [], blocks: [], r0, r1 };
    const rin = r0 + 2, rim = r1 - 2, NG = 96;
    if (!av || !(rim - rin > 20)) return out;
    const av2 = cfg.second_avenue ? L.avenues[1] : null, seed = Q.seed ?? 1, key = (...p) => [d.id, "q", seed, ...p].join("|");
    // boundaries, as bearings relative to the first spoke
    const norm = (a) => ((a % TAU) + TAU) % TAU, base = spokes.length ? spokes[0].a : SOUTH;
    const fixed = spokes.length ? spokes.map((sp) => ({ rel: norm(sp.a - base), sp })).sort((a, b) => a.rel - b.rel) : [{ rel: 0, sp: null }];
    const count = clamp(Math.max(fixed.length, Math.round(+Q.count) || OLD_TOWN_DEFAULTS.quarters.count), 1, 64);
    const width = fixed.map((f, j) => (j + 1 < fixed.length ? fixed[j + 1].rel : TAU) - f.rel), m = fixed.map(() => 0);
    const TB = rng(key("alloc")), tb = fixed.map(() => TB.random() * 1e-6);
    for (let e = fixed.length; e < count; e++) {
      let best = 0;
      for (let j = 1; j < fixed.length; j++) if (width[j] / (m[j] + 1) + tb[j] > width[best] / (m[best] + 1) + tb[best]) best = j;
      m[best]++;
    }
    const bounds = [];
    fixed.forEach((f, j) => {
      bounds.push({ a: base + f.rel, sp: f.sp });
      const sub = width[j] / (m[j] + 1);
      for (let i = 1; i <= m[j]; i++) bounds.push({ a: base + f.rel + sub * i + rng(key(bounds.length)).uniform(-0.25, 0.25) * sub, sp: null });
    });
    // the city-wide lot span, rescaled into the quarter block range
    const lots = nbTypes(plan).map((t) => t.style && t.style.lot).filter(isRange).map((l) => l.map(Number));
    const lo = lots.length ? Math.min(...lots.map((l) => Math.min(...l))) : 8, hi = lots.length ? Math.max(...lots.map((l) => Math.max(...l))) : 40;
    const qb = isRange(Q.block) ? [Math.min(...Q.block), Math.max(...Q.block)].map(Number) : OLD_TOWN_DEFAULTS.quarters.block;
    const toBlock = (x) => (hi > lo ? qb[0] + (clamp(x, lo, hi) - lo) / (hi - lo) * (qb[1] - qb[0]) : (qb[0] + qb[1]) / 2);
    const ids = nbTypes(plan).map((t) => t.id);
    const ringClip = (poly, lim) => { for (let s = 0; s < NG; s++) { const a = (s + 0.5) * TAU / NG; poly = clipHalf(poly, Math.cos(a), Math.sin(a), lim * Math.cos(Math.PI / NG)); if (poly.length < 3) break; } return poly; };
    bounds.forEach((b0, k) => {
      const b1 = bounds[(k + 1) % bounds.length], a0 = b0.a, a1 = k + 1 < bounds.length ? b1.a : bounds[0].a + TAU, mid = (a0 + a1) / 2;
      const want = Array.isArray(Q.cultures) ? Q.cultures[k] : undefined;
      const culture = ids.includes(want) ? want : pickType(plan, Q.weights, rng(key(k, "culture")));
      // the grid's turn: uniform over [0°, 90°), redrawn when it would read radial or ring-following
      const RA = rng(key(k, "angle"));
      let angle = null;
      for (let t = 0; t < 64 && angle === null; t++) { const x = RA.uniform(0, TAU / 4); if (offGrid(x, mid) >= rad(12)) angle = x; }
      if (angle === null) angle = norm(mid + TAU / 8) % (TAU / 4);
      const RB = rng(key(k, "block")), cl = cultureStyle(plan, culture).lot || [lo, hi];
      const cs = cultureStyle(plan, culture), maxInset = cs.setback + cs.gap[1] / 2;
      const block = RB.uniform(toBlock(Math.min(...cl)), toBlock(Math.max(...cl))), pitch = block + QUARTER_STREET;
      const ux = Math.cos(angle), uy = Math.sin(angle), at = (u, v) => [u * ux - v * uy, u * uy + v * ux];
      const n = Math.max(2, Math.ceil((a1 - a0) / rad(3)));
      const arc = (r, rev) => Array.from({ length: n + 1 }, (_, i) => polar(r, lerp(a0, a1, rev ? 1 - i / n : i / n)));
      const poly = [...arc(r1, false), ...arc(r0, true)];
      out.quarters.push({ k, a0, a1, angle, block, culture, poly });
      // the lattice, offset by seed, over the quarter's extent in its own frame
      const us = poly.map(([x, y]) => x * ux + y * uy), vs = poly.map(([x, y]) => -x * uy + y * ux), ou = RB.uniform(0, pitch), ov = RB.uniform(0, pitch);
      const h0 = b0.sp ? blockHalf(plan, b0.sp) + 2 : QUARTER_STREET / 2, h1 = b1.sp ? blockHalf(plan, b1.sp) + 2 : QUARTER_STREET / 2;
      let nb = 0;
      for (let i = Math.floor((Math.min(...us) - ou) / pitch) - 1; i <= Math.ceil((Math.max(...us) - ou) / pitch); i++)
        for (let j = Math.floor((Math.min(...vs) - ov) / pitch) - 1; j <= Math.ceil((Math.max(...vs) - ov) / pitch); j++) {
          const u0 = ou + i * pitch, v0 = ov + j * pitch;
          let p = [at(u0, v0), at(u0 + block, v0), at(u0 + block, v0 + block), at(u0, v0 + block)];
          p = clipHalf(p, Math.sin(a0), -Math.cos(a0), -h0);
          if (p.length >= 3) p = clipHalf(p, -Math.sin(a1), Math.cos(a1), -h1);
          if (p.length < 3) continue;
          const c = centroid(p), rc = Math.hypot(c[0], c[1]);
          if (!(rc > 1)) continue;
          // the inner edge: a tangent cut at the block's bearing (the avenue side), the outer: the quay rim
          const outer = av2 && rc < av2.r ? av2.r - av2.w / 2 - 2 : rim, inner = av2 && rc >= av2.r ? av2.r + av2.w / 2 + 2 : rin;
          p = clipHalf(p, -c[0] / rc, -c[1] / rc, -inner);
          if (p.length >= 3) p = ringClip(p, outer);
          if (p.length < 3) continue;
          p = dedupe(p);
          const area = p.length >= 3 ? polyArea(p) : 0;
          if (area < 40) continue;
          // a piece too small for a tower once the culture's podium inset is taken off is a fragment
          const ar = alignedRect(p, angle), side = ar ? Math.min(dist(ar.q[0], ar.q[1]), dist(ar.q[1], ar.q[2])) : 0;
          out.blocks.push({ key: `${d.id}|q|${k}|${nb}`, n: nb, i, j, poly: p, zone: "band", quarter: k, culture, angle, fragment: area < 300 || side < 14 + 2 * maxInset });
          nb++;
        }
    });
    return out;
  }

  // A fragment's plaza: paving, or a podium of one or two storeys.
  function plazaLot(plan, ter, o, ob, poly, R) {
    const storeys = R.randint(0, 2);
    if (storeys) { const { base, top } = building(o, ob, ter, poly, storeys * plan.storey, "plaza"); return { base, top, storeys }; }
    const pts = poly.map(([x, y]) => [x, y, ter.G(Math.hypot(x, y)) + 0.12]);
    o.solid(ob, pts, pts.map((q) => q[2] - 0.42), "paver");
    return { base: Math.min(...pts.map((q) => q[2])), top: Math.max(...pts.map((q) => q[2])), storeys };
  }
  // the lot record of an Old Town tower
  const towerLot = (plan, t) => ({ tower: t.tower, crown: t.crown, base: t.base, top: t.top, podiumTop: t.podiumTop, height: t.height, capped: t.capped, storeys: Math.round(t.height / plan.storey), plan: t.plan, crownKind: t.crownKind, podiumRoof: t.podiumRoof, terraces: t.terraces, roofs: t.roofs });

  // Grid lots on the blocks: a fragment becomes a plaza, every other block a tower lerped through
  // heights.grid, scaled by the cloud and kept under the cap. Each tower takes a culture's form from the
  // grid's form mix (grid.forms; empty spreads evenly over all the types), and that culture's roofs.
  function buildGridLots(plan, d, ter, o, cfg, blocks, gridR) {
    const cap = oldTownCap(plan, ter, d), hg = cfg.heights.grid, share = plan.cloud?.tower_share ?? 0.5;
    for (const b of blocks) {
      const R = rng(b.key), ob = o.obj(`NBHD_${d.id}_g_${b.i}_${b.j}`, d.id), area = polyArea(b.poly);
      if (b.fragment) {
        const { base, top, storeys } = plazaLot(plan, ter, o, ob, b.poly, R);
        o.lots.push({ d: d.id, zone: "grid", kind: "plaza", key: b.key, obj: ob.name, poly: b.poly, tower: null, crown: null, base, top, podiumTop: top, height: top - base, capped: false, storeys, area });
        continue;
      }
      const form = pickType(plan, cfg.grid.forms, rng(`${d.id}|g|form|${b.i}|${b.j}`));
      const [cx, cy] = centroid(b.poly);
      const H = lerp(hg[0], hg[1], R.random()) * cloudMul(plan, cx, cy, share);
      const t = oldTownTower(o, ob, ter, b.poly, H, cultureStyle(plan, form), R, cap);
      o.lots.push({ d: d.id, zone: "grid", key: b.key, obj: ob.name, form, poly: b.poly, ...towerLot(plan, t), area });
      o.band(`${d.id}|grid`, 0, gridR, t.base, t.top);
    }
  }

  // Band lots on the quarter blocks: towers through heights.band in the quarter's culture. The podium sits
  // in from the block by the culture's setback and half a gap from its range, so neighbouring podiums open up.
  function buildBandLots(plan, d, ter, o, cfg, blocks, r0, r1) {
    const cap = oldTownCap(plan, ter, d), hb = cfg.heights.band, share = plan.cloud?.tower_share ?? 0.5;
    for (const b of blocks) {
      const R = rng(b.key), ob = o.obj(`NBHD_${d.id}_q_${b.quarter}_${b.n}`, d.id), area = polyArea(b.poly);
      const lot = { d: d.id, zone: "band", key: b.key, obj: ob.name, quarter: b.quarter, culture: b.culture, form: b.culture, poly: b.poly };
      if (b.fragment) {
        const { base, top, storeys } = plazaLot(plan, ter, o, ob, b.poly, R);
        o.lots.push({ ...lot, kind: "plaza", tower: null, crown: null, base, top, podiumTop: top, height: top - base, capped: false, storeys, area });
        continue;
      }
      const st = cultureStyle(plan, b.culture), style = { ...st, inset: st.setback + R.uniform(st.gap[0], st.gap[1]) / 2, axis: b.angle };
      const [cx, cy] = centroid(b.poly);
      const H = lerp(hb[0], hb[1], R.random()) * cloudMul(plan, cx, cy, share);
      const t = oldTownTower(o, ob, ter, b.poly, H, style, R, cap);
      o.lots.push({ ...lot, ...towerLot(plan, t), area });
      o.band(`${d.id}|band`, r0, r1, t.base, t.top);
    }
  }

  // ---------------------------------------------------------------- Old Town landmarks
  // Civic buildings on their own blocks, lower and broader than the towers. oldTownLandmarks assigns kinds
  // to block keys (layout only); buildLandmarks draws them. Each assignment also carries its lot polygon
  // (counter-clockwise) and `front`, the index of the edge its colonnade or forecourt faces.
  //   parliament  the two square-facing grid blocks either side of the hero axis on the far side of the
  //               square, merged across the axis street (which stops at it), so it closes the hero view
  //   exchange    beside the parliament on the square: the next block along the far edge when the square
  //               spans n ≥ 2 pitches, else the square-facing block on the hero + 90° side nearest the parliament
  //   courts      the square-facing block at hero − 90°
  //   embassy     landmarks.embassies quarter blocks, one per distinct quarter culture first
  //   guild       landmarks.guild_halls quarter blocks, spread over the quarters
  // Fragments are never claimed. A quarter block qualifies when a 6 m forecourt still leaves ≥ 80 % of it.
  const LANDMARK_DEPTH = [4, 6];  // colonnade or forecourt depth (m)
  const ccwPoly = (p) => (signedArea(p) < 0 ? [...p].reverse() : p);
  function convexHull(pts) {
    const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => { const h = []; for (const p of list) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop(); h.push(p); } h.pop(); return h; };
    return [...half(P), ...half([...P].reverse())];
  }
  // the edge of a ccw polygon whose outward normal points most along (dx, dy)
  const facingEdge = (p, dx, dy) => p.reduce((best, a, i) => {
    const b = p[(i + 1) % p.length], L = dist(a, b), s = L > 1 ? ((b[1] - a[1]) * dx - (b[0] - a[0]) * dy) / L : -Infinity;
    return s > best.s ? { i, s } : best;
  }, { i: 0, s: -Infinity }).i;
  const longestEdge = (p) => p.reduce((best, a, i) => (dist(a, p[(i + 1) % p.length]) > dist(p[best], p[(best + 1) % p.length]) ? i : best), 0);
  // a ccw convex polygon split along its front edge: the strip `depth` deep and the mass behind it.
  // (ex, ey) runs along the front edge from a, (nx, ny) points inward.
  function frontSplit(p, front, depth) {
    const a = p[front], b = p[(front + 1) % p.length], L = dist(a, b), ex = (b[0] - a[0]) / L, ey = (b[1] - a[1]) / L, nx = -ey, ny = ex, c = nx * a[0] + ny * a[1] + depth;
    return { strip: dedupe(clipHalf(p, nx, ny, c)), mass: dedupe(clipHalf(p, -nx, -ny, -c)), a, ex, ey, nx, ny };
  }
  function oldTownLandmarks(plan, d, blocks, square, hero, R) {
    const cfg = oldTownConfig(d), G = cfg.grid, LM = cfg.landmarks, out = [], used = new Set();
    R = R || rng(`${d.id}|lm|assign`);
    const ha = typeof hero === "number" ? hero : hero ? hero.a : SOUTH, ux = Math.cos(ha), uy = Math.sin(ha);
    const byKey = new Map(blocks.map((b) => [b.key, b])), free = (b) => b && !b.fragment && !used.has(b.key);
    const claim = (kind, label, bs, poly, front, culture = null) => { for (const b of bs) used.add(b.key); out.push({ kind, label, keys: bs.map((b) => b.key), culture, poly, front }); };
    const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // the grid's civic blocks by grid index (i along the hero bearing, j across it); the square spans [-n, n)
    const pitch = G.block + G.street, half = Math.max(...square.map(([x, y]) => Math.abs(x * ux + y * uy))), n = Math.max(1, Math.round(half / pitch));
    const gb = (i, j) => byKey.get(`${d.id}|g|${i}|${j}`);
    // the far side faces the square along +u (towards the hero avenue), the hero − 90° side along +v
    const civic = (kind, label, bs, dx, dy) => {
      const poly = bs.length > 1 ? convexHull(bs.flatMap((b) => b.poly)) : ccwPoly(bs[0].poly);
      claim(kind, label, bs, poly, facingEdge(poly, dx, dy));
    };
    const pair = [gb(-n - 1, -1), gb(-n - 1, 0)].filter(free);
    if (pair.length) civic("parliament", "Parliament", pair, ux, uy);
    // the exchange faces the square too: beside the parliament on the far edge when that edge has room
    // (n ≥ 2), else on the hero + 90° side, in the block nearest the parliament (mirroring the courts)
    // (the far-edge order is drawn either way, so the quarter picks after it don't shift with n)
    const farOrder = shuffle([gb(-n - 1, 1), gb(-n - 1, -2)]), exFar = n >= 2 ? farOrder.find(free) : null, exSide = exFar ? null : gb(-1, n);
    if (exFar) civic("exchange", "Exchange", [exFar], ux, uy);
    else if (free(exSide)) civic("exchange", "Exchange", [exSide], uy, -ux);
    const ct = shuffle([gb(0, -n - 1), gb(-1, -n - 1)]).find(free);
    if (ct) civic("courts", "Courts", [ct], -uy, ux);
    // the quarters' candidate blocks, by quarter
    const typeLabel = (id) => (nbTypes(plan).find((t) => t.id === id) || {}).label || id;
    const fits = (b) => { if (b.zone !== "band" || b.fragment || b.culture == null) return false;
      const p = ccwPoly(b.poly); return polyArea(frontSplit(p, longestEdge(p), LANDMARK_DEPTH[1]).mass) >= 0.8 * polyArea(p); };
    const byQ = new Map();
    for (const b of blocks) if (fits(b)) { if (!byQ.has(b.quarter)) byQ.set(b.quarter, []); byQ.get(b.quarter).push(b); }
    const qOrder = shuffle([...byQ.keys()].sort((a, b) => a - b)), load = new Map(qOrder.map((q) => [q, 0]));
    // in the least-used of these quarters (seeded order breaks ties) that has a free candidate, a seeded block
    const take = (kind, quarters, label) => {
      const qs = quarters.filter((q) => byQ.get(q).some(free));
      if (!qs.length) return false;
      const q = qs.reduce((a, b) => (load.get(b) < load.get(a) ? b : a)), list = byQ.get(q).filter(free), b = list[Math.floor(R.random() * list.length)];
      const poly = ccwPoly(b.poly);
      claim(kind, label(b.culture), [b], poly, longestEdge(poly), b.culture);
      load.set(q, load.get(q) + 1);
      return true;
    };
    const nE = Math.max(0, Math.round(+LM.embassies) || 0), nG = Math.max(0, Math.round(+LM.guild_halls) || 0);
    // embassies cycle through the cultures in a seeded order, so every culture gets one before any gets two
    const cultures = shuffle([...new Set(qOrder.map((q) => byQ.get(q)[0].culture))].sort());
    for (let e = 0, k = 0, miss = 0; e < nE && cultures.length && miss < cultures.length; k++) {
      const c = cultures[k % cultures.length];
      if (take("embassy", qOrder.filter((q) => byQ.get(q)[0].culture === c), (id) => `${typeLabel(id)} embassy`)) { e++; miss = 0; } else miss++;
    }
    for (let g = 0; g < nG; g++) if (!take("guild", qOrder, (id) => `${typeLabel(id)} guild hall`)) break;
    return out;
  }

  // the highest z a prim reaches
  const primZ = (p) => (p.t === "prism" ? p.z1 : p.t === "solid" ? Math.max(...p.top.map((q) => q[2])) : Math.max(...p.rings.flat().map((q) => q[2])));
  // A landmark on its lot: one broad mass behind a colonnade (civic) or a walled forecourt (embassies, guild
  // halls) 4–6 m deep along the front edge, its eave through heights.landmark. The parliament adds a domed
  // drum, the exchange a glazed drum, the courts a raised attic; embassies and guild halls roof in their
  // culture's mix. Everything above the eave stays within 20 m of it and under the cap. Colonnade and
  // forecourt prims carry `part`.
  function buildLandmarks(plan, d, ter, o, cfg, assigns) {
    const cap = oldTownCap(plan, ter, d), [lo, hi] = cfg.heights.landmark, count = {};
    const tag = (ob, part, from) => { for (let i = from; i < ob.prims.length; i++) ob.prims[i].part = part; };
    // draw into a recorder first (so the plan page, without solids, gets the same top), then trim and keep
    const rec = { ...o, prism: (b, poly, z0, z1, m) => { if (z1 > z0 + 1e-3) b.prims.push({ t: "prism", poly, z0, z1, m }); },
      solid: (b, top, bot, m) => b.prims.push({ t: "solid", top, bot, m }), loft: (b, rings, m) => b.prims.push({ t: "loft", rings, m }) };
    const ring = (cx, cy, r, z, n = 24) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos((k + 0.5) * TAU / n), cy + r * Math.sin((k + 0.5) * TAU / n), z]);
    for (const a of assigns) {
      const n = count[a.kind] = (count[a.kind] ?? -1) + 1;
      const R = rng(`${d.id}|lm|${a.kind}|${n}`), real = o.obj(`NBHD_${d.id}_lm_${a.kind}_${n}`, d.id), solids = o.objects.includes(real);
      const ob = { name: real.name, coll: real.coll, props: {}, prims: [] }, poly = a.poly;
      const zs = poly.map(([x, y]) => ter.G(Math.hypot(x, y))), zmax = Math.max(...zs), zmin = Math.min(...zs), base = zmax + 0.05;
      const eave = Math.min(base + lerp(lo, hi, R.random()), cap - 1.3), above = Math.min(20, cap - eave), roofZ = eave + 0.9;
      const { strip, mass, a: fa, ex, ey, nx, ny } = frontSplit(poly, a.front, R.uniform(LANDMARK_DEPTH[0], LANDMARK_DEPTH[1]));
      if (zmax - zmin > 0.1) rec.prism(ob, poly, zmin - 0.3, base, "plinth");
      // the front: a colonnade under an entablature, or a paved forecourt behind a low wall and gateposts
      const at = (s, t) => [fa[0] + ex * s + nx * t, fa[1] + ey * s + ny * t], box = (s0, s1, t0, t1) => [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
      // s runs along the front edge, 1 m in from its ends; t back from it
      const s0 = 1, s1 = dist(poly[a.front], poly[(a.front + 1) % poly.length]) - 1, p0 = ob.prims.length;
      rec.prism(ob, strip, base - 0.3, base + 0.15, "paver");
      if (a.kind === "parliament" || a.kind === "exchange" || a.kind === "courts") {
        const nc = Math.max(2, Math.floor((s1 - s0 - 1) / 4.5) + 1), w = 0.7;
        for (let k = 0; k < nc; k++) { const s = lerp(s0 + 0.5, s1 - 0.5, k / (nc - 1)); rec.prism(ob, box(s - w, s + w, 1, 1 + 2 * w), base + 0.15, eave - 1.6, "stone"); }
        rec.prism(ob, strip, eave - 1.6, roofZ, "lip");
        tag(ob, "colonnade", p0);
      } else {
        const gate = lerp(s0, s1, R.uniform(0.3, 0.7)), gw = 3;
        for (const [w0, w1] of [[s0, gate - gw], [gate + gw, s1]]) if (w1 - w0 > 1) rec.prism(ob, box(w0, w1, 0.2, 0.8), base + 0.15, base + 1.4, "stone");
        for (const s of [gate - gw, gate + gw]) rec.prism(ob, box(s - 0.6, s + 0.6, 0, 1.2), base + 0.15, base + 3.5, "stone");
        tag(ob, "forecourt", p0);
      }
      // the mass and its parapet
      rec.prism(ob, mass, base - (zmax - zmin > 0.1 ? 0 : 0.3), eave, "stone");
      rec.prism(ob, inset(mass, -0.35), eave, roofZ, "lip");
      const [cx, cy] = centroid(mass), side = Math.sqrt(polyArea(mass)), roofs = [];
      if (a.kind === "parliament" || a.kind === "exchange") {
        // a drum, then a dome (parliament) or a shallow glazed cap (exchange), with a finial, all within `above`
        rec.prism(ob, inset(mass, 1.4), roofZ, roofZ + 0.4, "roof");
        const dome = a.kind === "parliament", rd = clamp(side * 0.25, 5, 11);
        const hd = dome ? clamp(above * 0.3, 2, 6) : clamp(above * 0.45, 2, 9), z1 = roofZ + hd;
        const rise = Math.max(0.5, Math.min(dome ? rd : rd * 0.35, eave + above - z1 - 0.6 - 1.4));
        rec.loft(ob, [ring(cx, cy, rd, roofZ - 0.4), ring(cx, cy, rd, z1)], dome ? "stone" : "glass");
        rec.loft(ob, [ring(cx, cy, rd + 0.6, z1), ring(cx, cy, rd + 0.6, z1 + 0.6)], "lip");
        const NR = 6, zd = z1 + 0.6;
        rec.loft(ob, Array.from({ length: NR + 1 }, (_, k) => { const t = k / NR * Math.PI / 2; return ring(cx, cy, Math.max(0.3, rd * Math.cos(t)), zd + rise * Math.sin(t)); }), dome ? "tile" : "glass");
        rec.loft(ob, [ring(cx, cy, 1.2, zd + rise - 0.3, 12), ring(cx, cy, 0.2, Math.min(eave + above, zd + rise + 1.4), 12)], "tile");
      } else if (a.kind === "courts") {
        rec.prism(ob, inset(mass, 1.4), roofZ, roofZ + 0.4, "roof");
        const attic = inset(mass, side * 0.2), h = Math.min(5, above - 1.6);
        rec.prism(ob, attic, roofZ - 0.4, roofZ + h, "stone");
        rec.prism(ob, inset(attic, -0.3), roofZ + h, roofZ + h + 0.7, "lip");
      } else {
        // the culture's roof, drawn aside and trimmed to the 20 m allowance (a deco finial can overreach it)
        const kind = pickRoof(cultureStyle(plan, a.culture).roofs, R);
        roofTop(rec, ob, ter, mass, roofZ, kind, R, ob.coll, ob.name);
        roofs.push(kind);
      }
      const kept = ob.prims.filter((p) => primZ(p) <= eave + above + 1e-9), top = Math.max(...kept.map(primZ));
      if (solids) real.prims.push(...kept);
      o.lots.push({ d: d.id, kind: "landmark", landmark: a.kind, keys: a.keys, label: a.label, culture: a.culture, obj: real.name, poly, front: [poly[a.front], poly[(a.front + 1) % poly.length]], footprint: mass, base, eave, top, storeys: Math.round((eave - base) / plan.storey), area: polyArea(poly), roofs });
    }
  }

  // Tower forms for Old Town, by style.tower.plan. Each draws the shaft from z0 up a span on the tower
  // envelope (c.env(u0, u1, v0, v1): a rectangle in the envelope's 0–1 frame, v running back from the
  // front edge) and returns its crowns [{q, z}] (z: the top of the shaft's last lip) and the roof kinds
  // it used on its terraces. An unknown plan is the setback.
  const tierFracs = (n) => { const w = Array.from({ length: n }, (_, i) => Math.pow(0.62, i)), s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); };
  const tierScale = (T, i) => (T.tiers > 1 ? 1 - T.taper * i / (T.tiers - 1) : 1);
  // each tier's scale for a tapering shaft dim metres across: the taper, with the first step at least 1.6 m
  // a side so the lowest setback terrace is wide enough to roof
  const tierScales = (T, dim) => {
    const out = [1];
    for (let i = 1; i < T.tiers; i++) out.push(Math.max(0.25, Math.min(tierScale(T, i), out[i - 1], i === 1 && T.taper > 0 ? 1 - 3.2 / Math.max(dim, 1) : 1)));
    return out;
  };
  // stacked tiers from z0 up span, a lip at each step; returns each tier's top. With c, the lowest two
  // setback terraces (the ring between a tier and the one above it) are roofed in the culture's mix, and
  // their kinds go on c.terraces.
  function towerTiers(o, ob, z0, span, n, shape, c) {
    const f = tierFracs(n), tops = [];
    let z = z0;
    for (let i = 0; i < n; i++) {
      const z1 = i === n - 1 ? z0 + span : z + span * f[i], q = shape(i);
      o.prism(ob, q, z, z1, "stone");
      o.prism(ob, inset(q, -0.4), z1 - 0.6, z1 + 0.4, "lip");
      tops.push(z1); z = z1;
    }
    if (c) for (let i = 1; i < Math.min(n, 3); i++) {
      const kind = ringRoof(o, ob, c.ter, shape(i - 1), shape(i), tops[i - 1] + 0.4, pickRoof(c.roofs, c.R), c.R, `${ob.name}_s${c.terraces.length}`);
      if (kind) c.terraces.push(kind);
    }
    return tops;
  }
  // A roof on the ring between an outer and an inner outline (same vertex count, same order): a deco
  // balustrade with finials, an open paved walk with pergola posts, a planted bed with trees, or farm beds
  // with a small glasshouse. Returns the kind, or null when the ring is too narrow to hold anything.
  function ringRoof(o, ob, ter, outer, inner, z, kind, R, name, open) {
    const n = outer.length, width = Math.min(...outer.map((p, i) => dist(p, inner[i])));
    if (n !== inner.length || !(width > 1)) return null;
    const L = (p, q, f) => [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];
    const quad = (i, f0, f1) => { const j = (i + 1) % n; return [L(outer[i], inner[i], f0), L(outer[j], inner[j], f0), L(outer[j], inner[j], f1), L(outer[i], inner[i], f1)]; };
    const post = ([x, y], h, m, w = 0.3) => o.prism(ob, [[x - w, y - w], [x + w, y - w], [x + w, y + w], [x - w, y + w]], z, z + h, m);
    const every = Math.max(1, Math.floor(n / 8));
    for (let i = 0; i < (open ? n - 1 : n); i++) {
      if (kind === "deco") {
        o.prism(ob, quad(i, 0, Math.min(0.5, 0.35 / width)), z, z + 1.1, "lip");
        if (i % every === 0) post(L(outer[i], inner[i], Math.min(0.5, 0.6 / width)), 2.6, "tile", 0.45);
      } else if (kind === "open") {
        o.prism(ob, quad(i, 0.05, 0.95), z, z + 0.15, "paver");
        if (i % every === 0) post(L(outer[i], inner[i], 0.5), 3, "lip", 0.15);
      } else if (kind === "garden") {
        o.prism(ob, quad(i, 0.1, 0.9), z, z + 0.5, "roof");
        if (i % every === 0 && width > 2) { const [x, y] = L(L(outer[i], inner[i], 0.5), L(outer[(i + 1) % n], inner[(i + 1) % n], 0.5), 0.5); tree(o, ter, ob.coll, R.choice(["asset_Plant_shrub", "asset_Plant_sapling"]), x, y, R, `${name}_tree_${i}`, 0.35, 0.6, z + 0.5); }
      } else {
        o.prism(ob, quad(i, 0.2, 0.8), z, z + 0.45, "roof");
      }
    }
    if (kind === "farm") o.prism(ob, quad(0, 0.15, 0.85), z, z + 2.5, "glass");
    return kind;
  }
  const centred = (c, s, cu = 0.5, hu = 0.5) => c.env(cu - hu * s, cu + hu * s, 0.5 - 0.5 * s, 0.5 + 0.5 * s);
  const TOWER_FORMS = {
    // four setback tiers, a lip at each step
    setback(o, ob, c) {
      const tops = towerTiers(o, ob, c.z0, c.span, 4, (i) => centred(c, [1, 0.8, 0.6, 0.4][i]), c);
      return { crowns: [{ q: centred(c, 0.4), z: tops[3] + 0.4 }], terraces: c.terraces };
    },
    // a box shrinking evenly at each tier (the wedding cake)
    rect(o, ob, c) {
      const n = c.T.tiers, S = tierScales(c.T, Math.min(c.envW, c.envD)), tops = towerTiers(o, ob, c.z0, c.span, n, (i) => centred(c, S[i]), c);
      return { crowns: [{ q: centred(c, S[n - 1]), z: tops[n - 1] + 0.4 }], terraces: c.terraces };
    },
    // a ziggurat stepping back from the front edge, its lower terraces roofed in the culture's mix
    stepped(o, ob, c) {
      const n = c.T.tiers, back = clamp(0.35 + c.T.taper, 0.35, 0.8), vr = (i) => (n > 1 ? back * i / (n - 1) : 0), du = (i) => 0.05 * i;
      const shape = (i) => c.env(du(i), 1 - du(i), vr(i), 1), tops = towerTiers(o, ob, c.z0, c.span, n, shape);
      for (let i = 1; i < Math.min(n, 3); i++) {
        const kind = pickRoof(c.roofs, c.R);
        // a roofTop where the strip is big enough, else a ring roof along it
        const q = c.env(du(i), 1 - du(i), vr(i - 1) + 0.02, vr(i) - 0.02);
        if (roofTop(o, ob, c.ter, q, tops[i - 1] + 0.95, kind, c.R, ob.coll, `${ob.name}_t${i}`) > 0 || ringRoof(o, ob, c.ter, [q[0], q[1]], [q[3], q[2]], tops[i - 1] + 0.4, kind, c.R, `${ob.name}_t${i}`, true)) c.terraces.push(kind);
      }
      return { crowns: [{ q: shape(n - 1), z: tops[n - 1] + 0.4 }], terraces: c.terraces };
    },
    // an elliptical drum in tapering tiers
    round(o, ob, c) {
      const n = c.T.tiers, NS = 24, S = tierScales(c.T, Math.min(c.envW, c.envD));
      const ell = (s) => Array.from({ length: NS }, (_, k) => { const t = (k + 0.5) * TAU / NS; return c.at(0.5 + 0.5 * s * Math.cos(t), 0.5 + 0.5 * s * Math.sin(t)); });
      const tops = towerTiers(o, ob, c.z0, c.span, n, (i) => ell(S[i]), c);
      return { crowns: [{ q: ell(S[n - 1]), z: tops[n - 1] + 0.4 }], terraces: c.terraces };
    },
    // two slender shafts of unequal height, a glazed bridge between them
    twin(o, ob, c) {
      const n = c.T.tiers, spanB = c.span * c.R.uniform(0.75, 0.9), crowns = [], S = tierScales(c.T, Math.min(0.43 * c.envW, c.envD));
      for (const [cu, span] of [[0.215, c.span], [0.785, spanB]]) {
        const tops = towerTiers(o, ob, c.z0, span, n, (i) => centred(c, S[i], cu, 0.215), c);
        crowns.push({ q: centred(c, S[n - 1], cu, 0.215), z: tops[n - 1] + 0.4 });
      }
      const zb = c.z0 + spanB * c.R.uniform(0.5, 0.7);
      o.prism(ob, c.env(0.4, 0.6, 0.38, 0.62), zb, zb + 5, "glass");
      return { crowns, terraces: c.terraces };
    },
  };
  // Crowns, by style.tower.crown: each draws on the shaft's top (q, z) and returns how far it rises, at most
  // TOWER_CROWN. An unknown crown is a roofTop in style.roof (default "deco").
  const ccwQ = (q) => (signedArea(q) < 0 ? [...q].reverse() : q);
  const TOWER_CROWNS = {
    // a plant-room penthouse
    flat(o, ob, ter, q, z, R) {
      const s = Math.sqrt(polyArea(q)), h = R.uniform(3.5, 5.5), p = inset(q, s * 0.28);
      o.prism(ob, p, z - 0.4, z + h, "stone");
      o.prism(ob, inset(p, -0.3), z + h, z + h + 0.5, "lip");
      return h + 0.5;
    },
    // a stepped cap and a needle
    needle(o, ob, ter, q, z, R) {
      const s = Math.sqrt(polyArea(q)), h1 = R.uniform(3, 5), h2 = R.uniform(2, 3), [cx, cy] = centroid(q), w = 0.7;
      o.prism(ob, inset(q, s * 0.18), z - 0.4, z + h1, "stone");
      o.prism(ob, inset(q, s * 0.34), z + h1, z + h1 + h2, "lip");
      o.prism(ob, [[cx - w, cy - w], [cx + w, cy - w], [cx + w, cy + w], [cx - w, cy + w]], z + h1 + h2, z + 20, "lip");
      return 20;
    },
    // a ring of vertical fins round the roof edge
    fins(o, ob, ter, q, z, R) {
      const h = R.uniform(8, 14), [cx, cy] = centroid(q);
      for (let e = 0; e < q.length; e++) {
        const a = q[e], b = q[(e + 1) % q.length], nf = Math.max(1, Math.floor(dist(a, b) / 3.5));
        for (let j = 0; j < nf; j++) {
          const t = (j + 0.5) / nf, p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], L = Math.hypot(cx - p[0], cy - p[1]) || 1;
          const dx = (cx - p[0]) / L, dy = (cy - p[1]) / L, wx = -dy * 0.2, wy = dx * 0.2, dd = Math.min(1.8, L * 0.5);
          o.prism(ob, ccwQ([[p[0] + wx, p[1] + wy], [p[0] - wx, p[1] - wy], [p[0] - wx + dx * dd, p[1] - wy + dy * dd], [p[0] + wx + dx * dd, p[1] + wy + dy * dd]]), z - 0.4, z + h, "lip");
        }
      }
      return h;
    },
    // a glazed lantern room, a cap and a finial
    lantern(o, ob, ter, q, z, R) {
      const s = Math.sqrt(polyArea(q)), g = inset(q, s * 0.2), h = R.uniform(8, 12);
      o.prism(ob, g, z - 0.4, z + h, "glass");
      o.prism(ob, inset(g, -0.5), z + h, z + h + 0.8, "lip");
      o.prism(ob, inset(g, s * 0.22), z + h + 0.8, z + h + 3.5, "stone");
      return h + 3.5;
    },
    // a planted roof
    garden(o, ob, ter, q, z, R) { return roofTop(o, ob, ter, q, z, "garden", R, ob.coll, ob.name); },
  };
  const TOWER_CROWN = 22;  // the most a crown adds above the top lip (a deco roofTop with a finial)
  // squaring the culture's dominant roof, so a podium reads as its culture
  const sharpen = (mix) => Object.fromEntries(ROOF_KINDS.map((k) => [k, Math.pow(Math.max(0, +(mix || {})[k] || 0), 2)]));
  // An Old Town tower on a lot: a podium (the lot, in by style.inset), then the tower form on the biggest
  // rectangle standing on the podium's first edge (or, with style.axis, its longest edge on that axis),
  // set back from its front so the podium keeps a roof terrace (style.roofs), then a crown. style.tower is
  // the culture's tower ({podium, tiers, taper, plan, crown}, see cultureStyle) or a TOWER_FORMS name.
  // H runs from the base to the top of the shaft; it's clamped so the drawn top, crown included, stays at
  // or under cap (absolute z).
  function oldTownTower(o, ob, ter, poly, H, style, R, cap) {
    style = style || {};
    const T = style.tower && typeof style.tower === "object" ? style.tower : { plan: style.tower, tiers: 4, taper: 0.4 };
    const zs = poly.map(([x, y]) => ter.G(Math.hypot(x, y))), zmax = Math.max(...zs), zmin = Math.min(...zs), base = zmax + 0.05;
    const Hmax = Math.max(0, cap - base - 0.4 - TOWER_CROWN), capped = H > Hmax;
    H = Math.min(H, Hmax);
    const pod = (style.inset > 0 && insetClip(poly, style.inset)) || poly;
    if (zmax - zmin > 0.1) o.prism(ob, pod, zmin - 0.3, base, "plinth");
    const podium = Math.min(isRange(T.podium) ? R.randint(T.podium[0], T.podium[1]) * (style.storey || 4.3) : clamp(H * R.uniform(0.07, 0.13), 9, 26), H * 0.4), podiumTop = base + podium;
    o.prism(ob, pod, base, podiumTop, "stone");
    // footprint: the biggest rectangle on the front edge, shrunk to a tower
    // (with style.axis: the biggest rectangle on the lot along the axis, brought in by the inset)
    const ccw = signedArea(pod) < 0 ? [pod[1], pod[0], ...pod.slice(2).reverse()] : pod;
    const ar = style.axis != null ? alignedRect(poly, style.axis) : null, fr = ar ? null : rectOnEdge(ccw, 0);
    const shrink = (q, d) => { const lu = dist(q[0], q[1]), lv = dist(q[1], q[2]); if (!(lu > 2 * d + 2 && lv > 2 * d + 2)) return null;
      const P = (u, v) => [q[0][0] + (q[1][0] - q[0][0]) * u + (q[3][0] - q[0][0]) * v, q[0][1] + (q[1][1] - q[0][1]) * u + (q[3][1] - q[0][1]) * v];
      return [P(d / lu, d / lv), P(1 - d / lu, d / lv), P(1 - d / lu, 1 - d / lv), P(d / lu, 1 - d / lv)]; };
    const foot = (ar && shrink(ar.q, (pod === poly ? 0 : style.inset) + 0.01)) || (fr && fr.area > 150 ? fr.q : null) || solidRect(pod) || inset(pod, 2);
    const rect4 = foot.length === 4;
    // u along the front edge, v back from it
    const P = (u, v) => { const a = [lerp(foot[0][0], foot[1][0], u), lerp(foot[0][1], foot[1][1], u)], b = [lerp(foot[3][0], foot[2][0], u), lerp(foot[3][1], foot[2][1], u)]; return [lerp(a[0], b[0], v), lerp(a[1], b[1], v)]; };
    const sub = (u0, u1, v0, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    const EU = [0.06, 0.94], EV = [0.28, 0.96], at = (u, v) => P(lerp(EU[0], EU[1], u), lerp(EV[0], EV[1], v));
    const env = (u0, u1, v0, v1) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    const span = H - podium - 1, kinds = [];
    if (span < 4 || !rect4) {  // too low for a shaft: the podium and a lip
      o.prism(ob, inset(pod, -0.4), podiumTop, podiumTop + 0.4, "lip");
      const t = rect4 ? env(0, 1, 0, 1) : foot;
      return { base, top: podiumTop + 0.4, podiumTop, tower: t, crown: t, height: H, capped, plan: null, crownKind: null, podiumRoof: null, terraces: [], roofs: kinds };
    }
    o.prism(ob, inset(pod, -0.4), podiumTop, podiumTop + 1, "lip");
    // the podium's roof terrace in front of the tower
    const podiumRoof = pickRoof(sharpen(style.roofs), R);
    roofTop(o, ob, ter, sub(0.04, 0.96, 0.05, EV[0] - 0.04), podiumTop + 1.55, podiumRoof, R, ob.coll, `${ob.name}_podium`);
    kinds.push(podiumRoof);
    const plan = TOWER_FORMS[T.plan] ? T.plan : "setback";
    const f = TOWER_FORMS[plan](o, ob, { env, at, envW: dist(at(0, 0), at(1, 0)), envD: dist(at(0, 0), at(0, 1)), z0: podiumTop + 1, span, T, R, ter, roofs: style.roofs || {}, terraces: [] });
    const terraces = f.terraces;
    kinds.push(...terraces);
    const crownKind = TOWER_CROWNS[T.crown] ? T.crown : style.roof || "deco";
    let top = -Infinity;
    for (const c of f.crowns) {
      const extra = TOWER_CROWNS[T.crown] ? TOWER_CROWNS[T.crown](o, ob, ter, c.q, c.z, R) : roofTop(o, ob, ter, c.q, c.z, crownKind, R, ob.coll, ob.name);
      top = Math.max(top, c.z + extra);
    }
    return { base, top, podiumTop, tower: env(0, 1, 0, 1), crown: f.crowns[0].q, height: H, capped, plan, crownKind, podiumRoof, terraces, roofs: kinds };
  }

  // The Lantern: the city's tallest tower at the exact centre. A slightly tapered shaft with a tall glazed
  // reactor heart, gold compute bands above and below it, a crown of radiator fins round a mast, and an
  // open colonnade hall at its foot facing the square.
  function genLantern(plan, d, ter, o, cfg, spokes) {
    const C = cfg.lantern, H = C.height, base = ter.G(0), top = base + H, rB = C.base / 2, rT = C.taper * rB;
    const crownZ = base + 0.92 * H, hallH = 20, h0 = base + H * C.heart[0], h1 = base + H * C.heart[1];
    const hero = spokes.find((sp) => sp.hero), ha = hero ? hero.a : SOUTH, NS = 32;
    const rAt = (z) => rB + (rT - rB) * clamp((z - base) / (crownZ - base), 0, 1);
    const circ = (r, n = NS) => Array.from({ length: n }, (_, j) => polar(r, ha + (j + 0.5) * TAU / n));
    const ring = (r, z) => circ(r).map(([x, y]) => [x, y, z]);
    const ob = o.obj(`NBHD_${d.id}_lantern`, d.id, { height_m: H });
    const drum = (ra, za, rb, zb, m) => o.loft(ob, [ring(ra, za), ring(rb, zb)], m);
    // shaft below the heart, the glazed heart (a little proud of the shaft), shaft above it to the crown
    drum(rB, base, rAt(h0), h0, "stone");
    drum(rAt(h0) + 1.8, h0, rAt(h1) + 1.8, h1, "glow");
    drum(rAt(h1), h1, rT, crownZ, "stone");
    for (const z of [h0, h1]) drum(rAt(z) + 2.6, z - 1.2, rAt(z) + 2.6, z + 1.2, "gold");
    // compute floors: gold lip bands about every 12 m
    const bands = (lo, hi) => { if (hi - lo < 6) return; const n = Math.max(1, Math.round((hi - lo) / 12));
      for (let k = 0; k <= n; k++) { const z = lo + (hi - lo) * k / n; drum(rAt(z) + 0.6, z - 0.4, rAt(z) + 0.6, z + 0.4, "gold"); } };
    bands(base + hallH + 8, h0 - 8);
    bands(h1 + 8, crownZ - 8);
    // crown: a cap, a core drum, radiator fins round it, and a mast to the very top
    drum(rT + 0.8, crownZ - 1.2, rT + 0.8, crownZ, "lip");
    const finTop = crownZ + 0.55 * (top - crownZ);
    drum(rT * 0.4, crownZ, rT * 0.3, finTop, "stone");
    const nF = rng(`${d.id}|lantern|crown`).randint(8, 12);
    for (let k = 0; k < nF; k++) {
      const a = ha + k * TAU / nF, ux = Math.cos(a), uy = Math.sin(a), t = 0.6, r0 = rT * 0.3, r2 = rT * 1.05;
      o.prism(ob, [[r0 * ux + t * uy, r0 * uy - t * ux], [r2 * ux + t * uy, r2 * uy - t * ux], [r2 * ux - t * uy, r2 * uy + t * ux], [r0 * ux - t * uy, r0 * uy + t * ux]], crownZ, finTop, "lip");
    }
    o.loft(ob, [ring(2.2, crownZ), ring(0.4, top)], "lip");
    // public hall at the foot: a colonnade round the shaft under a canopy, open to the square
    const s = cfg.grid.square, rc = Math.max(rB + 4, Math.min(rB + 10, s / 2 - 4)), nC = 24, cw = 1.2;
    for (let k = 0; k < nC; k++) {
      const [cx, cy] = polar(rc, ha + (k + 0.5) * TAU / nC);
      o.prism(ob, [[cx - cw, cy - cw], [cx + cw, cy - cw], [cx + cw, cy + cw], [cx - cw, cy + cw]], base, base + hallH, "stone");
    }
    for (let k = 0; k < NS; k++) {
      const a = ha + k * TAU / NS, b = ha + (k + 1) * TAU / NS;
      o.prism(ob, [polar(rB - 0.5, a), polar(rc + 2.5, a), polar(rc + 2.5, b), polar(rB - 0.5, b)], base + hallH, base + hallH + 1.2, "lip");
    }
    // the nominal square round it; genOldTown swaps in the grid's snapped square
    const half = s / 2, square = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([u, v]) => [u * Math.cos(ha) - v * Math.sin(ha), u * Math.sin(ha) + v * Math.cos(ha)]);
    o.lantern = { x: 0, y: 0, base, top, crown: crownZ, r_base: rB, r_top: rT, heart: [h0, h1], square };
    const poly = circ(rB);
    o.lots.push({ d: d.id, kind: "lantern", key: `${d.id}|lantern`, label: "The Lantern", poly, base, top, storeys: Math.round(H / plan.storey), area: polyArea(poly) });
  }

  function genTowers(plan, d, ter, spokes, o) {
    const temple = plan.scene.temple;
    const spireTop = temple.spire_top + ter.templeLift, hero = spokes.find((s) => s.hero), K = plan.skyline;
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
  //           (straight bridges where the band has no cells, as in Old Town)
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
      if (!avs.length) continue;
      const [A, B] = avs, ring = d.id, level = levelOf(d.id);
      // spines on the middle-band side of each avenue; a lone avenue (Old Town's, by default) keeps one spine
      // on its outer, band side, with no rungs, roof bridges or street walkways (those need a middle band)
      const spineR = [...new Set(B ? [A.r + (A.w / 2 - W / 2 - 0.5), B.r - (B.w / 2 - W / 2 - 0.5)] : [A.r + (A.w / 2 - W / 2 - 0.5)])];
      const two = spineR.length > 1;  // a middle band between two spines, for rungs, roof bridges and street walkways
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
      const L = ringLayout(plan, d), mid = two ? L.bands.find((b) => b.r0 >= A.r && b.r1 <= B.r) : null;
      const edges = mid ? o.cellEdges.filter((e) => e.d === d.id && e.band.i === mid.i) : [];
      // rungs between the two spines, per sector
      const rungKeys = new Set(), kOf = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
      if (two) for (let k = 0; k < nS; k++) {
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
      if (two && OV.per_sector > 0) for (let k = 0; k < nS; k++) {
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
      // extras 1: galleries on the avenues' outer sides, each bridged back to its spine; Old Town's grid
      // faces the inner side of its first avenue, so it never gets that gallery
      const galleries = [[A, -1, spineR[0]], B && [B, 1, spineR[spineR.length - 1]]].filter((g) => g && !(d.id === "core" && g[1] < 0));
      for (const [av, side, spine] of galleries) {
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
      if (!two) continue;
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
        const lo = ringSpines[i], hi = ringSpines[i + 1], t0 = lo.spineR[lo.spineR.length - 1], t1 = hi.spineR[0];
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
          if (ring.id === "island") continue;  // Old Town builds its own ground
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
      else if (d.type === "oldtown") genOldTown(plan, d, ter, spokes, o);
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
    if (o.lantern) {
      const over = o.lots.filter((l) => l.kind !== "lantern" && l.top > o.lantern.heart[1]);
      if (over.length) o.warnings.push(`${over.length} building${over.length > 1 ? "s rise" : " rises"} above the Lantern's heart (top ${Math.round(Math.max(...over.map((l) => l.top)))} m vs ${Math.round(o.lantern.heart[1])} m).`);
    }
    for (const d of plan.districts) {
      if (d.enabled === false || d.type !== "oldtown") continue;
      const cfg = oldTownConfig(d), cap = oldTownCap(plan, ter, d), bands = ringLayout(plan, d).bands;
      const wants = [[cfg.heights.grid[1], bands[0]], [cfg.heights.band[1], bands[bands.length - 1]], [cfg.heights.landmark[1], bands[0]]];
      const ci = oldTownCapInfo(plan, ter, d);
      if (ci.want < ci.floor) o.warnings.push(`The Lantern's clearance (${Math.round(ci.clearance)} m) is more than its heart's height above the square (${Math.round(ci.heartTop)} m), so Old Town is held to ${Math.round(ci.floor - ci.ground)} m podiums; lower the clearance or raise the heart.`);
      else if (wants.some(([h, b]) => b && ter.G(b.r0) + h > cap)) o.warnings.push(`Old Town towers capped at ${Math.round(cap - ter.G(0))} m to keep the Lantern's heart in view.`);
    }
    const hero = spokes.find((s) => s.hero);
    const hp = hero && makeProfile(plan, ter, S.hero_skip_crossings);
    if (hp) for (const [c0, c1] of S.hero_kit_ranges || []) hp.rampEnd.forEach((t, i) => { if (t > c0 && t < c1) o.warnings.push(`The ${hp.crossings[i].id.replace("_", " ")} approach ramp runs into the existing hero-avenue kit (ramp starts ${Math.round(t)} m from the centre).`); });
    return o;
  }

  return { generate, rng, makeTerrain, makeProfile, spokeAngles, ringLayout, oldTownConfig, oldTownCap, oldTownGrid, oldTownQuarters, oldTownLandmarks, polar, inCorridor, edgeAngle, cloud, cloudMul, USES, RECIPE_USES, SOUTH, NORTH, TAU, rad, angDist };
})();
if (typeof module !== "undefined") module.exports = CityGen;
