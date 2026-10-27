import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	MINIBOT_DODGE_FAR,
	MINIBOT_DODGE_R,
	MINIBOT_HEIGHT,
	MINIBOT_LANE_MAX,
	MINIBOT_SPREAD,
	MINIBOT_TALK_HEIGHT,
	bakeVariant,
	boneRows,
	createMinibots,
	dodgeOffset,
	minibotPose,
	pathPlace,
	planMinibots,
	skinBaked,
	texelAt
} from './minibots.ts';
import { walkerPose, type ConvoMember, type Walker } from './people.ts';
import type { RobotMeta } from './robot.ts';
import type { Vec3 } from './props.ts';

const META: RobotMeta = {
	version: 2,
	height: 4,
	walk_cycle_m: 3.6,
	walk_duration_s: 1.2,
	idle_duration_s: 1.3,
	palettes: ['p0', 'p1', 'p2', 'p3'],
	variants: [
		{ name: 'ROBOT_V0', height: 4, walk_cycle_m: 3.6 },
		{ name: 'ROBOT_V1', height: 4.1, walk_cycle_m: 3.7 },
		{ name: 'ROBOT_V2', height: 3.9, walk_cycle_m: 3.5 }
	]
};
const PATHS: Vec3[][] = [
	[
		[0, 0, 0],
		[0, 0, -100]
	],
	[
		[10, 0.6, 0],
		[10, 0.6, -80]
	]
];
const SLOTS: ConvoMember[] = [
	{ variant: 0, scale: 1, position: [3, 0.2, -5], heading: 1 },
	{ variant: 1, scale: 1, position: [-4, 0.2, -9], heading: -2 }
];

test('planMinibots: seeded walkers at a stride-matched walking pace, then one per conversation slot', () => {
	const a = planMinibots(PATHS, 6, SLOTS, META);
	assert.deepEqual(a, planMinibots(PATHS, 6, SLOTS, META));
	assert.equal(a.length, 8);
	const walkers = a.filter((b) => b.kind === 'walk');
	assert.equal(walkers.length, 6);
	assert.deepEqual(
		walkers.map((b) => b.path),
		[0, 1, 0, 1, 0, 1]
	);
	for (const b of walkers) {
		assert.ok(b.height >= MINIBOT_HEIGHT[0] && b.height <= MINIBOT_HEIGHT[1], `${b.height} m`);
		const v = META.variants[b.variant];
		assert.ok(Math.abs(b.scale - b.height / v.height) < 1e-12);
		// The walk clip plays at its own rate: one loop of the scaled stride per walk_duration_s.
		assert.ok(Math.abs(b.speed - (v.walk_cycle_m * b.scale) / META.walk_duration_s) < 1e-12);
		assert.ok(b.speed > 0.8 && b.speed < 1.5, `${b.speed} m/s`);
		assert.ok(Math.abs(b.offset) <= MINIBOT_SPREAD);
	}
	// Each path's bots spread over its there-and-back cycle, not bunched.
	const s0 = walkers.filter((b) => b.path === 0).map((b) => b.s0);
	assert.ok(Math.max(...s0) - Math.min(...s0) > 50, `${s0}`);
	// Every variant and palette before any repeats.
	assert.equal(new Set(a.slice(0, 3).map((b) => b.variant)).size, 3);
	assert.equal(new Set(a.slice(0, 4).map((b) => b.palette)).size, 4);
	const talkers = a.filter((b) => b.kind === 'talk');
	talkers.forEach((b, k) => {
		assert.deepEqual(b.position, SLOTS[k].position);
		assert.equal(b.heading, SLOTS[k].heading);
		assert.ok(b.height >= MINIBOT_TALK_HEIGHT[0] && b.height <= MINIBOT_TALK_HEIGHT[1]);
		assert.ok(b.phase >= 0 && b.phase < META.idle_duration_s!);
	});
	// Only the variants offered, and nothing to walk without paths.
	assert.ok(planMinibots(PATHS, 6, [], META, [2]).every((b) => b.variant === 2));
	assert.equal(planMinibots([], 6, SLOTS, META).length, 2);
});

test('minibotPose: on its path like a person, offset to its right; standing bots stay put', () => {
	const [b] = planMinibots(PATHS, 1, [], META);
	const t = 7;
	const { position, heading } = walkerPose(PATHS[0], b.s0 + b.speed * t);
	const p = minibotPose(PATHS, b, t);
	assert.equal(p.heading, heading);
	assert.ok(Math.abs(p.position[0] - (position[0] + b.offset * Math.cos(heading))) < 1e-9);
	assert.ok(Math.abs(p.position[2] - (position[2] - b.offset * Math.sin(heading))) < 1e-9);
	const [s] = planMinibots(PATHS, 0, SLOTS, META);
	assert.deepEqual(minibotPose(PATHS, s, 99), {
		position: SLOTS[0].position,
		heading: SLOTS[0].heading
	});
});

