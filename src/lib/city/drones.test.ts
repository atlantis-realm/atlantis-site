import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	DRONE_BELLY,
	DRONE_COUNT,
	DRONE_FAR,
	DRONE_GLIDE_CLEAR,
	DRONE_GLIDE_FREE,
	DRONE_GLIDE_RATIO,
	DRONE_HOVER_H,
	DRONE_LEFT_PARCELS,
	DRONE_PARCEL_H,
	DRONE_SKID_H,
	DRONE_SKY_CLEAR,
	DRONE_SPOT_GAP,
	DRONE_TETHER,
	DRONE_TILT_MAX,
	createDrones,
	droneGeometry,
	easedDistance,
	farPoint,
	glideClear,
	keepLeftParcels,
	moveDuration,
	pickGlide,
	pickSpot,
	planTrip,
	rotorGeometry,
	skyHeight,
	skyMaxAlong,
	spotInView,
	tripPose,
	type DroneTrip
} from './drones.ts';
import { mulberry32 } from './people.ts';
import type { DroneSky, DroneSpot, Vec3 } from './props.ts';

// A 4 x 3 grid of 10 m cells from (-20, 1180): a 60 m tower in cell (1, 1), the rest low.
const SKY: DroneSky = {
	origin: [-20, 1180],
	cell: 10,
	nx: 4,
	nz: 3,
	h: [10, 10, 10, 10, 10, 60, 10, 10, 10, 10, 10, 10]
};
const SPOTS: DroneSpot[] = [
	{ pos: [4, 9, 1204], kind: 'ground', frames: [1, 6, 11] },
	{ pos: [-8, 9, 1204], kind: 'ground', frames: [1, 6, 11, 16] },
	{ pos: [-37, 42, 1017], kind: 'roof', frames: [41, 46] },
	{ pos: [33, 41, 1091], kind: 'roof', frames: [] },
	{ pos: [29, 9, 1147], kind: 'ground', frames: [] }
];
const EYE: Vec3 = [0, 10.3, 1224.9];

