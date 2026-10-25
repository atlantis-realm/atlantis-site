// Procedural sky dome for the /city hero: zenith-to-horizon gradient, sun glow,
// drifting fbm clouds, and a night mix (stars, moon, dark gradient, cloud
// undersides lit warm by the city). No HDRI download; the same mesh also feeds
// the PMREM environment map in CityHeroScene.

import * as THREE from 'three';

/** Cloud drift, in cloud-plane units per second (x, z in glTF space). */
export const SKY_WIND: [number, number] = [0.012, 0.005];
/** Cloud cover threshold: fbm values above the low edge start to form cloud. */
export const SKY_CLOUD_COVER: [number, number] = [0.48, 0.78];
/** Scale of the cloud pattern on its plane (higher = smaller clouds). */
export const SKY_CLOUD_SCALE = 1.6;

/** Day palette (linear RGB). */
const DAY_ZENITH = new THREE.Color(0.06, 0.2, 0.62);
const DAY_HORIZON = new THREE.Color(0.55, 0.72, 0.92);
const DAY_CLOUD = new THREE.Color(1.0, 0.98, 0.95);
const SUN_COLOR = new THREE.Color(1.0, 0.9, 0.72);
/** Night palette (linear RGB). */
const NIGHT_ZENITH = new THREE.Color(0.002, 0.004, 0.014);
const NIGHT_HORIZON = new THREE.Color(0.012, 0.024, 0.06);
const NIGHT_CLOUD = new THREE.Color(0.02, 0.025, 0.04);
const CITY_GLOW = new THREE.Color(0.9, 0.5, 0.22);
const MOON_COLOR = new THREE.Color(0.9, 0.93, 1.0);

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	// Rotation-only view: the dome sits at infinity and follows the camera.
	vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
	gl_Position = p.xyww;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uCityDir;
uniform vec2 uWind;
uniform vec2 uCloudCover;
uniform float uCloudScale;
uniform vec3 uDayZenith;
uniform vec3 uDayHorizon;
uniform vec3 uDayCloud;
uniform vec3 uSunColor;
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec3 uNightCloud;
uniform vec3 uCityGlow;
uniform vec3 uMoonColor;
varying vec3 vDir;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
	p3 = fract(p3 * 0.1031);
	p3 += dot(p3, p3.zyx + 31.32);
	return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
	           mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i++) {
		v += a * noise(p);
		p = p * 2.03 + vec2(17.1, 9.2);
		a *= 0.5;
	}
	return v;
}

