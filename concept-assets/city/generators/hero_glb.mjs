// Post-process export_hero.py's raw glb for the web: dedup, GPU instancing, weld, prune, quantize, meshopt.
// Copies hero_props.json beside the output and prints size, triangles and the draw-call estimate.
//   node hero_glb.mjs [in=build/hero/hero_raw.glb] [out=../../../static/city/hero.glb]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, instance, weld, prune, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IN = path.join(HERE, "build", "hero", "hero_raw.glb");
const DEFAULT_OUT = path.join(HERE, "..", "..", "..", "static", "city", "hero.glb");
const PROPS = "hero_props.json";
const INSTANCE_MIN = 5; // meshes used by at least this many nodes become one EXT_mesh_gpu_instancing node
const MESHOPT_LEVEL = "medium";
// Materials are left out of dedup: NIGHT_* twins and HERO_* materials are found by name on the page, and
// two NIGHT_ materials with the same colour (Lantern cyan, well ring) must stay distinct for night_nodes.
const DEDUP_TYPES = [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE];
const INSTANCING = "EXT_mesh_gpu_instancing";

// instance() refuses any document with animations. The only animation is HeroCamera's, on a node with no
// mesh, so lift the animations out, instance, and put them back exactly as they were.
function instanceStatic(min) {
	const inner = instance({ min });
	return async (doc, ctx) => {
		const saved = doc.getRoot().listAnimations().map((a) => ({
			name: a.getName(), extras: a.getExtras(),
			channels: a.listChannels().map((c) => {
				const s = c.getSampler();
				if (c.getTargetNode()?.getMesh()) throw new Error(`animated mesh node ${c.getTargetNode().getName()}`);
				return { node: c.getTargetNode(), path: c.getTargetPath(), input: s.getInput(), output: s.getOutput(), interp: s.getInterpolation() };
			}),
		}));
		for (const a of doc.getRoot().listAnimations()) a.dispose();
		await inner(doc, ctx);
		for (const { name, extras, channels } of saved) {
			const anim = doc.createAnimation(name).setExtras(extras);
			for (const { node, path: target, input, output, interp } of channels) {
				const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(interp);
				anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(target).setSampler(sampler));
			}
		}
	};
}

export function stats(doc) {
	let triangles = 0, draws = 0;
	for (const n of doc.getRoot().listNodes()) {
		const mesh = n.getMesh();
		if (!mesh) continue;
		const batch = n.getExtension(INSTANCING);
		const count = batch ? batch.getAttribute("TRANSLATION").getCount() : 1;
		for (const p of mesh.listPrimitives()) {
			triangles += ((p.getIndices() || p.getAttribute("POSITION")).getCount() / 3) * count;
			draws += 1; // an instanced node draws each primitive once
		}
	}
	return { triangles, draws };
}

async function main(inPath = DEFAULT_IN, outPath = DEFAULT_OUT) {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
	const doc = await io.read(inPath);
	await doc.transform(
		dedup({ propertyTypes: DEDUP_TYPES }),
		instanceStatic(INSTANCE_MIN),
		weld(),
		prune(),
		quantize(),
		meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL }),
	);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	await io.write(outPath, doc);
	const propsOut = path.join(path.dirname(outPath), PROPS);
	fs.copyFileSync(path.join(path.dirname(inPath), PROPS), propsOut);

	const { triangles, draws } = stats(doc);
	const glbBytes = fs.statSync(outPath).size, propsBytes = fs.statSync(propsOut).size;
	const mb = (b) => (b / 1024 / 1024).toFixed(2);
	console.log(`${outPath}: ${mb(glbBytes)} MB (+ props ${(propsBytes / 1024).toFixed(1)} KB = ${mb(glbBytes + propsBytes)} MB)`);
	console.log(`triangles ${triangles}, draw calls ~${draws}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
	await main(...process.argv.slice(2).map((p) => path.resolve(p)));
