// The Lantern's energy for the /city hero: the Magitech Look Lab's powerline
// spans (waveSpan with add: true, disc: false, "Lantern Lines" cyan) ported to
// run inside the Lantern's glowing heart (the NIGHT_MAT_AP_Cyan cylinder,
// export_hero.py). Three aurora spans run up the heart's axis, each a ribbon of
// four curtains (bright wavering edge, upward rays, travelling pulses, RGB-split
// fringe, vertex fold) twisting around the axis, with morphing molecular runes
// riding the pulses. No audio. All curtains are one mesh and all runes one
// InstancedMesh: two draw calls, about 1.5k + up to ~8k triangles.
//
// The heart becomes a lit glass tube to show them: it glows by day too
// (LANTERN_DAY_GLOW), turns semi-transparent and double-sided, and the stone
// shaft the export runs up its middle is cut away (discarded in the shader)
// inside it. The energy draws after it, additively, so it reads through the glow.

import * as THREE from 'three';
import type { HeroProps, Vec3 } from './props.ts';

/** The Lantern's heart material (the export maps MAT_AP_Cyan / MAT_AP_Glow there; night_nodes restricts it to the Lantern). */
export const LANTERN_HEART_MATERIAL = 'NIGHT_MAT_AP_Cyan';
/**
 * The heart's emissive strength by day and at full night (in place of its
 * night_emissive strength, 4, which blew it out to white and hid the energy):
 * the energy inside is the bright part now, the heart its cyan glass.
 */
export const LANTERN_DAY_GLOW = 0.4;
export const LANTERN_NIGHT_GLOW = 0.3;
/** The heart's opacity: a glass tube the energy shows through. */
export const LANTERN_HEART_OPACITY = 0.75;

/** "Lantern Lines" cyan (lab defaults: hue 186, sat 0.9, lit 0.55). */
const ENERGY_HUE = 186 / 360;
const ENERGY_SAT = 0.9;
const ENERGY_LIT = 0.55;
/** Energy intensity (the lab's uI) by day and at full night; the lab's own night (1.65) is calmed down here. */
export const ENERGY_DAY_I = 1.1;
export const ENERGY_NIGHT_I = 1.3;

/** Spans up the heart, evenly spaced in azimuth, each twisting this far (radians) from bottom to top. */
export const ENERGY_SPANS = 3;
const SPAN_TWIST = Math.PI * 0.75;
/** Fraction of the heart's height left clear at each end. */
const SPAN_END_MARGIN = 0.05;
/**
 * Curtain height H as a fraction of the heart's inner radius. Each span's bright
 * edge runs SPAN_EDGE_OFFSET·H off the axis (opposite its up curtains), so the
 * curtains cross the axis and fill the tube: up to 0.47 H on one side, 0.91 H on
 * the other.
 */
const SPAN_H_OF_RADIUS = 0.95;
const SPAN_EDGE_OFFSET = -0.45;
/** Segments along each curtain (one row across). */
export const CURTAIN_SEGMENTS = 64;
/** Fold (lab wa / wf / ws, already halved / scaled as waveSpan does), pulses and aberration. */
const FOLD_AMP_OF_H = 0.12;
const FOLD_FREQ = 3;
const FOLD_SPEED = 0.36;
/** Pulses per span (lab pf) and pulse speed (ps): runes ride them at PULSE_SPEED / PULSES spans per second. */
export const PULSES = 20;
export const PULSE_SPEED = 1.5;
const ABERRATION = 0.3;
/** Ray frequency along the span: the lab's 70 is pixel-fine at the Lantern's distance. */
const RAY_FREQ = 28;

/** Runes per span, rune size as a fraction of the span length, and boxes per rune at most. */
export const RUNES_PER_SPAN = 4;
const RUNE_SIZE_OF_LENGTH = 0.07;
export const RUNE_CAP = 56;
/** Rune morph beats per second (the lab's MORPH rate without audio). */
export const MORPH_RATE = 0.85;

export type HeartBounds = {
	/** Axis position (x, z) and the heart's vertical extent. */
	centre: Vec3;
	bottom: number;
	top: number;
	/** Horizontal half-size of the heart (its outer radius). */
	radius: number;
};

