// The minibots for the /city hero: person-sized mechs from robot.glb (the
// robots' bake, robot.ts) taking part in the people's things. MINIBOT_WALKERS
// walk the pavements' walk paths among the people at a walking pace, their
// walk clip following the distance walked at their own (scaled) stride, and
// MINIBOT_TALKERS stand in the conversation circles in a member's place
// (people.ts pickBotSlots), playing the idle clip. Each is a seeded variant,
// palette and height (MINIBOT_HEIGHT: 1.2-1.8 m, the people are about 1.6-1.85).
// A walker steps aside round the people near it on its path (dodgeOffset), so
// it doesn't walk through them. None sit: see the README.
//
// All of them are one InstancedMesh, so they cost one draw call (and one in the
// sun shadow pass), however many variants are out: the variants' simplified
// meshes (robot_glb.mjs: ROBOT_V<i>_LOD, about 55% of the triangles, which keeps
// the thin rods of the legs) are baked into a vertex texture (bind position, normal, UV,
// joints, weights) with a corner list per variant, and the vertex shader skins
// corner gl_VertexID of the instance's variant with its own row of a bone
// texture; corners past a variant's own count collapse. Each frame the one
// shared rig is posed for every bot in turn (its clip times) and its bone
// matrices copied into that bot's row. Driven by the scene clock like the
// people and robots, so reduced motion freezes them; at night the palette
// glows faintly like the robots'.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32, walkerPose, type ConvoMember, type Walker } from './people.ts';
import {
	ROBOT_NIGHT_GLOW,
	ROBOT_WALK_CLIP,
	pickIndex,
	robotWalkTime,
	type RobotMeta
} from './robot.ts';
import type { Vec3 } from './props.ts';

/** Minibots walking the walk paths, desktop and mobile. */
export const MINIBOT_WALKERS = 6;
export const MINIBOT_WALKERS_MOBILE = 4;
/** Minibots standing in conversations (people.ts botSlots: one per group). */
export const MINIBOT_TALKERS = 2;
/** Height range (m) of a minibot, drawn per bot; a conversation's are drawn from MINIBOT_TALK_HEIGHT. */
export const MINIBOT_HEIGHT: [number, number] = [1.2, 1.8];
export const MINIBOT_TALK_HEIGHT: [number, number] = [1.25, 1.6];
/** Sideways spread (m, ±) from the path line, as the people's. */
export const MINIBOT_SPREAD = 0.5;
/**
 * Stepping aside: a walking bot keeps MINIBOT_DODGE_R (m) sideways from a person on its path who is
 * within MINIBOT_DODGE_NEAR (m) along it, easing in from MINIBOT_DODGE_FAR, and stays within
 * MINIBOT_LANE_MAX of the path line (clear of the lamps, trees and idle people beside the pavements).
 */
export const MINIBOT_DODGE_R = 0.8;
export const MINIBOT_DODGE_NEAR = 1;
export const MINIBOT_DODGE_FAR = 3;
export const MINIBOT_LANE_MAX = 0.8;
/** Minibot i draws its picks from mulberry32(MINIBOT_SEED + i). */
export const MINIBOT_SEED = 0x3b0b07;
/** Name of the idle clip in robot.glb; the variants' simplified meshes are <variant>MINIBOT_LOD_SUFFIX. */
export const MINIBOT_IDLE_CLIP = 'idle';
export const MINIBOT_LOD_SUFFIX = '_LOD';
/** Width (texels) of the vertex and corner textures (WebGL2 guarantees 2048). */
export const MINIBOT_TEX_W = 2048;
/** Vertex texture texels per vertex: position + u, normal + v, joints, weights. */
const TEXELS_PER_VERTEX = 4;

/** One minibot: walking a path (`path`, `s0`, `speed`, `offset`) or standing at `position` facing `heading`. */
export type Minibot = {
	kind: 'walk' | 'talk';
	variant: number;
	palette: number;
	/** Height (m); the bake is scaled by height / the variant's height. */
	height: number;
	scale: number;
	path: number;
	s0: number;
	speed: number;
	offset: number;
	position: Vec3;
	heading: number;
	/** Idle clip phase (s) of a standing bot, so a group doesn't sway together. */
	phase: number;
};

export type MinibotState = {
	kind: Minibot['kind'];
	variant: number;
	palette: number;
	height: number;
	position: Vec3;
};

