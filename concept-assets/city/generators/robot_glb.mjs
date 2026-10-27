// Post-process export_robot.py's raw glb for the web: prune, dedup, weld, resample (drops keyframes that a
// linear blend of their neighbours reproduces within RESAMPLE_TOLERANCE), quantize, meshopt. The variant
// meshes (ROBOT_V<i>, all on the one rig), the palette strip and both animations ('walk', 'idle') stay; the
// keys stay linear (the robots' walk is the fluid one). Each variant also gets a simplified index list
// over its own vertices, node ROBOT_V<i>_LOD on the same skin (lod(): the page's small minibots).
// Copies robot_meta.json beside the output and prints size, triangles per variant and keyframes.
//   node robot_glb.mjs [in=build/robot/robot_raw.glb] [out=../../../static/city/robot.glb]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, resample, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { stats } from "./hero_glb.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IN = path.join(HERE, "build", "robot", "robot_raw.glb");
const DEFAULT_OUT = path.join(HERE, "..", "..", "..", "static", "city", "robot.glb");
const META = "robot_meta.json";
const MESHOPT_LEVEL = "medium";
const RESAMPLE_TOLERANCE = 1e-4;   // gltf-transform's default: well under a millimetre on a 4 m mech
export const LOD_SUFFIX = "_LOD";
export const LOD_RATIO = 0.2;       // of each variant's triangles at most: LOD_ERROR decides first
export const LOD_ERROR = 0.002;     // of the mesh's extent: 8 mm on the 4 m bake, 3 mm on a 1.5 m minibot (keeps the thin rods)

/**
 * A ROBOT_V<i>_LOD node beside every skinned variant on the same skin, its primitive the variant's with a
 * meshopt-simplified index list (down to LOD_RATIO of the triangles while within LOD_ERROR; seams kept, so
 * the palette regions stay). The kept vertices keep their exact joints, weights and UVs (meshopt() later
 * compacts the LOD's vertices into accessors of its own). A looser error (0.01) took the legs' thin rods.
 */
export function lod() {
	return (doc) => {
		const root = doc.getRoot();
		for (const node of root.listNodes().filter((n) => n.getMesh() && n.getSkin())) {
			const prim = node.getMesh().listPrimitives()[0];
			const indices = new Uint32Array(prim.getIndices().getArray());
			const positions = new Float32Array(prim.getAttribute("POSITION").getArray());
			const target = Math.floor((indices.length / 3) * LOD_RATIO) * 3;
			const [out] = MeshoptSimplifier.simplify(indices, positions, 3, target, LOD_ERROR);
			const accessor = doc.createAccessor(node.getName() + LOD_SUFFIX).setType("SCALAR").setArray(out)
				.setBuffer(prim.getIndices().getBuffer());
			const copy = prim.clone().setIndices(accessor);
			const mesh = doc.createMesh(node.getName() + LOD_SUFFIX).addPrimitive(copy);
			const lodNode = doc.createNode(node.getName() + LOD_SUFFIX).setMesh(mesh).setSkin(node.getSkin())
				.setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
			const parent = node.getParentNode();
			if (parent) parent.addChild(lodNode);
			else for (const scene of root.listScenes()) if (scene.listChildren().includes(node)) scene.addChild(lodNode);
		}
	};
}

const keyframes = (doc) => doc.getRoot().listAnimations()
	.map((a) => `${a.getName()} ${a.listSamplers().reduce((n, s) => n + s.getInput().getCount(), 0)}`).join(", ");

async function main(inPath = DEFAULT_IN, outPath = DEFAULT_OUT) {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
	const doc = await io.read(inPath);
	const before = keyframes(doc);
	await doc.transform(
		prune(),
		dedup(),
		weld(),
		lod(),
		resample({ tolerance: RESAMPLE_TOLERANCE }),
		quantize(),
		meshopt({ encoder: MeshoptEncoder, level: MESHOPT_LEVEL }),
	);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	await io.write(outPath, doc);
	const metaOut = path.join(path.dirname(outPath), META);
	fs.copyFileSync(path.join(path.dirname(inPath), META), metaOut);

	const { triangles } = stats(doc);
	const joints = doc.getRoot().listSkins().map((s) => s.listJoints().length).join("/");
	const perMesh = doc.getRoot().listNodes().filter((n) => n.getMesh())
		.map((n) => `${n.getName()} ${n.getMesh().listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0)}`);
	const kb = (b) => (b / 1024).toFixed(1);
	console.log(`${outPath}: ${kb(fs.statSync(outPath).size)} KB (+ meta ${kb(fs.statSync(metaOut).size)} KB)`);
	console.log(`triangles ${triangles} (${perMesh.join(", ")}), joints ${joints}, keyframes ${before} -> ${keyframes(doc)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
	await main(...process.argv.slice(2).map((p) => path.resolve(p)));