function horiz(a: Vec3, b: Vec3): number {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function trip(seed: number, frame = 1, seen?: (p: Vec3) => boolean): DroneTrip {
	return planTrip({
		spots: SPOTS,
		sky: SKY,
		rand: mulberry32(seed),
		start: 100,
		frame,
		busy: new Set(),
		eye: EYE,
		seen
	});
}

test('skyHeight reads the cell under a point, clamped to the grid', () => {
	assert.equal(skyHeight(SKY, -5, 1195), 60);
	assert.equal(skyHeight(SKY, 15, 1205), 10);
	assert.equal(skyHeight(SKY, -1000, 1185), 10); // clamped to column 0
	assert.equal(skyHeight(SKY, -5, 1100), 10); // clamped to row 0
});

test('skyMaxAlong finds the tower under a line through it, not beside it', () => {
	assert.equal(
		skyMaxAlong(SKY, [
			[-20, 0, 1195],
			[20, 0, 1195]
		]),
		60
	);
	assert.equal(
		skyMaxAlong(SKY, [
			[-20, 0, 1185],
			[20, 0, 1185]
		]),
		10
	);
	// Clipping the tower's corner by 0.3 m, between two samples.
	assert.equal(
		skyMaxAlong(SKY, [
			[-19.7, 0, 1179],
			[0.3, 0, 1199.6]
		]),
		60
	);
	// Passing 0.5 m beside it (within DRONE_RADIUS) counts too.
	assert.equal(
		skyMaxAlong(SKY, [
			[-20, 0, 1189.5],
			[20, 0, 1189.5]
		]),
		60
	);
	assert.equal(skyMaxAlong(undefined, [[0, 0, 0]]), -Infinity);
});

test('easedDistance runs from rest to rest within the speed limit', () => {
	for (const [len, speed, accel] of [
		[200, 12, 2.5],
		[10, 12, 2.5],
		[25, 3, 1.5]
	]) {
		const total = moveDuration(len, speed, accel);
		assert.equal(easedDistance(0, len, speed, accel), 0);
		assert.ok(Math.abs(easedDistance(total, len, speed, accel) - len) < 1e-9);
		let prev = 0;
		const dt = total / 400;
		for (let k = 1; k <= 400; k++) {
			const s = easedDistance(k * dt, len, speed, accel);
			assert.ok(s >= prev - 1e-9, 'monotonic');
			assert.ok((s - prev) / dt <= speed + 1e-6, `speed ${(s - prev) / dt}`);
			prev = s;
		}
		// Slow at both ends.
		assert.ok(easedDistance(dt, len, speed, accel) / dt < speed / 2);
		assert.ok((len - easedDistance(total - dt, len, speed, accel)) / dt < speed / 2);
	}
	// Long enough to reach full speed: 2 ramps of v/a plus the rest at v.
	assert.ok(Math.abs(moveDuration(200, 10, 2) - (10 + (200 - 50) / 10)) < 1e-9);
});

test('spotInView: a sample frame within 5 frames', () => {
	assert.ok(spotInView(SPOTS[0], 1));
	assert.ok(spotInView(SPOTS[0], 16));
	assert.ok(!spotInView(SPOTS[0], 17));
	assert.ok(!spotInView(SPOTS[3], 1));
});

test('pickSpot keeps to spots in view and not busy, else any free one', () => {
	const rand = mulberry32(3);
	for (let k = 0; k < 200; k++) {
		const i = pickSpot(SPOTS, 1, rand, new Set([0]), EYE);
		assert.equal(i, 1, 'the only free spot in view at frame 1');
	}
	const seen = new Set<number>();
	for (let k = 0; k < 400; k++) seen.add(pickSpot(SPOTS, 200, rand, new Set([4]), EYE));
	assert.deepEqual([...seen].sort(), [0, 1, 2, 3], 'none in view at frame 200: every free spot');
});

test('a trip is the same for the same seed', () => {
	assert.deepEqual(trip(7), trip(7));
	assert.notDeepEqual(trip(7), trip(8));
});

test('the drone hovers DRONE_HOVER_H over the drop spot, then the parcel sits on it', () => {
	for (let seed = 1; seed <= 40; seed++) {
		const tr = trip(seed, seed % 2 ? 1 : 45);
		const d = SPOTS[tr.drop].pos;
		let hovered = false;
		let wasDropped = false;
		let lowest = Infinity;
		for (let t = tr.start; t <= tr.end; t += 0.05) {
			const p = tripPose(tr, t, SPOTS);
			if (horiz(p.position, d) < 0.2 && Math.abs(p.position[1] - (d[1] + DRONE_HOVER_H)) < 0.1)
				hovered = true;
			if (wasDropped) assert.ok(p.dropped, 'a dropped parcel stays dropped');
			if (p.dropped) {
				wasDropped = true;
				assert.deepEqual(p.parcel, [d[0], d[1] + DRONE_PARCEL_H / 2, d[2]]);
			} else if (horiz(p.position, d) < 1) {
				// Hanging: never into the spot.
				assert.ok(p.parcel[1] - DRONE_PARCEL_H / 2 >= d[1] - 1e-9);
				lowest = Math.min(lowest, p.parcel[1] - DRONE_PARCEL_H / 2);
			}
		}
		assert.ok(hovered, `seed ${seed}: hovered`);
		assert.ok(wasDropped, `seed ${seed}: dropped`);
		// Within one 0.05 s step at the winch speed plus the hover's bob.
		assert.ok(lowest - d[1] < 0.1, `seed ${seed}: the parcel reached the spot (${lowest - d[1]})`);
	}
});

test('the line pays out to DRONE_TETHER in flight and the parcel hangs at its end', () => {
	const tr = trip(5);
	const mid = tr.start + 0.3 * (tr.end - tr.start);
	const p = tripPose(tr, tr.start + 5, SPOTS);
	assert.ok(Math.abs(p.tether - DRONE_TETHER) < 1e-9 || tr.takeoff >= 0);
	const q = tripPose(tr, mid, SPOTS);
	if (!q.dropped && q.tether > 0) {
		const hang = q.position[1] - DRONE_BELLY - q.tether - DRONE_PARCEL_H / 2;
		assert.ok(q.parcel[1] >= hang - 1e-9);
	}
});

test('the path is continuous, within the cruise speed (plus the wobble)', () => {
	for (let seed = 1; seed <= 20; seed++) {
		const tr = trip(seed);
		const dt = 0.05;
		let prev = tripPose(tr, tr.start, SPOTS).position;
		for (let t = tr.start + dt; t <= tr.end; t += dt) {
			const p = tripPose(tr, t, SPOTS).position;
			const v = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / dt;
			assert.ok(v < 14 + 0.5, `seed ${seed} at ${t - tr.start}: ${v} m/s`);
			prev = p;
		}
	}
});

test('the drone clears the sky grid: by DRONE_SKY_CLEAR at cruise height, DRONE_GLIDE_CLEAR gliding in', () => {
	let glides = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const tr = trip(seed);
		const spots = [SPOTS[tr.drop].pos, ...(tr.takeoff >= 0 ? [SPOTS[tr.takeoff].pos] : [])];
		let glided = false;
		for (let t = tr.start; t <= tr.end; t += 0.25) {
			const p = tripPose(tr, t, SPOTS).position;
			// Straight up and down over its spots, and the end of a glide, are the export's checked columns.
			if (spots.some((s) => horiz(p, s) < 0.5)) continue;
			if (horiz(p, SPOTS[tr.drop].pos) < DRONE_GLIDE_FREE) continue;
			const clear = p[1] < tr.alt - 0.5 ? DRONE_GLIDE_CLEAR : DRONE_SKY_CLEAR;
			if (p[1] < tr.alt - 0.5) glided = true;
			assert.ok(
				p[1] >= skyHeight(SKY, p[0], p[2]) + clear - 0.1,
				`seed ${seed}: ${p} over ${skyHeight(SKY, p[0], p[2])}`
			);
		}
		if (glided) glides++;
		assert.ok(tr.alt >= SPOTS[tr.drop].pos[1] + 10);
	}
	assert.ok(glides > 20, `${glides} of 40 trips glide in`);
});