export type Minibots = {
	mesh: THREE.InstancedMesh;
	update(t: number): void;
	state(): MinibotState[];
	setNight(level: number): void;
	dispose(): void;
};

/**
 * The seeded minibots: `walkers` on `paths` (round robin, spread along each
 * path's there-and-back cycle) at the stride-matched pace of their variant
 * and height (its walk_cycle_m scaled, per walk_duration_s: about 0.9-1.4 m/s),
 * then one per conversation slot. Variants and palettes come round without
 * repeats while there are any left (pickIndex), so a handful of bots show a
 * handful of different mechs.
 */
export function planMinibots(
	paths: Vec3[][],
	walkers: number,
	slots: ConvoMember[],
	meta: RobotMeta,
	variants: number[] = meta.variants.map((_, k) => k)
): Minibot[] {
	const bots: Minibot[] = [];
	const usedV: number[] = [];
	const usedP: number[] = [];
	const look = (rand: () => number, range: [number, number]) => {
		if (usedV.length >= variants.length) usedV.length = 0;
		if (usedP.length >= meta.palettes.length) usedP.length = 0;
		const variant =
			variants[
				pickIndex(
					variants.length,
					rand,
					usedV.map((v) => variants.indexOf(v))
				)
			];
		const palette = pickIndex(meta.palettes.length, rand, usedP);
		usedV.push(variant);
		usedP.push(palette);
		const height = range[0] + (range[1] - range[0]) * rand();
		return { variant, palette, height, scale: height / meta.variants[variant].height };
	};
	const n = paths.length ? walkers : 0;
	for (let i = 0; i < n; i++) {
		const rand = mulberry32(MINIBOT_SEED + i);
		const path = i % paths.length;
		const { variant, palette, height, scale } = look(rand, MINIBOT_HEIGHT);
		const length = pathLength(paths[path]);
		// The k-th bot on its path, of `share`, spread over the there-and-back cycle (2 x length).
		const k = Math.floor(i / paths.length);
		const share = Math.ceil((n - path) / paths.length);
		bots.push({
			kind: 'walk',
			variant,
			palette,
			height,
			scale,
			path,
			s0: (2 * length * (k + rand())) / share,
			speed: (meta.variants[variant].walk_cycle_m * scale) / meta.walk_duration_s,
			offset: (rand() * 2 - 1) * MINIBOT_SPREAD,
			position: [0, 0, 0],
			heading: 0,
			phase: 0
		});
	}
	slots.forEach((slot, j) => {
		const rand = mulberry32(MINIBOT_SEED + n + j);
		const { variant, palette, height, scale } = look(rand, MINIBOT_TALK_HEIGHT);
		bots.push({
			kind: 'talk',
			variant,
			palette,
			height,
			scale,
			path: -1,
			s0: 0,
			speed: 0,
			offset: 0,
			position: [...slot.position],
			heading: slot.heading,
			phase: rand() * (meta.idle_duration_s ?? 1)
		});
	});
	return bots;
}

/**
 * Where someone is along `path` (`length` m) after walking `s` m: the distance
 * from its first point, and whether it is on the way back (open paths
 * ping-pong, as walkerPose; a closed one wraps, never back). Its `offset` to
 * its right is the path's left on the way back.
 */
export function pathPlace(
	path: Vec3[],
	length: number,
	s: number
): { along: number; back: boolean } {
	if (isClosed(path)) return { along: ((s % length) + length) % length, back: false };
	const u = ((s % (2 * length)) + 2 * length) % (2 * length);
	return u > length ? { along: 2 * length - u, back: true } : { along: u, back: false };
}

/**
 * Walking bot `b`'s sideways offset (m, to its right) at time `t`: its own,
 * pushed away from each of `people` on its path whose sideways place is within
 * MINIBOT_DODGE_R of it, in full within MINIBOT_DODGE_NEAR along the path and
 * easing out (smoothstep) to MINIBOT_DODGE_FAR; clamped to MINIBOT_LANE_MAX.
 * Everyone moves smoothly, so the offset does too: no state, replays the same.
 */
