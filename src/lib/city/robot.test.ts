import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	ROBOT_ARC_SEGMENTS,
	ROBOT_LANE,
	ROBOT_NIGHT_GLOW,
	createRobot,
	parseRobotMeta,
	robotLoop,
	robotPose,
	robotWalkTime,
	type RobotMeta
} from './robot.ts';
import { walkerPose } from './people.ts';
import type { Vec3 } from './props.ts';

const META: RobotMeta = { version: 1, height: 4, walk_cycle_m: 3.6, walk_duration_s: 1.2 };

/** Two pavements 40 m apart along −Z (like the avenue's), rising 1 m per 100 m, 400 m long. */
function pavement(x: number): Vec3[] {
	return Array.from({ length: 21 }, (_, k) => [x, 5 + k * 0.2, 1000 - k * 20] as Vec3);
}
const PATHS: Vec3[][] = [pavement(20), pavement(22), pavement(-20), pavement(-22)];

function close(a: number[], b: number[], eps = 1e-9): void {
	assert.equal(a.length, b.length);
	a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < eps, `[${k}] ${v} vs ${b[k]}`));
}

/** Smallest signed difference a − b of two angles. */
function angleDiff(a: number, b: number): number {
	return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

test('parseRobotMeta accepts the bake and rejects a bad file', () => {
	assert.deepEqual(parseRobotMeta({ ...META, idle_duration_s: 1.3 }), {
		...META,
		idle_duration_s: 1.3
	});
	assert.throws(() => parseRobotMeta(null), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, walk_cycle_m: 0 }), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, walk_duration_s: 'x' }), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, height: -1 }), /robot_meta.json/);
});

test('robotWalkTime: the walk clip advances one loop per walk_cycle_m walked, wrapping', () => {
	assert.equal(robotWalkTime(0, META), 0);
	assert.ok(Math.abs(robotWalkTime(1.8, META) - 0.6) < 1e-9);
	assert.ok(Math.abs(robotWalkTime(3.6 + 0.9, META) - 0.3) < 1e-9);
	assert.ok(Math.abs(robotWalkTime(-0.9, META) - 0.9) < 1e-9);
});

test('robotLoop: a closed loop round the avenue axis, legs at ±halfGap, without enough paths none', () => {
	assert.equal(robotLoop([pavement(20)]), null);
	const loop = robotLoop(PATHS)!;
	const first = loop[0];
	close(loop[loop.length - 1], first);
	const { start, length, halfGap } = ROBOT_LANE;
	// Out leg: from `start` m up the (gently sloping) axis (x = 0, z ≈ 1000 − start) on its right (−X walking −Z).
	close(first, [-halfGap, 5 + start * 0.01, 1000 - start], 1e-3);
	// Every point is on one leg (|x| = halfGap) or on an end arc (within halfGap of the axis end).
	for (const p of loop) {
		const onLeg = Math.abs(Math.abs(p[0]) - halfGap) < 1e-9;
		const zNear = first[2];
		const zFar = zNear - length / Math.hypot(1, 0.01);
		const onArc =
			Math.abs(Math.hypot(p[0], p[2] - zNear) - halfGap) < 1e-6 ||
			Math.abs(Math.hypot(p[0], p[2] - zFar) - halfGap) < 1e-6;
		assert.ok(onLeg || onArc, `${p}`);
		assert.ok(p[2] <= zNear + halfGap + 1e-6 && p[2] >= zFar - halfGap - 1e-6, `${p}`);
	}
	// Two legs of a point every `step` and two arcs.
	assert.equal(loop.length, 2 * (length / ROBOT_LANE.step + 1 + ROBOT_ARC_SEGMENTS - 1) + 1);
	// The legs stay on the ground the paths give (y rises 0.01 m per m along the axis).
	const mid = loop.find((p) => p[0] > 0 && Math.abs(p[2] - (1000 - start - length / 2)) < 15)!;
	assert.ok(Math.abs(mid[1] - (5 + (1000 - mid[2]) * 0.01)) < 1e-9);
});