/** Bounds of the heart from its world-space box: a vertical cylinder. */
export function heartBounds(box: THREE.Box3): HeartBounds {
	const c = box.getCenter(new THREE.Vector3());
	return {
		centre: [c.x, c.y, c.z],
		bottom: box.min.y,
		top: box.max.y,
		radius: Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2
	};
}

/** The heart meshes (under the night_nodes Lantern nodes, using LANTERN_HEART_MATERIAL) and everything else under those nodes. */
export function findLanternHeart(
	root: THREE.Object3D,
	nightNodes: HeroProps['night_nodes']
): { heart: THREE.Mesh[]; others: THREE.Mesh[]; bounds: HeartBounds } | null {
	const heart: THREE.Mesh[] = [];
	const others: THREE.Mesh[] = [];
	for (const name of nightNodes[LANTERN_HEART_MATERIAL] ?? []) {
		root.getObjectByName(name)?.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			(mats.some((m) => m.name === LANTERN_HEART_MATERIAL) ? heart : others).push(mesh);
		});
	}
	if (heart.length === 0) return null;
	root.updateMatrixWorld(true);
	const box = new THREE.Box3();
	for (const m of heart) box.expandByObject(m);
	return { heart, others, bounds: heartBounds(box) };
}

/** Make the heart material a glowing glass tube: transparent, double-sided, no depth writes. */
export function prepareHeartMaterial(material: THREE.Material): void {
	material.transparent = true;
	material.opacity = LANTERN_HEART_OPACITY;
	material.side = THREE.DoubleSide;
	material.depthWrite = false;
	material.needsUpdate = true;
}

/** Heart emissive strength at day/night mix t: LANTERN_DAY_GLOW by day, LANTERN_NIGHT_GLOW at night. */
export function heartGlow(t: number): number {
	const u = Math.min(1, Math.max(0, t));
	return LANTERN_DAY_GLOW * (1 - u) + LANTERN_NIGHT_GLOW * u;
}

/** Energy intensity (uI) at mix t. */
export function energyIntensity(t: number): number {
	const u = Math.min(1, Math.max(0, t));
	return ENERGY_DAY_I * (1 - u) + ENERGY_NIGHT_I * u;
}

/**
 * Cut the Lantern's other meshes (the stone shaft up its middle) away inside the
 * heart: each mesh gets its own material clone that discards fragments inside
 * the heart's cylinder, a little in from its ends. No extra draw calls.
 */
export function clipInsideHeart(meshes: readonly THREE.Mesh[], b: HeartBounds): void {
	const clip = new THREE.Vector4(b.centre[0], b.centre[2], b.bottom + 2, b.top - 2);
	const radius = b.radius;
	const clones = new Map<THREE.Material, THREE.Material>();
	for (const mesh of meshes) {
		const swap = (m: THREE.Material): THREE.Material => {
			let c = clones.get(m);
			if (!c) {
				c = m.clone();
				c.onBeforeCompile = (shader) => {
					shader.uniforms.uLanternClip = { value: clip };
					shader.uniforms.uLanternClipR = { value: radius };
					shader.vertexShader = shader.vertexShader
						.replace('#include <common>', '#include <common>\nvarying vec3 vLanternW;')
						.replace(
							'#include <project_vertex>',
							'#include <project_vertex>\nvLanternW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
						);
					shader.fragmentShader = shader.fragmentShader
						.replace(
							'#include <common>',
							'#include <common>\nvarying vec3 vLanternW;\nuniform vec4 uLanternClip;\nuniform float uLanternClipR;'
						)
						.replace(
							'#include <clipping_planes_fragment>',
							'#include <clipping_planes_fragment>\nif (vLanternW.y > uLanternClip.z && vLanternW.y < uLanternClip.w && length(vLanternW.xz - uLanternClip.xy) < uLanternClipR) discard;'
						);
				};
				c.customProgramCacheKey = () => 'lantern-clip';
				clones.set(m, c);
			}
			return c;
		};
		mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
	}
}

// ---------------------------------------------------------------- runes