test('glideClear: blocked by the tower, clear beside it; the last DRONE_GLIDE_FREE m is not checked', () => {
	const hover: Vec3 = [-5, 14, 1205];
	assert.ok(!glideClear(SKY, [-5, 30, 1170], hover), 'over the tower at 60 m');
	assert.ok(glideClear(SKY, [20, 30, 1205], hover), 'over the low cells');
	assert.ok(glideClear(undefined, [-5, 30, 1170], hover));
});

test('pickGlide starts DRONE_GLIDE_RATIO times the drop out, at cruise height, seen if it can', () => {
	const hover: Vec3 = [4, 14, 1204];
	const q = pickGlide(hover, 34, SKY, mulberry32(1), () => false)!;
	assert.equal(q[1], 34);
	assert.ok(Math.abs(horiz(q, hover) - DRONE_GLIDE_RATIO * 20) < 1e-9);
	// Only the half plane east of x = 15 is seen: the glide comes from there.
	const seen = (p: Vec3): boolean => p[0] > 15;
	for (let seed = 1; seed <= 10; seed++) {
		const g = pickGlide(hover, 34, SKY, mulberry32(seed), seen)!;
		assert.ok(seen([(g[0] + hover[0]) / 2, 0, 0]), `seed ${seed}: ${g}`);
	}
	assert.equal(
		pickGlide(hover, 15, SKY, mulberry32(1), () => false),
		null,
		'too low to glide'
	);
});

