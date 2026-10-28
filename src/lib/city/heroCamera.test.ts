import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MIN_ASPECT,
	coversViewport,
	dropEase,
	dropPose,
	easeToward,
	frameToTime,
	heroScroll,
	safeFrameFov,
	scrollToFrame
} from './heroCamera.ts';

const DEG = Math.PI / 180;

test('scrollToFrame maps progress 0..1 to frames 250..1 and clamps', () => {
	assert.equal(scrollToFrame(0), 250);
	assert.equal(scrollToFrame(1), 1);
	assert.equal(scrollToFrame(0.5), 125.5);
	assert.equal(scrollToFrame(-1), 250);
	assert.equal(scrollToFrame(2), 1);
});

test('frameToTime converts frames to seconds from the first frame', () => {
	assert.equal(frameToTime(1), 0);
	assert.ok(Math.abs(frameToTime(250) - 249 / 24) < 1e-12);
});

test('safeFrameFov keeps the Blender FOV at 16:9', () => {
	const base = 33.4;
	const aspect = 16 / 9;
	const halfH = Math.atan(Math.tan((base / 2) * DEG) * aspect);
	assert.ok(Math.abs(safeFrameFov(aspect, base, Math.tan(halfH)) - base) < 1e-9);
});

test('safeFrameFov widens a portrait FOV so the safe frame width stays visible', () => {
	const base = 33.4;
	const safeHalfTan = Math.tan((base / 2) * DEG) * (16 / 9);
	const aspect = 9 / 19.5;
	const vfov = safeFrameFov(aspect, base, safeHalfTan);
	assert.ok(vfov > base);
	const hfov = 2 * Math.atan(Math.tan((vfov / 2) * DEG) * aspect);
	assert.ok(hfov >= 2 * Math.atan(safeHalfTan) - 1e-12);
});

test('safeFrameFov keeps the vertical FOV on wider-than-16:9 screens', () => {
	const base = 33.4;
	const safeHalfTan = Math.tan((base / 2) * DEG) * (16 / 9);
	assert.equal(safeFrameFov(21 / 9, base, safeHalfTan), base);
});

test('safeFrameFov treats screens narrower than 9:19.5 as 9:19.5 (the narrowest culled view)', () => {
	const base = 33.4;
	const safeHalfTan = Math.tan((base / 2) * DEG) * (16 / 9);
	assert.equal(MIN_ASPECT, 9 / 19.5);
	const atMin = safeFrameFov(MIN_ASPECT, base, safeHalfTan);
	assert.equal(safeFrameFov(9 / 21, base, safeHalfTan), atMin);
	assert.equal(safeFrameFov(0.2, base, safeHalfTan), atMin);
});

test('easeToward snaps when close and holds with no time', () => {
	assert.equal(easeToward(0, 10, 10), 10);
	assert.equal(easeToward(0, 10, 0), 0);
});

test('easeToward converges monotonically without overshoot', () => {
	for (const [start, target] of [
		[0, 10],
		[250, 1]
	]) {
		let v = start;
		let prevGap = Math.abs(target - start);
		for (let i = 0; i < 200; i++) {
			const next = easeToward(v, target, 1 / 60);
			const gap = Math.abs(target - next);
			assert.ok(gap <= prevGap, 'gap never grows');
			assert.ok(Math.sign(target - next) !== -Math.sign(target - start), 'never overshoots');
			v = next;
			prevGap = gap;
		}
		assert.equal(v, target);
	}
});

test('easeToward snaps within a custom distance', () => {
	assert.equal(easeToward(0, 1, 1 / 60, 8, 1e-5), 1 - Math.exp(-8 / 60));
	assert.equal(easeToward(0.999999, 1, 1 / 60, 8, 1e-5), 1);
});

test('heroScroll plays the hero until the section enters, then drops until its edge is mid-screen', () => {
	// Track 4000 px, viewport 1000 px: the section starts at 4000 and the hero runs over 3000 px.
	const H = 1000;
	const top = 4000;
	assert.deepEqual(heroScroll(0, top, H), { progress: 0, drop: 0 });
	assert.deepEqual(heroScroll(1500, top, H), { progress: 0.5, drop: 0 });
	// The section's top edge at the viewport bottom: the old progress = 1, frame 1.
	assert.deepEqual(heroScroll(3000, top, H), { progress: 1, drop: 0 });
	assert.equal(scrollToFrame(heroScroll(3000, top, H).progress), 1);
	assert.deepEqual(heroScroll(3250, top, H), { progress: 1, drop: 0.5 });
	// The edge at the vertical centre of the viewport: on the floor.
	assert.deepEqual(heroScroll(3500, top, H), { progress: 1, drop: 1 });
	assert.deepEqual(heroScroll(9000, top, H), { progress: 1, drop: 1 });
	assert.deepEqual(heroScroll(-50, top, H), { progress: 0, drop: 0 });
});

test('heroScroll keeps the edge rule on a tall phone viewport', () => {
	const H = 844;
	const top = 4 * H + 60;
	const range = top - H;
	assert.equal(heroScroll(range, top, H).drop, 0);
	// The edge is at viewport y = top - scrollY; at drop 1 that is H / 2.
	const s = range + H / 2;
	assert.equal(heroScroll(s, top, H).drop, 1);
	assert.equal(top - s, H / 2);
});

test('heroScroll with the section already on screen starts at the end of the hero', () => {
	// The edge at 800 of 1000 px is 40% of the way up to the middle.
	assert.deepEqual(heroScroll(0, 800, 1000), { progress: 1, drop: 0.4 });
	assert.equal(heroScroll(0, 0, 1000).drop, 1);
});

test('dropEase is a monotonic smoothstep from 0 to 1, clamped', () => {
	assert.equal(dropEase(0), 0);
	assert.equal(dropEase(0.5), 0.5);
	assert.equal(dropEase(1), 1);
	assert.equal(dropEase(-1), 0);
	assert.equal(dropEase(2), 1);
	let prev = 0;
	for (let i = 1; i <= 100; i++) {
		const v = dropEase(i / 100);
		assert.ok(v >= prev);
		prev = v;
	}
});

test('dropPose drops the eye to the ground and levels the pitch, never below the ground', () => {
	const eye = 10.31;
	const ground = 8.62;
	const pitch = 0.0435;
	assert.deepEqual(dropPose(eye, ground, pitch, 0), { y: eye, pitch });
	const end = dropPose(eye, ground, pitch, 1);
	assert.equal(end.y, ground);
	assert.equal(end.pitch, 0);
	const mid = dropPose(eye, ground, pitch, 0.5);
	assert.ok(Math.abs(mid.y - (eye + ground) / 2) < 1e-12);
	for (let i = 0; i <= 50; i++) assert.ok(dropPose(eye, ground, pitch, i / 50).y >= ground);
	assert.equal(dropPose(eye, ground, pitch, 3).y, ground);
});

test('coversViewport only when the box spans the whole viewport', () => {
	assert.equal(coversViewport(0, 1000, 1000), true);
	assert.equal(coversViewport(-200, 1400, 1000), true);
	assert.equal(coversViewport(1, 1400, 1000), false);
	assert.equal(coversViewport(-200, 999, 1000), false);
});
