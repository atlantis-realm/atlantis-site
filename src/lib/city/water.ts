// The well's water for the /city hero (spec "Moving things"): the export's
// flat HERO_well_water plane gets its own MeshStandardMaterial whose normal is
// perturbed by two scrolling sine/noise layers, with a soft fresnel tint and the
// sky's environment map for reflections. At night it adds glints of the city
// lights nearest the well (the well ring, the lamp posts). The canals share the
// base material and keep it: only the named mesh is swapped.

import * as THREE from 'three';
import { nightEmissive } from './night.ts';
import type { Vec3 } from './props.ts';

/** Size of the light uniform arrays. */
export const MAX_WATER_LIGHTS = 32;
/** How waterLights() splits them: night-marked surfaces (well ring) vs instances (lamp posts). */
const WATER_SURFACE_LIGHTS = 24;
const WATER_INSTANCE_LIGHTS = MAX_WATER_LIGHTS - WATER_SURFACE_LIGHTS;
/** Night-marked surfaces become one light per grid cell of this size (m). */
const WATER_LIGHT_CELL_M = 3;

/** The water is near-mirror smooth; the waves do the roughening. */
const WATER_ROUGHNESS = 0.06;
const WATER_METALNESS = 0;
/** Wave layers: wavelength scale (1/m), speed (rad/s or m/s of noise drift), height (m). */
const WAVE_A = { k: 0.9, speed: 0.7, height: 0.05 };
const WAVE_B = { k: 2.3, speed: 1.3, height: 0.025 };
/** Slope gain applied to the height field's gradient. */
const WAVE_SLOPE = 1.6;
/** Fresnel: grazing-angle tint (linear rgb), dimmed by this fraction at night. */
const WATER_FRESNEL_TINT: Vec3 = [0.05, 0.12, 0.14];
const WATER_FRESNEL_NIGHT_DIM = 0.85;
/**
 * Glints: a light's reflection is the view ray, reflected in the waved
 * surface, hitting the light (for a flat surface, the eye looking at the
 * light's mirrored position). The error is tolerated more along the vertical
 * plane through the eye and the light, so each light leaves a streak.
 */
const GLINT_ACROSS = 0.012;
const GLINT_ALONG = 0.05;
const GLINT_GAIN = 0.3;

export type WaterLight = {
	position: Vec3;
	/** Linear rgb, already scaled by the night emissive strength. */
	color: Vec3;
};

export type WaterUniforms = {
	uTime: THREE.IUniform<number>;
	uNight: THREE.IUniform<number>;
	uLightCount: THREE.IUniform<number>;
	uLightPos: THREE.IUniform<THREE.Vector3[]>;
	uLightColor: THREE.IUniform<THREE.Vector3[]>;
};

const WATER_KEY = 'cityWater';

const VERTEX_HEAD = /* glsl */ `
varying vec3 vWaterWorld;
`;

const VERTEX_BODY = /* glsl */ `
#include <project_vertex>
vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_HEAD = /* glsl */ `
#define MAX_WATER_LIGHTS ${MAX_WATER_LIGHTS}
varying vec3 vWaterWorld;
uniform float uTime;
uniform float uNight;
uniform int uLightCount;
uniform vec3 uLightPos[MAX_WATER_LIGHTS];
uniform vec3 uLightColor[MAX_WATER_LIGHTS];
vec3 waterNormalW;

float waterHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float waterNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x),
		mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