test('a take-off starts landed on an unseen spot; an entry starts and every trip ends far off', () => {
	let takeoffs = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const tr = trip(seed);
		const d = SPOTS[tr.drop].pos;
		const first = tripPose(tr, tr.start, SPOTS).position;
		const last = tripPose(tr, tr.end, SPOTS).position;
		if (tr.takeoff >= 0) {
			takeoffs++;
			const s = SPOTS[tr.takeoff];
			assert.ok(!spotInView(s, 1) && tr.takeoff !== tr.drop);
			assert.ok(horiz(first, s.pos) < 1e-6 && Math.abs(first[1] - s.pos[1] - DRONE_SKID_H) < 1e-6);
		} else {
			assert.ok(horiz(first, d) >= DRONE_FAR[0] - 1, `entry ${horiz(first, d)}`);
		}
		assert.ok(horiz(last, d) >= DRONE_FAR[0] - 1, `exit ${horiz(last, d)}`);
	}
	assert.ok(takeoffs > 5 && takeoffs < 40, `${takeoffs} take-offs in 60`);
});

test('entry and exit points avoid what the camera sees when they can', () => {
	// The camera sees everything north (−z) of the plaza.
	const seen = (p: Vec3): boolean => p[2] < 1200;
	for (let seed = 1; seed <= 30; seed++) {
		const tr = trip(seed, 1, seen);
		const last = tripPose(tr, tr.end, SPOTS).position;
		assert.ok(!seen(last), `seed ${seed}: exit ${last}`);
		if (tr.takeoff < 0) assert.ok(!seen(tripPose(tr, tr.start, SPOTS).position));
	}
});

test('farPoint: DRONE_FAR out, unseen, over the lowest sky it can find', () => {
	const centre: Vec3 = [-5, 9, 1215];
	// 80 m roofs to the north (−z), open ground (10 m) from z 1195 south (the centre is 20 m into it).
	const nx = 60;
	const nz = 60;
	const wall: DroneSky = {
		origin: [-305, 895],
		cell: 10,
		nx,
		nz,
		h: Array.from({ length: nx * nz }, (_, k) => (Math.floor(k / nx) >= 30 ? 10 : 80))
	};
	for (let seed = 1; seed <= 10; seed++) {
		const p = farPoint(centre, 40, mulberry32(seed), () => false, wall);
		const d = horiz(p, centre);
		assert.ok(d >= DRONE_FAR[0] - 1e-9 && d <= DRONE_FAR[1] + 1e-9, `${d}`);
		assert.equal(p[1], 40);
		const unseenOnly = farPoint(centre, 40, mulberry32(seed), (q) => q[2] > 1215, wall);
		assert.ok(unseenOnly[2] <= 1215, 'unseen first, even over the roofs');
	}
	// Of 12 bearings some head south over the open ground, and win.
	for (let seed = 1; seed <= 10; seed++) {
		const p = farPoint(centre, 40, mulberry32(seed), () => false, wall);
		assert.equal(skyMaxAlong(wall, [p, centre]), 10, `seed ${seed}: ${p}`);
	}
});

test('cruising, the nose points along the travel; speeding up, the drone leans forward', () => {
	const tr = trip(11);
	const cruise = tr.segments.find((s) => s.follow)!;
	const t = tr.start + cruise.t0 + cruise.dur / 2;
	const a = tripPose(tr, t, SPOTS);
	const b = tripPose(tr, t + 0.2, SPOTS);
	const travel = new THREE.Vector3(
		b.position[0] - a.position[0],
		0,
		b.position[2] - a.position[2]
	).normalize();
	const nose = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.heading);
	assert.ok(nose.dot(travel) > 0.95, `nose ${nose.dot(travel)}`);
	// 1 s into the cruise it is still speeding up.
	const early = tripPose(tr, tr.start + cruise.t0 + 1, SPOTS);
	const lean = new THREE.Vector3(early.tilt[0], 0, early.tilt[1]);
	const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), early.heading);
	assert.ok(lean.dot(dir) > 0.1, `lean forward ${lean.dot(dir)}`);
	for (let u = tr.start; u <= tr.end; u += 0.5) {
		const p = tripPose(tr, u, SPOTS);
		assert.ok(Math.hypot(...p.tilt) <= Math.tan(DRONE_TILT_MAX) + 0.05);
	}
});