void main() {
	vec3 d = normalize(vDir);
	float h = d.y;
	float up = pow(clamp(h, 0.0, 1.0), 0.45);

	vec3 day = mix(uDayHorizon, uDayZenith, up);
	vec3 night = mix(uNightHorizon, uNightZenith, up);
	vec3 col = mix(day, night, uNight);

	// Sun: broad glow plus a small hot disc (day only).
	float s = max(dot(d, uSunDir), 0.0);
	col += (1.0 - uNight) * uSunColor * (0.35 * pow(s, 8.0) + 1.5 * pow(s, 200.0) + 30.0 * smoothstep(0.99985, 0.9999, s));

	// Stars and moon (night only), faded out toward the horizon haze.
	float aboveHaze = smoothstep(0.02, 0.2, h);
	vec3 cell = floor(d * 420.0);
	float star = step(0.9975, hash13(cell));
	float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash13(cell + 7.0) * 6.2831);
	col += uNight * aboveHaze * star * twinkle * vec3(1.6);
	float m = dot(d, uMoonDir);
	col += uNight * uMoonColor * (3.0 * smoothstep(0.99955, 0.9997, m) + 0.08 * pow(max(m, 0.0), 30.0));

	// Clouds on a flat layer above the camera, drifting along uWind.
	if (h > 0.0) {
		vec2 uv = d.xz / (h + 0.12) * uCloudScale + uWind * uTime;
		float c = fbm(uv);
		float cover = smoothstep(uCloudCover.x, uCloudCover.y, c) * smoothstep(0.0, 0.15, h);
		float lit = 0.85 + 0.15 * s;
		vec3 dayCloud = uDayCloud * lit * mix(1.0, 0.82, smoothstep(0.6, 0.95, c));
		// Night: dark undersides lit warm by the city, strongest low toward the city.
		vec2 horiz = normalize(d.xz + 1e-5);
		float toward = 0.5 + 0.5 * dot(horiz, normalize(uCityDir.xz + 1e-5));
		float glow = pow(1.0 - h, 4.0) * toward * toward;
		vec3 nightCloud = uNightCloud + uCityGlow * 0.18 * glow;
		col = mix(col, mix(dayCloud, nightCloud, uNight), cover * 0.92);
	}

	// Below the horizon: a soft haze rather than a hard edge.
	col = mix(col, mix(uDayHorizon * 0.8, uNightHorizon, uNight), smoothstep(0.0, -0.08, h));

	gl_FragColor = vec4(col, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

export type SkyUniforms = {
	uTime: THREE.IUniform<number>;
	uNight: THREE.IUniform<number>;
	uSunDir: THREE.IUniform<THREE.Vector3>;
	uMoonDir: THREE.IUniform<THREE.Vector3>;
	uCityDir: THREE.IUniform<THREE.Vector3>;
	uWind: THREE.IUniform<THREE.Vector2>;
	uCloudCover: THREE.IUniform<THREE.Vector2>;
	uCloudScale: THREE.IUniform<number>;
	[name: string]: THREE.IUniform;
};

export type Sky = {
	mesh: THREE.Mesh;
	uniforms: SkyUniforms;
	/** 0 = day, 1 = night. Driven by the toggle cross-fade (Task 7). */
	setMix(night: number): void;
	/** Cloud drift and star twinkle time, in seconds. */
	update(t: number): void;
	/** A second mesh sharing this sky's material, for an environment-only scene. */
	cloneMesh(): THREE.Mesh;
	dispose(): void;
};

/** The moon sits opposite the sun in azimuth, at the sun's elevation. */
function moonFrom(sunDir: THREE.Vector3): THREE.Vector3 {
	return new THREE.Vector3(-sunDir.x, Math.max(sunDir.y, 0.35), -sunDir.z).normalize();
}

/**
 * Build the sky dome. `sunDir` points from the scene toward the sun (glTF
 * space, as `hero_props.json` `sun.dir`); `cityDir` is the horizontal direction
 * of the city's glow. Both can be changed later through `uniforms`.
 */
export function createSky(
	sunDir = new THREE.Vector3(0.5, 0.7, 0.5),
	cityDir = new THREE.Vector3(0, 0, -1)
): Sky {
	const sun = sunDir.clone().normalize();
	const uniforms: SkyUniforms = {
		uTime: { value: 0 },
		uNight: { value: 0 },
		uSunDir: { value: sun },
		uMoonDir: { value: moonFrom(sun) },
		uCityDir: { value: cityDir.clone().normalize() },
		uWind: { value: new THREE.Vector2(...SKY_WIND) },
		uCloudCover: { value: new THREE.Vector2(...SKY_CLOUD_COVER) },
		uCloudScale: { value: SKY_CLOUD_SCALE },
		uDayZenith: { value: DAY_ZENITH },
		uDayHorizon: { value: DAY_HORIZON },
		uDayCloud: { value: DAY_CLOUD },
		uSunColor: { value: SUN_COLOR },
		uNightZenith: { value: NIGHT_ZENITH },
		uNightHorizon: { value: NIGHT_HORIZON },
		uNightCloud: { value: NIGHT_CLOUD },
		uCityGlow: { value: CITY_GLOW },
		uMoonColor: { value: MOON_COLOR }
	};

	const geometry = new THREE.SphereGeometry(1, 48, 24);
	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader,
		fragmentShader,
		side: THREE.BackSide,
		depthWrite: false,
		depthFunc: THREE.LessEqualDepth
	});

	const makeMesh = (): THREE.Mesh => {
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = 'Sky';
		mesh.frustumCulled = false;
		// Opaque and at the far plane: draw it last so the city's depth hides most of it.
		mesh.renderOrder = 1000;
		return mesh;
	};

	return {
		mesh: makeMesh(),
		uniforms,
		setMix(night: number) {
			uniforms.uNight.value = THREE.MathUtils.clamp(night, 0, 1);
		},
		update(t: number) {
			uniforms.uTime.value = t;
		},
		cloneMesh: makeMesh,
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}

/** Point the sky's sun (and the moon opposite it) along `sunDir`. */
export function setSkySun(sky: Sky, sunDir: THREE.Vector3): void {
	sky.uniforms.uSunDir.value.copy(sunDir).normalize();
	sky.uniforms.uMoonDir.value.copy(moonFrom(sky.uniforms.uSunDir.value));
}