/** Mulberry32, as the lab's rng(). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Pt = [number, number];
type Bond = [number, number, number?];
type Template = { p: Pt[]; b: Bond[]; ring?: number };

const PI = Math.PI;
const poly = (k: number, rad: number, rot: number, cx = 0, cy = 0): Pt[] =>
	Array.from({ length: k }, (_, i) => {
		const a = rot + (i / k) * PI * 2;
		return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
	});
const loop = (k: number): Bond[] => Array.from({ length: k }, (_, i) => [i, (i + 1) % k]);

/** The lab's rune templates: skeletal molecules in unit coords. */
const RUNES: (() => Template)[] = [
	() => ({ p: poly(6, 0.42, PI / 2), b: loop(6), ring: 6 }),
	() => ({ p: poly(5, 0.42, PI / 2), b: loop(5), ring: 5 }),
	() => ({ p: poly(4, 0.36, PI / 4), b: loop(4), ring: 4 }),
	() => ({ p: poly(7, 0.44, PI / 2), b: loop(7), ring: 7 }),
	() => ({
		p: poly(6, 0.26, PI / 2, -0.225, 0).concat([
			[0.225, 0.26],
			[0.225, -0.26],
			[0.45, -0.13],
			[0.45, 0.13]
		]),
		b: loop(6).concat([
			[6, 5],
			[4, 7],
			[7, 8],
			[8, 9],
			[9, 6]
		]),
		ring: 6
	}),
	() => ({
		p: poly(6, 0.28, 0).concat([
			[-0.48, 0],
			[0.48, 0]
		]),
		b: loop(6).concat([
			[3, 6],
			[0, 7]
		]),
		ring: 6
	}),
	() => ({
		p: [
			[-0.45, -0.15],
			[-0.15, 0.15],
			[0.15, -0.15],
			[0.45, 0.15]
		],
		b: [
			[0, 1],
			[1, 2],
			[2, 3]
		]
	}),
	() => ({
		p: [
			[-0.45, -0.15],
			[-0.15, 0.15],
			[0.15, -0.15],
			[0.45, 0.15],
			[-0.15, 0.45]
		],
		b: [
			[0, 1],
			[1, 2],
			[2, 3],
			[1, 4, 2]
		]
	}),
	() => ({
		p: [
			[-0.45, -0.12],
			[-0.18, 0.1],
			[0.18, 0.1],
			[0.45, -0.12]
		],
		b: [
			[0, 1],
			[1, 2, 3],
			[2, 3]
		]
	}),
	() => ({
		p: [
			[0, 0],
			[0, 0.45],
			[-0.4, -0.24],
			[0.4, -0.24]
		],
		b: [
			[0, 1],
			[0, 2],
			[0, 3]
		]
	}),
	() => ({
		p: [
			[0, 0],
			[0, 0.45],
			[-0.45, 0],
			[0.45, 0],
			[0, -0.45]
		],
		b: [
			[0, 1],
			[0, 2],
			[0, 3],
			[0, 4]
		]
	}),
	() => ({
		p: [
			[0, 0],
			[-0.42, 0.24],
			[-0.42, -0.24],
			[0.42, 0.24],
			[0.42, -0.24]
		],
		b: [
			[0, 1],
			[1, 2],
			[2, 0],
			[0, 3],
			[3, 4],
			[4, 0]
		]
	}),
	() => ({
		p: poly(6, 0.3, PI / 2, 0, -0.12).concat([[0, 0.45]]),
		b: loop(6).concat([[0, 6]]),
		ring: 6
	}),
	() => ({
		p: poly(3, 0.3, PI / 2, -0.1, -0.08).concat([[0.45, -0.23]]),
		b: loop(3).concat([[2, 3]]),
		ring: 3
	})
];

export type Molecule = {
	/** Atoms in unit coords (within ±0.48). */
	p: Pt[];
	/** Bonds [i, j, order 1..3]. */
	b: [number, number, number][];
	/** Per atom: 0 hidden, 1 carbon, 2 heavy. */
	size: number[];
	/** Atom indices in angle order around the centre. */
	order: number[];
	c: Pt;
};