test('droneGeometry: a quadcopter about 1.5 m across, skids DRONE_SKID_H below the origin', () => {
	const g = droneGeometry();
	g.computeBoundingBox();
	const box = g.boundingBox!;
	assert.ok(Math.abs(box.min.y + DRONE_SKID_H) < 1e-6, `skids ${box.min.y}`);
	const size = box.getSize(new THREE.Vector3());
	assert.ok(size.x > 1 && size.x < 1.6 && size.z > 1 && size.z < 1.6, `${size.x} x ${size.z}`);
	assert.ok(g.getAttribute('position').count / 3 < 500, 'low poly');
	assert.equal(g.getAttribute('color').itemSize, 3);
	const r = rotorGeometry();
	assert.equal(r.getAttribute('color').itemSize, 4);
	g.dispose();
	r.dispose();
});

test('createDrones: none without spots; four instanced meshes, lights only at night', () => {
	assert.equal(createDrones([], SKY, { shadows: true }), null);
	assert.equal(createDrones(undefined, SKY, { shadows: true }), null);
	const drones = createDrones(SPOTS, SKY, { shadows: true })!;
	const meshes = drones.object.children as THREE.InstancedMesh[];
	assert.equal(meshes.length, 4);
	assert.ok(meshes.every((m) => m.isInstancedMesh));
	const [bodies, rotors, parcels, lights] = meshes;
	assert.equal(bodies.count, DRONE_COUNT);
	assert.equal(rotors.count, 4 * DRONE_COUNT);
	assert.equal(parcels.count, (2 + DRONE_LEFT_PARCELS) * DRONE_COUNT);
	assert.equal(lights.count, 3 * DRONE_COUNT);
	assert.ok(bodies.castShadow && parcels.castShadow && !rotors.castShadow);
	assert.equal(lights.visible, false);
	drones.setNight(1);
	assert.equal(lights.visible, true);
	drones.setNight(0);
	assert.equal(lights.visible, false);
	drones.dispose();
});

test('update places each body at its pose; the same clock replays the same', () => {
	const run = (): DroneTrip[] => {
		const drones = createDrones(SPOTS, SKY, { shadows: false })!;
		const bodies = drones.object.children[0] as THREE.InstancedMesh;
		for (let t = 0; t <= 300; t += 0.5) drones.update(t, 1, EYE);
		const m = new THREE.Matrix4();
		const p = new THREE.Vector3();
		const states = drones.state();
		assert.equal(states.length, DRONE_COUNT);
		states.forEach((s, i) => {
			bodies.getMatrixAt(i, m);
			p.setFromMatrixPosition(m);
			if (s.visible) assert.ok(p.distanceTo(new THREE.Vector3(...s.position)) < 1e-3);
			else assert.equal(m.determinant(), 0);
		});
		const out = states.map((s) => ({ ...s })) as unknown as DroneTrip[];
		drones.dispose();
		return out;
	};
	assert.deepEqual(run(), run());
});

test('the drones spread over drop spots DRONE_SPOT_GAP apart at once', () => {
	// An extra spot 3 m from spot 0: never in use with it.
	const spots = [...SPOTS, { pos: [7, 9, 1204] as Vec3, kind: 'ground', frames: [1] }];
	const drones = createDrones(spots, SKY, { shadows: false, count: 3 })!;
	for (let t = 0; t <= 400; t += 1) {
		drones.update(t, 1, EYE);
		const drops = drones.state().map((s) => s.drop);
		assert.equal(new Set(drops).size, drops.length, `t ${t}: ${drops}`);
		for (const a of drops)
			for (const b of drops)
				if (a !== b)
					assert.ok(horiz(spots[a].pos, spots[b].pos) >= DRONE_SPOT_GAP, `t ${t}: ${a} and ${b}`);
	}
	drones.dispose();
});