test('pathPlace: ping-pong on an open path (back on the way back), wrapping on a loop', () => {
	assert.deepEqual(pathPlace(PATHS[0], 100, 30), { along: 30, back: false });
	assert.deepEqual(pathPlace(PATHS[0], 100, 130), { along: 70, back: true });
	assert.deepEqual(pathPlace(PATHS[0], 100, -30), { along: 30, back: true });
	const loop: Vec3[] = [
		[0, 0, 0],
		[10, 0, 0],
		[10, 0, 10],
		[0, 0, 0]
	];
	const len = 20 + Math.hypot(10, 10);
	const p = pathPlace(loop, len, len + 5);
	assert.ok(Math.abs(p.along - 5) < 1e-9 && !p.back);
});

/** A person on path 0 at s0, standing still (speed 0), `offset` to its right. */
const person = (s0: number, offset: number): Walker => ({
	path: 0,
	s0,
	speed: 0,
	direction: 1,
	offset,
	scale: 1,
	color: 0,
	variant: 0
});

test('dodgeOffset: steps aside from a person close by, eased in along the path, within the lane', () => {
	const [b] = planMinibots(PATHS, 1, [], META);
	const bot = { ...b, s0: 10, speed: 1, offset: 0.1 };
	// Nobody near: its own offset.
	assert.equal(dodgeOffset(PATHS, bot, [person(60, 0.1)], 0), 0.1);
	// Someone right there, a little to its left: it steps right, to MINIBOT_DODGE_R from them.
	const near = dodgeOffset(PATHS, bot, [person(10, 0)], 0);
	assert.ok(Math.abs(near - MINIBOT_DODGE_R) < 1e-9, `${near}`);
	// Eases in: half way out it steps less; past MINIBOT_DODGE_FAR not at all.
	const mid = dodgeOffset(PATHS, bot, [person(10 + (1 + MINIBOT_DODGE_FAR) / 2, 0)], 0);
	assert.ok(mid > 0.1 && mid < near, `${mid}`);
	assert.equal(dodgeOffset(PATHS, bot, [person(10 + MINIBOT_DODGE_FAR + 0.1, 0)], 0), 0.1);
	// Squeezed from both sides: it stays within the lane.
	const crowd = [person(10, -0.3), person(10.2, -0.5), person(9.8, -0.1)];
	assert.ok(Math.abs(dodgeOffset(PATHS, bot, crowd, 0)) <= MINIBOT_LANE_MAX + 1e-12);
	// On the way back the path's sides swap, and so does its right: the same step aside, mirrored.
	const back = { ...bot, s0: 190 };
	const p = person(190, 0);
	assert.ok(Math.abs(dodgeOffset(PATHS, back, [p], 0) - MINIBOT_DODGE_R) < 1e-9);
	// Smooth in time as a person walks past.
	const passer = { ...person(0, 0.2), speed: 1.3 };
	let prev = dodgeOffset(PATHS, bot, [passer], 0);
	for (let t = 0.02; t < 20; t += 0.02) {
		const o = dodgeOffset(PATHS, bot, [passer], t);
		assert.ok(Math.abs(o - prev) < 0.05, `t ${t}: ${prev} -> ${o}`);
		prev = o;
	}
});

test('texelAt wraps rows', () => {
	assert.deepEqual(texelAt(0, 2048), [0, 0]);
	assert.deepEqual(texelAt(2049, 2048), [1, 1]);
});

/**
 * A two-bone rig (root at the origin, Arm 1 m up) skinning a box: the lower
 * half to Root, the upper to Arm. Like the quantized glb, the mesh sits off
 * the rig root, its bind matrix isn't identity and the bone inverses carry a
 * scale (the positions are stored scaled down).
 */
