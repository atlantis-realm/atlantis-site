// Post-process export_people.py's raw glb for the web: prune, quantize (morph targets included), meshopt.
// Copies people_meta.json beside the output and prints size and triangles.
//   node people_glb.mjs [in=build/people/people_raw.glb] [out=../../../static/city/people.glb]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { stats } from "./hero_glb.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IN = path.join(HERE, "build", "people", "people_raw.glb");
const DEFAULT_OUT = path.join(HERE, "..", "..", "..", "static", "city", "people.glb");
const META = "people_meta.json";
const MESHOPT_LEVEL = "medium";
// No weld: the Blender export is already indexed per corner, and the walk keys must keep their vertex order.

async function main(inPath = DEFAULT_IN, outPath = DEFAULT_OUT) {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
	const doc = await io.read(inPath);
	await doc.transform(prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL }));
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	await io.write(outPath, doc);
	const metaOut = path.join(path.dirname(outPath), META);
	fs.copyFileSync(path.join(path.dirname(inPath), META), metaOut);

	const { triangles, draws } = stats(doc);
	const targets = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => p.listTargets().length));
	const kb = (b) => (b / 1024).toFixed(1);
	console.log(`${outPath}: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB (+ meta ${kb(fs.statSync(metaOut).size)} KB)`);
	console.log(`meshes ${targets.length}, triangles ${triangles} (one of each), morph targets per mesh ${[...new Set(targets)].join("/")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
	await main(...process.argv.slice(2).map((p) => path.resolve(p)));