export function dodgeOffset(
	paths: Vec3[][],
	b: Minibot,
	people: Walker[],
	t: number,
	lengths: number[] = paths.map(pathLength)
): number {
	const path = paths[b.path];
	const length = lengths[b.path];
	const closed = isClosed(path);
	const me = pathPlace(path, length, b.s0 + b.speed * t);
	// Sideways places in the path's own frame (+: its right walking from the first point).
	const mine = me.back ? -b.offset : b.offset;
	let side = mine;
	for (const w of people) {
		if (w.path !== b.path) continue;
		const p = pathPlace(path, length, w.s0 + w.direction * w.speed * t);
		let ds = Math.abs(me.along - p.along);
		if (closed) ds = Math.min(ds, length - ds);
		if (ds >= MINIBOT_DODGE_FAR) continue;
		const gap = mine - (p.back ? -w.offset : w.offset);
		const need = MINIBOT_DODGE_R - Math.abs(gap);
		if (need <= 0) continue;
		const u = Math.min(1, (MINIBOT_DODGE_FAR - ds) / (MINIBOT_DODGE_FAR - MINIBOT_DODGE_NEAR));
		side += (gap < 0 ? -1 : 1) * need * u * u * (3 - 2 * u);
	}
	side = Math.max(-MINIBOT_LANE_MAX, Math.min(MINIBOT_LANE_MAX, side));
	return me.back ? -side : side;
}

/**
 * Where walking bot `b` is at time `t` (s): on its path (ping-pong, as the
 * people), `offset` to its right, or the dodgeOffset round `people` when given.
 */
export function minibotPose(
	paths: Vec3[][],
	b: Minibot,
	t: number,
	people?: Walker[],
	lengths?: number[]
): { position: Vec3; heading: number } {
	if (b.kind !== 'walk') return { position: b.position, heading: b.heading };
	const { position, heading } = walkerPose(paths[b.path], b.s0 + b.speed * t);
	const offset = people ? dodgeOffset(paths, b, people, t, lengths) : b.offset;
	return {
		position: [
			position[0] + offset * Math.cos(heading),
			position[1],
			position[2] - offset * Math.sin(heading)
		],
		heading
	};
}

/** Texel (x, y) of linear texel index `i` in a texture `w` wide. */
export function texelAt(i: number, w: number): [number, number] {
	return [i % w, Math.floor(i / w)];
}

/** One variant's simplified mesh, baked: TEXELS_PER_VERTEX RGBA texels per vertex, and its corners (vertex indices). */
export type BakedVariant = { verts: Float32Array; corners: Uint32Array; vertices: number };

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/**
 * `mesh`'s vertices in bind space (bindMatrix applied, as three's skinning
 * does first): per vertex (x, y, z, u), (nx, ny, nz, v), its four joints
 * (indices into its skeleton) and weights; and its index list (or 0..n-1).
 */
export function bakeVariant(mesh: THREE.SkinnedMesh): BakedVariant {
	const g = mesh.geometry;
	const pos = g.getAttribute('position');
	const nor = g.getAttribute('normal');
	const uv = g.getAttribute('uv');
	const ji = g.getAttribute('skinIndex');
	const jw = g.getAttribute('skinWeight');
	const verts = new Float32Array(pos.count * TEXELS_PER_VERTEX * 4);
	_m3.setFromMatrix4(mesh.bindMatrix);
	for (let v = 0; v < pos.count; v++) {
		const o = v * TEXELS_PER_VERTEX * 4;
		_p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
		if (nor) _n.fromBufferAttribute(nor, v).applyMatrix3(_m3).normalize();
		else _n.set(0, 1, 0);
		verts.set([_p.x, _p.y, _p.z, uv ? uv.getX(v) : 0, _n.x, _n.y, _n.z, uv ? uv.getY(v) : 0], o);
		let sum = 0;
		for (let k = 0; k < 4; k++) sum += jw.getComponent(v, k);
		for (let k = 0; k < 4; k++) {
			verts[o + 8 + k] = ji.getComponent(v, k);
			verts[o + 12 + k] = sum > 0 ? jw.getComponent(v, k) / sum : k === 0 ? 1 : 0;
		}
	}
	const corners = g.index
		? Uint32Array.from({ length: g.index.count }, (_, k) => g.index!.getX(k))
		: Uint32Array.from({ length: pos.count }, (_, k) => k);
	return { verts, corners, vertices: pos.count };
}

const _bone = new THREE.Matrix4();
const _pre = new THREE.Matrix4();

/**
 * The skin matrices of `mesh` as posed now, into `out` from `offset` (16
 * floats each, column-major, in its skeleton's bone order): modelMatrix ·
 * bindMatrixInverse · bone.matrixWorld · boneInverse, so a baked vertex skins
 * to object space exactly as three's own skinning puts it (world matrices
 * taken relative to the rig root, which the instance matrix replaces).
 */
