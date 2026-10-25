const fs = require("fs"), path = require("path");
const CityGen = require("../citygen.js");
const loadPlan = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plan.json"), "utf8"));
const gen = (plan) => CityGen.generate(plan, { solids: true });
const core = (plan) => plan.districts.find((d) => d.id === "core");
const centre = (plan) => plan.scene.center;
const ringR = (x, y) => Math.hypot(x, y);
const primsOf = (o, namePrefix) => o.objects.filter((ob) => ob.name.startsWith(namePrefix)).flatMap((ob) => ob.prims);
module.exports = { CityGen, loadPlan, gen, core, ringR, primsOf, centre };
