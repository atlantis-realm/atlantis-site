// node citygen_cli.js plan.json build/build.json: run the plan page's generator and write Blender's build list
const fs = require("fs"), CityGen = require("./citygen.js");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const o = CityGen.generate(plan, { solids: true });
const ter = o.terrain;
const out = {
  center: plan.scene.center,
  objects: o.objects.filter((ob) => ob.prims.length),
  instances: o.instances,
  canal_cuts: o.canalCuts,
  water_bands: plan.scene.rings.filter((r) => r.kind === "water").map((r) => [r.r0, r.r1]),
  land_bands: plan.scene.rings.filter((r) => r.kind === "land").map((r) => [r.r0, r.r1]),
  terrain: (() => {
    // lookup tables the Blender regrade reads, every 0.5 m from the centre out to 1400 m
    const step = 0.5, n = Math.round((Math.max(...plan.scene.rings.map((r) => r.r1)) + 800) / step) + 1, tab = (f) => Array.from({ length: n }, (_, i) => Math.round(f(i * step) * 1000) / 1000);
    return { step, templeLift: ter.templeLift, water: ter.water, old_levels: plan.scene.terrain.old_levels,
      delta: tab(ter.deltaAt), G: tab(ter.G), belt: tab(ter.beltZ), park: tab(ter.parkZ), island: tab(ter.islandZ),
      rescale: plan.scene.rescale || null, hero_angle: CityGen.spokeAngles(plan).find((s) => s.hero)?.a ?? -Math.PI / 2 };
  })(),
  summary: { lots: o.lots.length, objects: o.objects.length, instances: o.instances.length, prims: o.objects.reduce((t, ob) => t + ob.prims.length, 0), warnings: o.warnings,
    spokes: o.spokes.map((s) => ({ k: s.k, hero: s.hero, stairs: s.stairs.length, bridges: s.bridges.length })), avenues: o.avenues.map((a) => `${a.d} r${a.r} ${a.dir}`) },
};
fs.mkdirSync(require("path").dirname(process.argv[3]), { recursive: true });
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(JSON.stringify(out.summary, null, 1));