export function boneRows(
	mesh: THREE.SkinnedMesh,
	root: THREE.Object3D,
	out: Float32Array,
	offset = 0
): void {
	const inv = _pre.copy(root.matrixWorld).invert();
	const model = new THREE.Matrix4()
		.multiplyMatrices(inv, mesh.matrixWorld)
		.multiply(mesh.bindMatrixInverse);
	const { bones, boneInverses } = mesh.skeleton;
	for (let j = 0; j < bones.length; j++) {
		_bone.multiplyMatrices(inv, bones[j].matrixWorld).multiply(boneInverses[j]);
		_bone.premultiply(model);
		_bone.toArray(out, offset + j * 16);
	}
}

/** CPU twin of the shader: baked vertex `v` skinned by the 16-float matrices in `bones` (tests and checks). */
export function skinBaked(
	baked: BakedVariant,
	v: number,
	bones: Float32Array,
	out = new THREE.Vector3()
) {
	const o = v * TEXELS_PER_VERTEX * 4;
	const p = new THREE.Vector3(baked.verts[o], baked.verts[o + 1], baked.verts[o + 2]);
	out.set(0, 0, 0);
	for (let k = 0; k < 4; k++) {
		const w = baked.verts[o + 12 + k];
		if (!w) continue;
		_bone.fromArray(bones, baked.verts[o + 8 + k] * 16);
		out.addScaledVector(_p.copy(p).applyMatrix4(_bone), w);
	}
	return out;
}

/** GLSL: fetch and skin the instance's corner gl_VertexID (mbPos, mbNormal, mbUv); dead corners collapse to 0. */
const SKIN_PARS = /* glsl */ `
uniform highp sampler2D mbVerts;
uniform highp sampler2D mbCorners;
uniform highp sampler2D mbBones;
attribute vec4 mbInfo;
ivec2 mbAt( int i ) { return ivec2( i % ${MINIBOT_TEX_W}, i / ${MINIBOT_TEX_W} ); }
mat4 mbBone( float j ) {
	int x = int( j ) * 4;
	return mat4(
		texelFetch( mbBones, ivec2( x, gl_InstanceID ), 0 ),
		texelFetch( mbBones, ivec2( x + 1, gl_InstanceID ), 0 ),
		texelFetch( mbBones, ivec2( x + 2, gl_InstanceID ), 0 ),
		texelFetch( mbBones, ivec2( x + 3, gl_InstanceID ), 0 ) );
}
`;
const SKIN_MAIN = /* glsl */ `
	bool mbLive = float( gl_VertexID ) < mbInfo.y;
	int mbV = int( texelFetch( mbCorners, mbAt( int( mbInfo.x ) + ( mbLive ? gl_VertexID : 0 ) ), 0 ).r );
	vec4 mbP = texelFetch( mbVerts, mbAt( mbV * ${TEXELS_PER_VERTEX} ), 0 );
	vec4 mbN = texelFetch( mbVerts, mbAt( mbV * ${TEXELS_PER_VERTEX} + 1 ), 0 );
	vec4 mbJ = texelFetch( mbVerts, mbAt( mbV * ${TEXELS_PER_VERTEX} + 2 ), 0 );
	vec4 mbW = texelFetch( mbVerts, mbAt( mbV * ${TEXELS_PER_VERTEX} + 3 ), 0 );
	mat4 mbSkin = mbW.x * mbBone( mbJ.x ) + mbW.y * mbBone( mbJ.y ) + mbW.z * mbBone( mbJ.z ) + mbW.w * mbBone( mbJ.w );
	vec3 mbPos = mbLive ? ( mbSkin * vec4( mbP.xyz, 1.0 ) ).xyz : vec3( 0.0 );
	vec3 mbNormal = normalize( ( mbSkin * vec4( mbN.xyz, 0.0 ) ).xyz );
	vec2 mbUv = vec2( mbP.w + mbInfo.z, mbN.w );
	#ifdef USE_MAP
		vMapUv = ( mapTransform * vec3( mbUv, 1.0 ) ).xy;
	#endif
	#ifdef USE_EMISSIVEMAP
		vEmissiveMapUv = ( emissiveMapTransform * vec3( mbUv, 1.0 ) ).xy;
	#endif
`;

