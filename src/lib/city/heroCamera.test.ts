import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ASPECT, easeToward, frameToTime, safeFrameFov, scrollToFrame } from './heroCamera.ts';

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