/** A random molecule (the lab's molecule()). */
export function molecule(r: () => number): Molecule {
	const R = RUNES[Math.floor(r() * RUNES.length)]();
	const fx = r() < 0.5 ? -1 : 1;
	const fy = r() < 0.3 ? -1 : 1;
	const rs = R.ring ?? 0;
	const q: Pt[] = R.p.map(([x, y]) => [x * fx, y * fy]);
	const b: Bond[] = R.b.map((e) => e.slice() as Bond);
	if (rs && r() < 0.55) {
		const ux = q.slice(0, rs).reduce((a, v) => a + v[0], 0) / rs;
		const uy = q.slice(0, rs).reduce((a, v) => a + v[1], 0) / rs;
		const used: Record<number, boolean> = {};
		for (let k = 0, m = r() < 0.4 ? 2 : 1; k < m; k++) {
			const i = Math.floor(r() * rs);
			if (used[i]) continue;
			used[i] = true;
			const dx = q[i][0] - ux;
			const dy = q[i][1] - uy;
			const L = Math.hypot(dx, dy) || 1;
			q.push([q[i][0] + (dx / L) * 0.24, q[i][1] + (dy / L) * 0.24]);
			b.push([i, q.length - 1, r() < 0.3 ? 2 : 1]);
		}
	}
	const ext = Math.max(...q.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
	const sc = Math.min(1, 0.48 / ext);
	const p: Pt[] = q.map(([x, y]) => [x * sc, y * sc]);
	const aromatic = rs >= 5 && r() < 0.45;
	const skel = r() < 0.35;
	const deg = p.map(() => 0);
	const bonds = b.map((e, k): [number, number, number] => {
		deg[e[0]]++;
		deg[e[1]]++;
		let o = e[2];
		if (!o) {
			const z = r();
			o = aromatic && k < rs ? (k % 2 === 0 ? 2 : 1) : z < 0.06 && k >= rs ? 3 : z < 0.22 ? 2 : 1;
		}
		return [e[0], e[1], o];
	});
	const size = p.map((_, i) =>
		r() < (deg[i] === 1 ? 0.38 : 0.12) ? 2 : skel && deg[i] > 1 ? 0 : 1
	);
	const cx = p.reduce((a, v) => a + v[0], 0) / p.length;
	const cy = p.reduce((a, v) => a + v[1], 0) / p.length;
	const order = p
		.map((_, i) => i)
		.sort(
			(i, j) => Math.atan2(p[i][1] - cy, p[i][0] - cx) - Math.atan2(p[j][1] - cy, p[j][0] - cx)
		);
	return { p, b: bonds, size, order, c: [cx, cy] };
}

/** The molecule rune `rune` shows on morph beat `beat` (deterministic, so scrubbing and reduced motion agree). */
export function moleculeAt(rune: number, beat: number): Molecule {
	return molecule(rng((Math.imul(rune + 1, 0x9e3779b1) ^ Math.imul(beat, 0x85ebca6b)) >>> 0));
}

/** Morph in the first 35% of a beat, then hold. */
export function morphEase(f: number): number {
	const x = Math.min(1, f / 0.35);
	return x * x * (3 - 2 * x);
}

/** One box of a rune: centre (x, y), angle about z, size (sx, sy, sz), in the rune's plane. */
export type RuneBox = (
	x: number,
	y: number,
	ang: number,
	sx: number,
	sy: number,
	sz: number
) => void;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The lab's drawMorph(): molecule A morphing into B at e (0..1), size s and
 * stroke t, as boxes passed to `put` (atoms as diamonds, bonds as strokes, A's
 * bonds thinning out while B's thicken). Returns the number of boxes.
 */
export function drawMorph(
	put: RuneBox,
	A: Molecule,
	B: Molecule,
	e: number,
	s: number,
	t: number,
	cap = RUNE_CAP
): number {
	const N = Math.max(A.p.length, B.p.length);
	const pos: Pt[] = [];
	const firstA: Record<number, number> = {};
	const firstB: Record<number, number> = {};
	let n = 0;
	const box = (x: number, y: number, ang: number, sx: number, sy: number): void => {
		if (n >= cap || sx <= 1e-4 || sy <= 1e-4) return;
		put(x, y, ang, sx, sy, Math.min(sy, t) * 1.4);
		n++;
	};
	for (let k = 0; k < N; k++) {
		const ia = A.order[Math.floor((k * A.p.length) / N)];
		const ib = B.order[Math.floor((k * B.p.length) / N)];
		if (firstA[ia] === undefined) firstA[ia] = k;
		if (firstB[ib] === undefined) firstB[ib] = k;
		pos.push([lerp(A.p[ia][0], B.p[ib][0], e) * s, lerp(A.p[ia][1], B.p[ib][1], e) * s]);
		const sa = firstA[ia] === k ? A.size[ia] : 0;
		const sb = firstB[ib] === k ? B.size[ib] : 0;
		const sz = lerp(sa, sb, e);
		if (sz > 0.01) {
			const a = t * lerp(0, 1.8, Math.min(sz, 1)) + t * 0.8 * Math.max(0, sz - 1);
			box(pos[k][0], pos[k][1], PI / 4, a, a);
		}
	}
	const strokes = (M: Molecule, first: Record<number, number>, w: number): void => {
		if (w <= 0.02) return;
		const cx = lerp(A.c[0], B.c[0], e) * s;
		const cy = lerp(A.c[1], B.c[1], e) * s;
		for (const [i, j, o] of M.b) {
			const [x1, y1] = pos[first[i]];
			const [x2, y2] = pos[first[j]];
			const L = Math.hypot(x2 - x1, y2 - y1);
			if (L < 1e-4) continue;
			const ang = Math.atan2(y2 - y1, x2 - x1);
			box((x1 + x2) / 2, (y1 + y2) / 2, ang, L, t * w);
			if (o < 2) continue;
			const nx = -(y2 - y1) / L;
			const ny = (x2 - x1) / L;
			const off = t * 2.8 * ((cx - (x1 + x2) / 2) * nx + (cy - (y1 + y2) / 2) * ny >= 0 ? 1 : -1);
			for (const f of o === 3 ? [1, -1] : [1])
				box((x1 + x2) / 2 + nx * off * f, (y1 + y2) / 2 + ny * off * f, ang, L * 0.64, t * 0.8 * w);
		}
	};
	strokes(A, firstA, 1 - e);
	strokes(B, firstB, e);
	return n;
}

/** Pulse phase of span s: the spans' pulses (and runes) are staggered by a third of a crest, so the runes don't line up. */
export function spanPulsePhase(span: number): number {
	return (-2 * PI * span) / ENERGY_SPANS;
}

/**
 * Where rune k of span `span` is at time t: u along the span (0..1; hidden past
 * 1), riding pulse crest k (sin(u·PULSES − t·PULSE_SPEED + spanPulsePhase) = 1)
 * at PULSE_SPEED / PULSES spans per second and wrapping after a whole number of
 * crests, and its fade (the lab's uA).
 */
export function runeTrack(
	k: number,
	t: number,
	span = 0
): { u: number; visible: boolean; alpha: number } {
	const gap = (2 * PI) / PULSES;
	const P = gap * Math.max(RUNES_PER_SPAN, Math.ceil(PULSES / (2 * PI)) + 1);
	const ph = (PI / 2 - spanPulsePhase(span)) / PULSES + k * gap;
	const u = ((((PULSE_SPEED / PULSES) * t + ph) % P) + P) % P;
	const alpha = Math.sin(PI * Math.min(u, 1)) * (0.6 + 0.4 * Math.sin(t * 1.3 + k * 2.1 + span));
	return { u, visible: u < 1, alpha: Math.max(0, alpha) };
}

// ---------------------------------------------------------------- spans

/** A span's frame at u (0..1 up the heart): `across` points out from the axis (curtain "up"), `normal` = up × across. */
export function spanAngle(span: number, u: number): number {
	return (span / ENERGY_SPANS) * 2 * PI + SPAN_TWIST * (u - 0.5);
}

export type SpanLayout = {
	/** Span length (m) and its bottom, relative to the heart centre. */
	length: number;
	y0: number;
	/** Curtain height H (m). */
	H: number;
};

export function spanLayout(b: HeartBounds): SpanLayout {
	const height = b.top - b.bottom;
	const length = height * (1 - 2 * SPAN_END_MARGIN);
	// The heart tapers a little; the inner radius stays clear of the wall.
	const inner = b.radius * 0.9;
	return { length, y0: -length / 2, H: inner * SPAN_H_OF_RADIUS };
}

/**
 * The lab's four curtains per span (waveSpan: two up, two flipped down), in
 * span coords: x0/len along the span (fractions of its length), yc/h across
 * (fractions of H, edge at 0), z off the plane (fraction of H), with the
 * per-curtain a, ph, sk, ro and flip.
 */
const CURTAINS = [
	{ x0: 0, len: 1, yc: 0.42, h: 1, z: 0, a: 1, ph: 0, sk: 0.5, ro: 0, flip: 1 },
	{ x0: 0, len: 0.92, yc: 0.345, h: 0.81, z: -0.125, a: 0.6, ph: 2.1, sk: 0.3, ro: 2.0, flip: 1 },
	{ x0: -0.06, len: 0.85, yc: -0.21, h: 0.5, z: 0, a: 1, ph: 1.3, sk: -0.7, ro: 4.1, flip: -1 },
	{
		x0: -0.06,
		len: 0.782,
		yc: -0.17,
		h: 0.405,
		z: -0.125,
		a: 0.6,
		ph: 3.4,
		sk: -0.5,
		ro: 5.3,
		flip: -1
	}
] as const;

/** All curtains of all spans as one geometry, relative to the heart centre. */
export function buildCurtainGeometry(b: HeartBounds): THREE.BufferGeometry {
	const { length, y0, H } = spanLayout(b);
	const seg = CURTAIN_SEGMENTS;
	const perCurtain = (seg + 1) * 2;
	const count = ENERGY_SPANS * CURTAINS.length * perCurtain;
	const pos = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const fold = new Float32Array(count * 3);
	const params = new Float32Array(count * 4);
	const phase = new Float32Array(count);
	const index: number[] = [];
	let v = 0;
	for (let s = 0; s < ENERGY_SPANS; s++) {
		for (const c of CURTAINS) {
			const base = v;
			for (let i = 0; i <= seg; i++) {
				const ux = i / seg;
				// Along the span: the curtain's own x, as a fraction of the span from its bottom.
				const su = 0.5 + c.x0 + (ux - 0.5) * c.len;
				const ang = spanAngle(s, su);
				const ax = Math.cos(ang);
				const az = Math.sin(ang);
				// normal = up × across
				const nx = az;
				const nz = -ax;
				for (let j = 0; j <= 1; j++) {
					// uv.y runs from the bright edge outward; a flipped curtain runs the other way.
					const across = (SPAN_EDGE_OFFSET + c.yc + c.flip * (j - 0.5) * c.h) * H;
					const off = c.z * H;
					pos[v * 3] = ax * across + nx * off;
					pos[v * 3 + 1] = y0 + su * length;
					pos[v * 3 + 2] = az * across + nz * off;
					uv[v * 2] = ux;
					uv[v * 2 + 1] = j;
					fold[v * 3] = nx;
					fold[v * 3 + 1] = 0;
					fold[v * 3 + 2] = nz;
					params.set([c.a, c.ph, c.sk, c.ro], v * 4);
					phase[v] = spanPulsePhase(s);
					v++;
				}
			}
			for (let i = 0; i < seg; i++) {
				const a = base + i * 2;
				index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	g.setAttribute('aFold', new THREE.BufferAttribute(fold, 3));
	g.setAttribute('aCurtain', new THREE.BufferAttribute(params, 4));
	g.setAttribute('aPulse', new THREE.BufferAttribute(phase, 1));
	g.setIndex(index);
	g.computeBoundingSphere();
	return g;
}

// ---------------------------------------------------------------- shaders

const CURTAIN_VS = /* glsl */ `
uniform float uT; uniform float uWa; uniform float uWf; uniform float uWs;
attribute vec3 aFold; attribute vec4 aCurtain; attribute float aPulse;
varying vec2 vUv; varying vec4 vCurtain; varying float vPulse;
void main() {
	vUv = uv; vCurtain = aCurtain; vPulse = aPulse;
	vec3 p = position + aFold * uWa * sin(uv.x * uWf + aCurtain.y - uT * uWs) * sin(3.14159265 * uv.x);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

/** The lab's aurora (mode 2) without audio or agitation: uSk / uRo / uA come per curtain. */
const CURTAIN_FS = /* glsl */ `
uniform vec3 uColor; uniform float uI; uniform float uT; uniform float uN;
uniform float uPf; uniform float uPs; uniform float uAb; uniform float uRf;
varying vec2 vUv; varying vec4 vCurtain; varying float vPulse;
float aur(vec2 q) {
	float sk = vCurtain.z, ro = vCurtain.w;
	float yb = 0.08 + 0.05 * sin(q.x * 7.0 + uT * 0.8) + 0.03 * sin(q.x * 17.0 - uT * 1.3);
	float d = q.y - yb;
	float body = d < 0.0 ? exp(d * 45.0) : (0.35 + 0.65 * exp(-d * 9.0)) * exp(-d * 1.6) * (1.0 - smoothstep(0.65, 1.0, q.y));
	body *= 1.0 + sk * (q.x - 0.5);
	float rays = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(q.x * uRf + ro + 3.0 * sin(q.x * 9.0 + uT * 0.6 + ro) - uT * 0.5), 3.0);
	float pulse = 0.75 + 0.5 * pow(0.5 + 0.5 * sin(q.x * uPf - uT * uPs + vPulse), 4.0);
	float ends = smoothstep(0.0, 0.1, q.x) * (1.0 - smoothstep(0.9, 1.0, q.x));
	return body * rays * pulse * ends;
}
void main() {
	vec2 ab = vec2(0.02, 0.012) * uAb;
	float ir = aur(vUv + ab), ig = aur(vUv), ib = aur(vUv - ab);
	vec3 col = mix(uColor, vec3(0.62, 0.22, 0.95), smoothstep(0.3, 0.9, vUv.y));
	vec3 split = max(vec3(ir, ig, ib) - ig, 0.0);
	vec3 c = uI * (1.8 * col * ig + 1.2 * split);
	float a = clamp(max(ir, max(ig, ib)) * 1.3, 0.0, 1.0);
	gl_FragColor = vec4(c, clamp(a * vCurtain.x * mix(0.8, 1.0, uN) * min(1.0, uI), 0.0, 1.0));
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

const RUNE_VS = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
	vAlpha = aAlpha;
	gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

/** The lab's white-hot rune (mode 4). */
const RUNE_FS = /* glsl */ `
uniform vec3 uColor; uniform float uI; uniform float uN;
varying float vAlpha;
void main() {
	float p = 1.7;
	float a = clamp((uI - 0.4) / 0.8, 0.0, 1.0);
	vec3 c = uColor * uI * p;
	c = mix(c, vec3(1.0), clamp((uI * p - 1.1) * 0.35, 0.0, 0.5));
	gl_FragColor = vec4(c, clamp(a * vAlpha * mix(0.8, 1.0, uN) * min(1.0, uI), 0.0, 1.0));
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- energy

export type LanternEnergy = {
	object: THREE.Group;
	/** Move the curtains and runes to time t (s). */
	update(t: number): void;
	/** Day/night mix 0..1. */
	setNight(t: number): void;
	/** Rune boxes drawn by the last update. */
	runeBoxes(): number;
	dispose(): void;
};

/** The spans and runes inside the heart (draw them after it: renderOrder 1). */
export function createLanternEnergy(b: HeartBounds): LanternEnergy {
	const layout = spanLayout(b);
	const { length, y0, H } = layout;
	const shared = {
		uColor: { value: new THREE.Color().setHSL(ENERGY_HUE, ENERGY_SAT, ENERGY_LIT) },
		uI: { value: ENERGY_DAY_I },
		uT: { value: 0 },
		uN: { value: 0 }
	};
	const curtainMaterial = new THREE.ShaderMaterial({
		uniforms: {
			...shared,
			uWa: { value: FOLD_AMP_OF_H * H },
			uWf: { value: FOLD_FREQ },
			uWs: { value: FOLD_SPEED },
			uPf: { value: PULSES },
			uPs: { value: PULSE_SPEED },
			uAb: { value: ABERRATION },
			uRf: { value: RAY_FREQ }
		},
		vertexShader: CURTAIN_VS,
		fragmentShader: CURTAIN_FS,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending
	});
	const curtains = new THREE.Mesh(buildCurtainGeometry(b), curtainMaterial);
	curtains.name = 'LanternEnergyCurtains';
	curtains.renderOrder = 1;

	const runeCount = ENERGY_SPANS * RUNES_PER_SPAN;
	const cap = runeCount * RUNE_CAP;
	const box = new THREE.BoxGeometry(1, 1, 1);
	const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
	box.setAttribute('aAlpha', alpha);
	const runeMaterial = new THREE.ShaderMaterial({
		uniforms: shared,
		vertexShader: RUNE_VS,
		fragmentShader: RUNE_FS,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide
	});
	const runes = new THREE.InstancedMesh(box, runeMaterial, cap);
	runes.name = 'LanternEnergyRunes';
	runes.renderOrder = 1;
	runes.count = 0;
	// Cull with the heart's sphere instead of recomputing one from the moving instances.
	runes.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(length / 2, b.radius));

	const object = new THREE.Group();
	object.name = 'LanternEnergy';
	object.position.set(...b.centre);
	object.add(curtains, runes);

	const rs = RUNE_SIZE_OF_LENGTH * length;
	const stroke = rs * 0.108;
	const cache = new Map<string, Molecule>();
	const mol = (rune: number, beat: number): Molecule => {
		const key = `${rune}:${beat}`;
		let m = cache.get(key);
		if (!m) {
			if (cache.size > 64) cache.clear();
			m = moleculeAt(rune, beat);
			cache.set(key, m);
		}
		return m;
	};
	const base = new THREE.Matrix4();
	const local = new THREE.Matrix4();
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const p = new THREE.Vector3();
	const sc = new THREE.Vector3();
	const zAxis = new THREE.Vector3(0, 0, 1);
	const ex = new THREE.Vector3(0, 1, 0);
	const ey = new THREE.Vector3();
	const ez = new THREE.Vector3();
	let boxes = 0;

	const update = (t: number): void => {
		curtainMaterial.uniforms.uT.value = t;
		const phase = t * MORPH_RATE;
		let n = 0;
		for (let s = 0; s < ENERGY_SPANS; s++) {
			for (let k = 0; k < RUNES_PER_SPAN; k++) {
				const track = runeTrack(k, t, s);
				if (!track.visible || track.alpha <= 0.002) continue;
				const id = s * RUNES_PER_SPAN + k;
				const lag = k * 0.06;
				const bp = phase - lag;
				const nb = Math.floor(bp);
				// Span frame at the rune: x along the span (up), y out from the axis, z its normal; the lab's
				// rune group sits at -0.05 H (the edge is at 0.07 H above it) and 0.04 H off the plane.
				const ang = spanAngle(s, track.u);
				ey.set(Math.cos(ang), 0, Math.sin(ang));
				ez.crossVectors(ex, ey);
				base.makeBasis(ex, ey, ez);
				const out = (SPAN_EDGE_OFFSET + 0.02) * H;
				base.setPosition(
					ey.x * out + ez.x * 0.04 * H,
					y0 + track.u * length,
					ey.z * out + ez.z * 0.04 * H
				);
				drawMorph(
					(x, y, a, sx, sy, sz) => {
						local.compose(p.set(x, y, 0), q.setFromAxisAngle(zAxis, a), sc.set(sx, sy, sz));
						runes.setMatrixAt(n, m.multiplyMatrices(base, local));
						alpha.setX(n, track.alpha);
						n++;
					},
					mol(id, nb),
					mol(id, nb + 1),
					morphEase(bp - nb),
					rs,
					stroke,
					Math.min(RUNE_CAP, cap - n)
				);
			}
		}
		boxes = n;
		runes.count = n;
		runes.instanceMatrix.needsUpdate = true;
		alpha.needsUpdate = true;
	};

	const setNight = (t: number): void => {
		shared.uI.value = energyIntensity(t);
		shared.uN.value = Math.min(1, Math.max(0, t));
	};

	const dispose = (): void => {
		curtains.geometry.dispose();
		curtainMaterial.dispose();
		box.dispose();
		runeMaterial.dispose();
		runes.dispose();
		object.clear();
	};

	update(0);
	return { object, update, setNight, runeBoxes: () => boxes, dispose };
}