/** Patch `material` (standard or depth) to draw the baked bots: skinned from the textures, not the geometry. */
function patch(material: THREE.Material, textures: Record<string, THREE.Texture>): void {
	material.onBeforeCompile = (shader) => {
		for (const [name, value] of Object.entries(textures)) shader.uniforms[name] = { value };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\n' + SKIN_PARS)
			.replace('#include <uv_vertex>', '#include <uv_vertex>\n' + SKIN_MAIN)
			.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = mbNormal;')
			.replace('#include <begin_vertex>', 'vec3 transformed = mbPos;');
	};
	material.customProgramCacheKey = () => 'minibots';
}

/** A float RGBA (or R) texture of `data`, nearest, no mipmaps. */
function dataTexture(data: Float32Array, w: number, h: number, format: THREE.PixelFormat) {
	const tex = new THREE.DataTexture(data, w, h, format, THREE.FloatType);
	tex.magFilter = tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}

/** Whether robot.glb's `scene` has a simplified mesh for some variant (an older bake has none). */
export function hasMinibotMeshes(scene: THREE.Object3D, meta: RobotMeta): boolean {
	return meta.variants.some(
		(v) => (scene.getObjectByName(v.name + MINIBOT_LOD_SUFFIX) as THREE.SkinnedMesh)?.isSkinnedMesh
	);
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The minibots from robot.glb's `scene` and `animations` (its ROBOT_V<i>_LOD
 * meshes, the walk and idle clips): `walkers` on `paths` and one in each of
 * `slots`, as one InstancedMesh, or null without the clips, the simplified
 * meshes or anyone to place. `scene` is only read (and cloned once for the rig).
 */