test('after the clock goes back, the same steps replay the same trips', () => {
	const drones = createDrones(SPOTS, SKY, { shadows: false })!;
	const run = (): string => {
		for (let t = 0; t <= 150; t += 0.5) drones.update(t, 1, EYE);
		return JSON.stringify(drones.state());
	};
	const first = run();
	assert.equal(run(), first);
	drones.dispose();
});

test('keepLeftParcels: the ones the camera sees, the newest DRONE_LEFT_PARCELS; none unseen', () => {
	const at = (k: number) => ({ spot: k, yaw: k, colour: 0 });
	const seen = (p: Vec3) => p[2] > 1100;
	// Spots 2 and 3 are not seen (z 1017, 1091), spots 0, 1 and 4 are.
	assert.deepEqual(keepLeftParcels([], SPOTS, seen, at(0)), [at(0)]);
	assert.deepEqual(
		keepLeftParcels([at(0)], SPOTS, seen, at(2)),
		[at(0)],
		'an unseen drop is not kept'
	);
	assert.deepEqual(keepLeftParcels([at(0), at(1)], SPOTS, seen, at(4)).length, DRONE_LEFT_PARCELS);
	assert.deepEqual(
		keepLeftParcels([at(0), at(1)], SPOTS, seen, at(4))[0],
		at(1),
		'the oldest goes'
	);
	assert.deepEqual(
		keepLeftParcels([at(0), at(1)], SPOTS, () => false),
		[]
	);
	assert.deepEqual(
		keepLeftParcels([at(0)], SPOTS, undefined, at(1)),
		[],
		'no camera: nothing seen'
	);
});

test('a delivered parcel stays on its spot after the trip while the camera sees it, then goes', () => {
	const drones = createDrones(SPOTS, SKY, { shadows: false, count: 2 })!;
	const parcels = drones.object.children[2] as THREE.InstancedMesh;
	const m = new THREE.Matrix4();
	const p = new THREE.Vector3();
	const left = (): THREE.Vector3[] => {
		const out: THREE.Vector3[] = [];
		for (let k = 4; k < parcels.count; k++) {
			parcels.getMatrixAt(k, m);
			if (m.determinant() !== 0) out.push(p.setFromMatrixPosition(m).clone());
		}
		return out;
	};
	const all = () => true;
	let ended = 0;
	let prev = drones.state();
	for (let t = 0; t <= 600; t += 0.5) {
		drones.update(t, 1, EYE, all);
		const now = drones.state();
		now.forEach((d, i) => {
			if (!prev[i].dropped || (d.dropped && d.drop === prev[i].drop)) return;
			// Drone i's last trip ended: its parcel is still where it was dropped.
			const at = SPOTS[prev[i].drop].pos;
			const want = new THREE.Vector3(at[0], at[1] + DRONE_PARCEL_H / 2, at[2]);
			assert.ok(
				left().some((q) => q.distanceTo(want) < 1e-6),
				`t ${t}: drone ${i}'s parcel on spot ${prev[i].drop}`
			);
			ended++;
		});
		assert.ok(left().length <= 2 * DRONE_LEFT_PARCELS);
		// One parcel to a spot: a new one set down takes the place of one left there.
		const resting = [...left()];
		drones.state().forEach((s, i) => {
			if (!s.dropped) return;
			parcels.getMatrixAt(2 * i, m);
			resting.push(p.setFromMatrixPosition(m).clone());
		});
		resting.forEach((a, j) =>
			resting
				.slice(j + 1)
				.forEach((b) => assert.ok(a.distanceTo(b) > 1e-3, `t ${t}: two on a spot`))
		);
		prev = now;
	}
	assert.ok(ended >= 4, `${ended} trips ended`);
	drones.update(601, 1, EYE, () => false);
	assert.equal(left().length, 0, 'gone once out of view');
	drones.dispose();
});