test('robotPose: on a straight leg it matches walkerPose, round the arcs its heading turns smoothly', () => {
	const loop = robotLoop(PATHS)!;
	const { length, halfGap } = ROBOT_LANE;
	const s = length / 2;
	const pose = robotPose(loop, s);
	const plain = walkerPose(loop, s);
	close(pose.position, plain.position);
	assert.ok(Math.abs(angleDiff(pose.heading, plain.heading)) < 1e-9);
	// Facing −Z on the out leg.
	close([Math.sin(pose.heading), Math.cos(pose.heading)], [0, -1], 1e-9);
	// All the way round in 0.25 m steps: the heading never jumps.
	const perimeter = 2 * length + 2 * Math.PI * halfGap;
	let prev = robotPose(loop, 0).heading;
	let maxStep = 0;
	for (let d = 0.25; d <= perimeter + 1; d += 0.25) {
		const h = robotPose(loop, d).heading;
		maxStep = Math.max(maxStep, Math.abs(angleDiff(h, prev)));
		prev = h;
	}
	// A circle of radius halfGap turns 0.25 / halfGap rad per 0.25 m; allow some slack for the polygon.
	assert.ok(maxStep < (0.25 / halfGap) * 1.5, `max heading step ${maxStep}`);
});

/** A stand-in robot.glb scene: a skinned box on a two-bone rig and a 'walk' clip turning the child bone. */
function fakeRobot(): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
	const scene = new THREE.Group();
	const root = new THREE.Bone();
	const knee = new THREE.Bone();
	knee.name = 'knee';
	knee.position.y = 1;
	root.add(knee);
	const geometry = new THREE.BoxGeometry(1, 2, 1);
	const count = geometry.getAttribute('position').count;
	geometry.setAttribute(
		'skinIndex',
		new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4)
	);
	geometry.setAttribute(
		'skinWeight',
		new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4)
	);
	const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
	mesh.add(root);
	mesh.bind(new THREE.Skeleton([root, knee]));
	scene.add(mesh);
	const track = new THREE.NumberKeyframeTrack('knee.position[y]', [0, 0.6, 1.2], [1, 2, 1]);
	return { scene, animations: [new THREE.AnimationClip('walk', 1.2, [track])] };
}

test('createRobot walks the loop at walk_cycle_m / walk_duration_s and plays the walk from the distance', () => {
	const { scene, animations } = fakeRobot();
	const robot = createRobot(scene, animations, META, PATHS, { shadows: true })!;
	assert.ok(robot);
	const loop = robotLoop(PATHS)!;
	const speed = META.walk_cycle_m / META.walk_duration_s;
	const knee = scene.getObjectByName('knee')!;
	for (const t of [0, 0.3, 7.25]) {
		robot.update(t);
		const s = robot.s0 + speed * t;
		close(robot.object.position.toArray(), robotPose(loop, s).position, 1e-6);
		// The knee track at the clip time robotWalkTime gives for that distance (0 → 1, 0.6 → 2).
		const ct = robotWalkTime(s, META);
		const want = ct <= 0.6 ? 1 + ct / 0.6 : 2 - (ct - 0.6) / 0.6;
		assert.ok(Math.abs(knee.position.y - want) < 1e-5, `t ${t}: ${knee.position.y} vs ${want}`);
	}
	let shadows = 0;
	robot.object.traverse((o) => {
		if ((o as THREE.Mesh).isMesh && o.castShadow && o.receiveShadow) shadows++;
	});
	assert.equal(shadows, 1);
	// Night: the material glows with its own map, ROBOT_NIGHT_GLOW times the level; none by day.
	const material = (scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
	assert.equal(material.emissiveIntensity, 0);
	robot.setNight(1);
	assert.equal(material.emissiveIntensity, ROBOT_NIGHT_GLOW);
	assert.equal(material.emissiveMap, material.map);
	robot.setNight(0);
	assert.equal(material.emissiveIntensity, 0);
	robot.dispose();
	// Without a walk clip, or without the paths to make a lane, no robot.
	assert.equal(createRobot(fakeRobot().scene, [], META, PATHS, { shadows: false }), null);
	assert.equal(createRobot(fakeRobot().scene, animations, META, [], { shadows: false }), null);
});