export function createMinibots(
	scene: THREE.Object3D,
	animations: THREE.AnimationClip[],
	meta: RobotMeta,
	paths: Vec3[][],
	slots: ConvoMember[],
	opts: { shadows: boolean; walkers?: number; people?: Walker[] }
): Minibots | null {
	const walk = THREE.AnimationClip.findByName(animations, ROBOT_WALK_CLIP);
	const idle = THREE.AnimationClip.findByName(animations, MINIBOT_IDLE_CLIP);
	const rig = cloneSkinned(scene);
	const lods = meta.variants.map(
		(v) => rig.getObjectByName(v.name + MINIBOT_LOD_SUFFIX) as THREE.SkinnedMesh | undefined
	);
	const have = lods.flatMap((m, k) => (m?.isSkinnedMesh ? [k] : []));
	const bots =
		walk && idle && have.length
			? planMinibots(paths, opts.walkers ?? MINIBOT_WALKERS, slots, meta, have)
			: [];
	if (!bots.length) return null;
	rig.updateMatrixWorld(true);

	// The variants out, baked one after another; their corner lists likewise.
	const used = [...new Set(bots.map((b) => b.variant))].sort((a, b) => a - b);
	const baked = new Map(used.map((v) => [v, bakeVariant(lods[v]!)]));
	const vOffset = new Map<number, number>();
	const cOffset = new Map<number, number>();
	let vertices = 0;
	let corners = 0;
	for (const v of used) {
		vOffset.set(v, vertices);
		cOffset.set(v, corners);
		vertices += baked.get(v)!.vertices;
		corners += baked.get(v)!.corners.length;
	}
	const vRows = Math.ceil((vertices * TEXELS_PER_VERTEX) / MINIBOT_TEX_W);
	const vData = new Float32Array(vRows * MINIBOT_TEX_W * 4);
	const cRows = Math.ceil(corners / MINIBOT_TEX_W);
	const cData = new Float32Array(cRows * MINIBOT_TEX_W);
	let maxCorners = 0;
	for (const v of used) {
		const b = baked.get(v)!;
		vData.set(b.verts, vOffset.get(v)! * TEXELS_PER_VERTEX * 4);
		b.corners.forEach((c, k) => (cData[cOffset.get(v)! + k] = c + vOffset.get(v)!));
		maxCorners = Math.max(maxCorners, b.corners.length);
	}
	const bones = Math.max(...used.map((v) => lods[v]!.skeleton.bones.length));
	const bData = new Float32Array(bots.length * bones * 16);
	const textures = {
		mbVerts: dataTexture(vData, MINIBOT_TEX_W, vRows, THREE.RGBAFormat),
		mbCorners: dataTexture(cData, MINIBOT_TEX_W, cRows, THREE.RedFormat),
		mbBones: dataTexture(bData, bones * 4, bots.length, THREE.RGBAFormat)
	};

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxCorners * 3), 3));
	const info = new Float32Array(bots.length * 4);
	bots.forEach((b, i) =>
		info.set(
			[
				cOffset.get(b.variant)!,
				baked.get(b.variant)!.corners.length,
				b.palette / meta.palettes.length,
				0
			],
			i * 4
		)
	);
	geometry.setAttribute('mbInfo', new THREE.InstancedBufferAttribute(info, 4));

	// The robots' material: the palette strip, nearest, glowing at night (setNight).
	const source = lods[used[0]]!.material as THREE.MeshStandardMaterial;
	const material = source.clone();
	if (source.map) {
		material.map = source.map.clone();
		material.map.magFilter = material.map.minFilter = THREE.NearestFilter;
		material.map.generateMipmaps = false;
	}
	material.emissiveMap = material.map;
	material.emissive.setRGB(1, 1, 1);
	material.emissiveIntensity = 0;
	patch(material, textures);
	const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
	patch(depth, textures);

	const mesh = new THREE.InstancedMesh(geometry, material, bots.length);
	mesh.name = 'Minibots';
	mesh.customDepthMaterial = depth;
	mesh.castShadow = mesh.receiveShadow = opts.shadows;
	// They spread over the avenue and move; the geometry is a stand-in anyway.
	mesh.frustumCulled = false;

	const mixer = new THREE.AnimationMixer(rig);
	const walking = mixer.clipAction(walk!);
	const standing = mixer.clipAction(idle!);
	for (const a of [walking, standing]) {
		a.play();
		a.paused = true;
	}
	const positions: Vec3[] = bots.map(() => [0, 0, 0]);
	const lengths = paths.map(pathLength);
	const update = (t: number): void => {
		bots.forEach((b, i) => {
			const { position, heading } = minibotPose(paths, b, t, opts.people, lengths);
			positions[i] = position;
			_position.set(...position);
			_quaternion.setFromAxisAngle(_up, heading);
			_scale.setScalar(b.scale);
			mesh.setMatrixAt(i, _matrix.compose(_position, _quaternion, _scale));
			// Pose the shared rig for this bot, then copy its skin matrices into the bot's row.
			const walks = b.kind === 'walk';
			walking.setEffectiveWeight(walks ? 1 : 0);
			standing.setEffectiveWeight(walks ? 0 : 1);
			if (walks) {
				const cycle = meta.variants[b.variant].walk_cycle_m * b.scale;
				walking.time = robotWalkTime(b.s0 + b.speed * t, cycle, walk!.duration);
			} else standing.time = (((t + b.phase) % idle!.duration) + idle!.duration) % idle!.duration;
			mixer.update(0);
			rig.updateMatrixWorld(true);
			boneRows(lods[b.variant]!, rig, bData, i * bones * 16);
		});
		mesh.instanceMatrix.needsUpdate = true;
		textures.mbBones.needsUpdate = true;
	};
	update(0);
	const state = (): MinibotState[] =>
		bots.map((b, i) => ({
			kind: b.kind,
			variant: b.variant,
			palette: b.palette,
			height: b.height,
			position: positions[i]
		}));
	const setNight = (level: number): void => {
		material.emissiveIntensity = ROBOT_NIGHT_GLOW * level;
	};
	const dispose = (): void => {
		mixer.stopAllAction();
		mixer.uncacheRoot(rig);
		rig.traverse((obj) => {
			const m = obj as THREE.SkinnedMesh;
			if (m.isSkinnedMesh) m.skeleton.dispose();
		});
		for (const tex of Object.values(textures)) tex.dispose();
		geometry.dispose();
		material.map?.dispose();
		material.dispose();
		depth.dispose();
		mesh.dispose();
	};
	return { mesh, update, state, setNight, dispose };
}

/** First point == last point (as people.ts walkerPose): a loop. */
function isClosed(path: Vec3[]): boolean {
	const a = path[0];
	const b = path[path.length - 1];
	return path.length > 2 && Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-3;
}

function pathLength(path: Vec3[]): number {
	let length = 0;
	for (let k = 1; k < path.length; k++)
		length += Math.hypot(
			path[k][0] - path[k - 1][0],
			path[k][1] - path[k - 1][1],
			path[k][2] - path[k - 1][2]
		);
	return length;
}