function fakeRig(name: string) {
	const root = new THREE.Group();
	const rootBone = new THREE.Bone();
	rootBone.name = 'Root';
	const arm = new THREE.Bone();
	arm.name = 'Arm';
	arm.position.set(0, 1, 0);
	rootBone.add(arm);
	root.add(rootBone);
	const geometry = new THREE.BoxGeometry(0.2, 2, 0.2, 1, 4, 1)
		.translate(0, 1, 0)
		.scale(0.5, 0.5, 0.5);
	const pos = geometry.getAttribute('position');
	const idx: number[] = [];
	const wts: number[] = [];
	for (let v = 0; v < pos.count; v++) {
		const up = pos.getY(v) > 0.5 ? 1 : 0;
		idx.push(up, 1 - up, 0, 0);
		wts.push(0.75, 0.25, 0, 0);
	}
	geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
	geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
	const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
	mesh.name = name;
	mesh.position.set(0.3, 0, 0);
	root.add(mesh);
	root.updateMatrixWorld(true);
	const dequant = new THREE.Matrix4().makeScale(2, 2, 2);
	const skeleton = new THREE.Skeleton([rootBone, arm]);
	skeleton.boneInverses = [rootBone, arm].map((b) =>
		b.matrixWorld
			.clone()
			.invert()
			.multiply(new THREE.Matrix4().makeTranslation(0.3, 0, 0))
			.multiply(dequant)
	);
	mesh.bind(skeleton, new THREE.Matrix4().makeRotationY(0.4));
	return { root, mesh, arm };
}

test('bakeVariant + boneRows + skinBaked skin a vertex where three puts it', () => {
	const { root, mesh, arm } = fakeRig('ROBOT_V0_LOD');
	arm.rotation.set(0.5, 0.2, -0.7);
	root.updateMatrixWorld(true);
	const baked = bakeVariant(mesh);
	assert.equal(baked.vertices, mesh.geometry.getAttribute('position').count);
	assert.equal(baked.corners.length, mesh.geometry.index!.count);
	const rows = new Float32Array(2 * 16);
	boneRows(mesh, root, rows);
	const pos = mesh.geometry.getAttribute('position');
	for (let v = 0; v < baked.vertices; v++) {
		const want = mesh.applyBoneTransform(v, new THREE.Vector3().fromBufferAttribute(pos, v));
		want.applyMatrix4(mesh.matrixWorld);
		const got = skinBaked(baked, v, rows);
		assert.ok(got.distanceTo(want) < 1e-5, `vertex ${v}: ${got.toArray()} vs ${want.toArray()}`);
	}
});

/** robot.glb's shape: full and _LOD skinned meshes per variant, walk and idle clips turning Arm. */
function fakeRobot() {
	const scene = new THREE.Group();
	for (const [k, v] of META.variants.entries()) {
		for (const name of [v.name, v.name + '_LOD']) {
			const { root } = fakeRig(name);
			root.name = `${name}_rig${k}`;
			scene.add(root);
		}
	}
	const clip = (name: string, angle: number) =>
		new THREE.AnimationClip(name, 1.2, [
			new THREE.QuaternionKeyframeTrack(
				'Arm.quaternion',
				[0, 0.6, 1.2],
				[
					...new THREE.Quaternion().toArray(),
					...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray(),
					...new THREE.Quaternion().toArray()
				]
			)
		]);
	return { scene, animations: [clip('walk', 1), clip('idle', 0.2)] };
}

test('createMinibots: one instanced mesh for all, posed per bot from the clock, frozen with it', () => {
	const { scene, animations } = fakeRobot();
	const bots = createMinibots(scene, animations, META, PATHS, SLOTS, {
		shadows: true,
		walkers: 4
	})!;
	assert.ok(bots);
	assert.equal(bots.mesh.count, 6);
	assert.ok(bots.mesh.castShadow && bots.mesh.customDepthMaterial);
	const state = bots.state();
	assert.deepEqual(
		state.map((s) => s.kind),
		['walk', 'walk', 'walk', 'walk', 'talk', 'talk']
	);
	bots.update(3.1);
	const a = JSON.stringify(bots.state());
	bots.update(3.1);
	assert.equal(JSON.stringify(bots.state()), a, 'the same time, the same pose');
	bots.update(4);
	assert.notEqual(JSON.stringify(bots.state()), a, 'walkers move on');
	assert.deepEqual(bots.state()[4].position, SLOTS[0].position);
	bots.setNight(1);
	assert.ok((bots.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity > 0);
	bots.dispose();
	// Nothing to draw without the simplified meshes, the clips or anyone to place.
	const bare = new THREE.Group();
	bare.add(fakeRig('ROBOT_V0').root);
	assert.equal(createMinibots(bare, animations, META, PATHS, SLOTS, { shadows: false }), null);
	assert.equal(createMinibots(scene, [], META, PATHS, SLOTS, { shadows: false }), null);
	assert.equal(createMinibots(scene, animations, META, [], [], { shadows: false }), null);
});