// Two layers, each a travelling sine plus value noise drifting with it.
float waterHeight(vec2 p) {
	float t = uTime;
	float a = sin(dot(p, vec2(0.8, 0.6)) * ${WAVE_A.k.toFixed(3)} + t * ${WAVE_A.speed.toFixed(3)})
		+ waterNoise(p * ${WAVE_A.k.toFixed(3)} + vec2(0.31, 0.17) * t * ${WAVE_A.speed.toFixed(3)}) * 2.0 - 1.0;
	float b = sin(dot(p, vec2(-0.5, 0.87)) * ${WAVE_B.k.toFixed(3)} - t * ${WAVE_B.speed.toFixed(3)})
		+ waterNoise(p * ${WAVE_B.k.toFixed(3)} - vec2(0.23, 0.41) * t * ${WAVE_B.speed.toFixed(3)}) * 2.0 - 1.0;
	return a * ${WAVE_A.height.toFixed(4)} + b * ${WAVE_B.height.toFixed(4)};
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
	// The plane is horizontal: perturb +Y by the height field's gradient, then
	// hand the view-space normal on to the standard lighting (env reflections).
	const float e = 0.05;
	vec2 p = vWaterWorld.xz;
	float dx = waterHeight(p + vec2(e, 0.0)) - waterHeight(p - vec2(e, 0.0));
	float dz = waterHeight(p + vec2(0.0, e)) - waterHeight(p - vec2(0.0, e));
	waterNormalW = normalize(vec3(-dx, 2.0 * e / ${WAVE_SLOPE.toFixed(3)}, -dz));
	normal = normalize((viewMatrix * vec4(waterNormalW, 0.0)).xyz);
}
`;

const FRAGMENT_OUT = /* glsl */ `
{
	float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
	outgoingLight += vec3(${WATER_FRESNEL_TINT.map((c) => c.toFixed(3)).join(', ')})
		* fres * (1.0 - ${WATER_FRESNEL_NIGHT_DIM.toFixed(3)} * uNight);

	if (uNight > 0.0) {
		vec3 v = normalize(cameraPosition - vWaterWorld);
		vec3 r = reflect(-v, waterNormalW);
		vec3 glints = vec3(0.0);
		for (int i = 0; i < MAX_WATER_LIGHTS; i++) {
			if (i >= uLightCount) break;
			vec3 l = normalize(uLightPos[i] - vWaterWorld);
			vec3 err = r - l;
			vec3 side = cross(vec3(0.0, 1.0, 0.0), uLightPos[i] - cameraPosition);
			float sl = length(side);
			float across = sl > 1e-3 ? dot(err, side / sl) : 0.0;
			float along2 = max(dot(err, err) - across * across, 0.0);
			float g = exp(-across * across / ${(GLINT_ACROSS * GLINT_ACROSS).toFixed(6)}
				- along2 / ${(GLINT_ALONG * GLINT_ALONG).toFixed(6)});
			glints += uLightColor[i] * g;
		}
		outgoingLight += glints * uNight * ${GLINT_GAIN.toFixed(3)};
	}
}
#include <opaque_fragment>
`;

/** The water's uniforms, or null for any other material. */
export function waterUniforms(material: THREE.Material): WaterUniforms | null {
	return (material.userData[WATER_KEY] as WaterUniforms | undefined) ?? null;
}

/** A water material built on `base`: same colour (and vertex AO), waved normals, fresnel, glints. */
export function makeWaterMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
	const m = base.clone();
	m.name = `${base.name}_Well`;
	m.roughness = WATER_ROUGHNESS;
	m.metalness = WATER_METALNESS;
	const uniforms: WaterUniforms = {
		uTime: { value: 0 },
		uNight: { value: 0 },
		uLightCount: { value: 0 },
		uLightPos: { value: Array.from({ length: MAX_WATER_LIGHTS }, () => new THREE.Vector3()) },
		uLightColor: { value: Array.from({ length: MAX_WATER_LIGHTS }, () => new THREE.Vector3()) }
	};
	m.userData[WATER_KEY] = uniforms;
	m.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', VERTEX_BODY);
		shader.fragmentShader =
			FRAGMENT_HEAD +
			shader.fragmentShader
				.replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
				.replace('#include <opaque_fragment>', FRAGMENT_OUT);
	};
	m.customProgramCacheKey = () => WATER_KEY;
	return m;
}

/** Swap the water material in on the mesh named `nodeName` (props.well_water); null when it's missing. */
export function applyWater(root: THREE.Object3D, nodeName: string): THREE.Material | null {
	const mesh = root.getObjectByName(nodeName) as THREE.Mesh | undefined;
	if (!mesh?.isMesh || Array.isArray(mesh.material)) return null;
	const base = mesh.material as THREE.MeshStandardMaterial;
	if (!base.isMeshStandardMaterial) return null;
	const water = makeWaterMaterial(base);
	mesh.material = water;
	return water;
}

export function setWaterTime(material: THREE.Material, t: number): void {
	const u = waterUniforms(material);
	if (u) u.uTime.value = t;
}

/** Night mix 0..1: scales the glints and dims the fresnel tint. */
export function setWaterNight(material: THREE.Material, night: number): void {
	const u = waterUniforms(material);
	if (u) u.uNight.value = night;
}

export function setWaterLights(material: THREE.Material, lights: readonly WaterLight[]): void {
	const u = waterUniforms(material);
	if (!u) return;
	const n = Math.min(lights.length, MAX_WATER_LIGHTS);
	for (let i = 0; i < n; i++) {
		u.uLightPos.value[i].set(...lights[i].position);
		u.uLightColor.value[i].set(...lights[i].color);
	}
	u.uLightCount.value = n;
}

/** The `n` lights nearest `origin`, nearest first, never more than MAX_WATER_LIGHTS. */
export function nearestLights<T extends { position: Vec3 }>(points: readonly T[], origin: Vec3, n: number): T[] {
	const d2 = (p: Vec3): number =>
		(p[0] - origin[0]) ** 2 + (p[1] - origin[1]) ** 2 + (p[2] - origin[2]) ** 2;
	return points
		.map((p) => ({ p, d: d2(p.position) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, Math.max(0, Math.min(n, MAX_WATER_LIGHTS)))
		.map(({ p }) => p);
}

/**
 * Lights for the water, from the night-marked materials under `root`: one per
 * instance of an instanced mesh (the lamp posts, at their glowing part's
 * centre) and one per WATER_LIGHT_CELL_M grid cell of a plain mesh's vertices
 * (the well ring). The nearest of each to `origin` (the well).
 */
export function waterLights(root: THREE.Object3D, origin: Vec3): WaterLight[] {
	const surfaces: WaterLight[] = [];
	const instances: WaterLight[] = [];
	const cells = new Set<string>();
	const v = new THREE.Vector3();
	const m = new THREE.Matrix4();
	root.updateMatrixWorld(true);
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		mats.forEach((mat, slot) => {
			const em = nightEmissive(mat);
			if (!em) return;
			const color: Vec3 = [em[0] * em[3], em[1] * em[3], em[2] * em[3]];
			const instanced = mesh as THREE.InstancedMesh;
			if (instanced.isInstancedMesh) {
				const geo = mesh.geometry;
				if (!geo.boundingBox) geo.computeBoundingBox();
				const centre = geo.boundingBox!.getCenter(new THREE.Vector3());
				for (let i = 0; i < instanced.count; i++) {
					instanced.getMatrixAt(i, m);
					v.copy(centre).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
					instances.push({ position: [v.x, v.y, v.z], color });
				}
				return;
			}
			for (const p of slotVertices(mesh, Array.isArray(mesh.material) ? slot : -1, v)) {
				const key = p.map((c) => Math.floor(c / WATER_LIGHT_CELL_M)).join(',');
				if (cells.has(key)) continue;
				cells.add(key);
				surfaces.push({ position: p, color });
			}
		});
	});
	return [
		...nearestLights(surfaces, origin, WATER_SURFACE_LIGHTS),
		...nearestLights(instances, origin, WATER_INSTANCE_LIGHTS)
	];
}

/** World positions of the vertices drawn with material `slot` (-1: all of them). */
function* slotVertices(mesh: THREE.Mesh, slot: number, v: THREE.Vector3): Generator<Vec3> {
	const geo = mesh.geometry;
	const pos = geo.getAttribute('position');
	const index = geo.index;
	const count = index ? index.count : pos.count;
	const ranges =
		slot < 0 ? [{ start: 0, count }] : geo.groups.filter((g) => (g.materialIndex ?? 0) === slot);
	for (const r of ranges) {
		const end = Math.min(r.start + r.count, count);
		for (let k = r.start; k < end; k++) {
			v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld);
			yield [v.x, v.y, v.z];
		}
	}
}
