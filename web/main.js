import {
  World,
  Body,
  Box,
  Sphere,
  Vec3,
  HingeConstraint,
  SAPBroadphase,
} from './vendor/cannon-es.js';

'use strict';

// 墙的规格。改完刷新页面即可。
const COLS = 18;
const ROWS = 10;
const BRICK = new THREE.Vector4(1.22, 0.58, 0.075, 0); // 宽, 高, 砖缝
const DEPTH = 0.26;
const BRICK_MASS = 3;
const GRAVITY = -9.81;
const DUST_MASS = 2.5e-6;
const DUST_TERMINAL = 0.4;
const DUST_DRAG = DUST_MASS * Math.abs(GRAVITY) / (DUST_TERMINAL * DUST_TERMINAL);
const WAVE = 2.5;
const STRIDE_X = BRICK.x + BRICK.z;
const STRIDE_Y = BRICK.y + BRICK.z;
const WALL_W = (COLS - 1) * STRIDE_X + BRICK.x;
const WALL_H = (ROWS - 1) * STRIDE_Y + BRICK.y;

const GLYPHS = [
  [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const errorBox = document.getElementById('shader-error');
const triggerButton = document.getElementById('trigger');
const buttonLabel = document.getElementById('btn-label');
const statusLabel = document.getElementById('status');
const meter = document.getElementById('meter');

const wallVertex = `
attribute float aIndex;
attribute float aFade;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocalN;
varying float vCol;
varying float vRow;
varying float vFade;

uniform float uCols;
uniform vec4 uBrick;
uniform float uDepth;

void main() {
  float col = mod(aIndex, uCols);
  float row = floor(aIndex / uCols);
  vec3 lp = vec3(position.x * uBrick.x, position.y * uBrick.y, position.z * uDepth);
  vec3 n = normalize(vec3(normal.x / uBrick.x, normal.y / uBrick.y, normal.z / max(uDepth, 0.001)));
  #ifdef USE_INSTANCING
    mat4 worldMat = modelMatrix * instanceMatrix;
  #else
    mat4 worldMat = modelMatrix;
  #endif
  vec4 world = worldMat * vec4(lp, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(worldMat) * n);
  vLocalN = normal;
  vUv = uv;
  vCol = col;
  vRow = row;
  vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const wallFragment = `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocalN;
varying float vCol;
varying float vRow;
varying float vFade;

uniform float uTime;
uniform sampler2D uFont;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float glyph(float digit, vec2 guv) {
  if (guv.x < 0.0 || guv.y < 0.0 || guv.x > 1.0 || guv.y > 1.0) return 0.0;
  vec2 atlas = vec2((digit + guv.x) / 10.0, guv.y);
  return texture2D(uFont, atlas).r;
}

float codeField(vec2 uv, float col, float row) {
  vec2 inner = (uv - vec2(0.14, 0.16)) / vec2(0.72, 0.68);
  if (inner.x < 0.0 || inner.y < 0.0 || inner.x >= 1.0 || inner.y >= 1.0) return 0.0;
  vec2 grid = vec2(4.0, 3.0);
  vec2 cid = floor(inner * grid);
  vec2 f = fract(inner * grid);
  vec2 box = vec2(0.56, 0.60);
  vec2 guv = (f - (vec2(1.0) - box) * 0.5) / box;
  float n = hash12(cid + vec2(col * 1.7, row * 2.3));
  float digit = mod(floor(uTime * (4.5 + n * 9.0) + n * 113.0), 10.0);
  float scan = 0.78 + 0.22 * sin(uv.y * 70.0 + uTime * 6.0 + n * 18.0);
  return glyph(digit, guv) * scan;
}

vec2 flow(vec2 p) {
  float a = fbm(p + vec2(uTime * 0.07, uTime * 0.025));
  float b = fbm(p + vec2(3.1 - uTime * 0.045, 1.8 + uTime * 0.035));
  return vec2(a, b) - 0.48;
}

float softDots(vec2 uv, float density, float cutoff, float seed) {
  vec2 adv = uv + flow(uv * 1.6 + seed) * 0.32;
  adv += vec2(uTime * 0.03, uTime * 0.011) * (0.55 + seed);
  vec2 warped = adv * density + flow(adv * 2.2 + seed * 2.0) * 1.45;
  vec2 cell = floor(warped);
  vec2 f = fract(warped);
  vec2 center = vec2(hash12(cell + seed), hash12(cell.yx + seed + 3.7)) * 0.72 + 0.14;
  float h = hash12(cell + seed * 1.7);
  float rad = mix(0.03, 0.18, fract(h * 11.0));
  float blob = 1.0 - smoothstep(rad * 0.25, rad, length(f - center));
  float life = 0.5 + 0.5 * sin(uTime * (0.35 + h * 0.9) + h * 6.2831);
  return blob * step(cutoff, h) * smoothstep(0.08, 0.62, life);
}

void main() {
  vec2 uv = vUv;
  vec2 id = vec2(vCol, vRow);
  vec2 drift = flow(uv * 1.35 + id * 0.04);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float rim = 1.0 - smoothstep(0.0, 0.16, edge);
  float face = step(0.55, abs(vLocalN.z));

  float mist = fbm(uv * vec2(1.7, 1.35) + drift * 0.9 + vec2(uTime * 0.045, uTime * 0.02) + id * 0.17);
  mist = smoothstep(0.22, 0.88, mist);
  float seamFog = rim * fbm(uv * 2.4 + drift * 1.15 + vec2(uTime * 0.06, -uTime * 0.03) + id);
  float seamDots = softDots(uv, 9.5, 0.42, 1.3 + vCol * 0.01) * rim;
  float bodyDots = softDots(uv, 5.5, 0.78, 4.8) * (1.0 - rim * 0.85);
  float digits = codeField(uv, vCol, vRow) * face;
  float digitGlow = digits * mix(0.35, 1.0, mist);

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.6);

  float alpha = mist * 0.2 + seamFog * 0.42 + seamDots + bodyDots * 0.55 + digitGlow * 0.8;
  alpha += fres * 0.28;
  alpha *= vFade;
  if (alpha < 0.03) discard;

  vec3 rgb = vec3(0.9, 0.95, 1.0);
  rgb += seamDots * 0.85;
  rgb += digitGlow * vec3(0.75, 1.0, 1.15);
  rgb += fres * 0.18;
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 1.0));
}
`;

const dustVertex = `
attribute float aSeed;
varying float vSeed;
uniform float uTime;

void main() {
  vec3 p = position;
  p.y += sin(uTime * 0.22 + aSeed * 18.0) * 0.08;
  p.x += cos(uTime * 0.16 + aSeed * 11.0) * 0.05;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((1.8 + aSeed * 2.6) * (16.0 / max(-mv.z, 0.2)), 1.0, 6.5);
  vSeed = aSeed;
}
`;

const dustFragment = `
varying float vSeed;

void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.05, d);
  vec3 col = vec3(0.82, 0.88, 0.96) * a * (0.16 + vSeed * 0.22);
  if (col.r < 0.004) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

const powderVertex = `
attribute float aSeed;
attribute float aAlpha;
attribute float aGrow;
varying float vSeed;
varying float vAlpha;
varying float vNear;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.35);
  float nearness = smoothstep(12.0, 3.2, dist);
  float size = (16.0 + aSeed * 28.0) * aGrow;
  gl_PointSize = clamp(size * (22.0 / dist), 5.0, 96.0);
  vSeed = aSeed;
  vAlpha = aAlpha;
  vNear = nearness;
}
`;

const powderFragment = `
varying float vSeed;
varying float vAlpha;
varying float vNear;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  if (vAlpha < 0.02) discard;
  vec2 uv = gl_PointCoord;
  float edge = smoothstep(0.0, 0.28, uv.x) * smoothstep(1.0, 0.72, uv.x);
  edge *= smoothstep(0.0, 0.28, uv.y) * smoothstep(1.0, 0.72, uv.y);
  vec2 q = uv * 2.6 + vec2(vSeed * 8.0, vSeed * 3.1);
  float clumps = vnoise(q);
  clumps = clumps * 0.55 + vnoise(q * 2.2 + clumps) * 0.45;
  float fine = vnoise(uv * 9.0 + vSeed * 14.0);
  float mist = smoothstep(0.46, 0.82, clumps);
  float grain = smoothstep(0.8, 0.96, fine) * (1.0 - vNear);
  float a = (mist * 0.16 + grain * 0.1) * edge * vAlpha;
  a *= mix(1.0, 0.28, vNear);
  if (a < 0.012) discard;
  gl_FragColor = vec4(vec3(0.7, 0.72, 0.74), a);
}
`;

const screenVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const thresholdFragment = `
varying vec2 vUv;
uniform sampler2D tInput;
uniform float uThreshold;

void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float m = smoothstep(uThreshold, uThreshold + 0.55, l);
  gl_FragColor = vec4(c * m, 1.0);
}
`;

const blurFragment = `
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform vec2 uDirection;

void main() {
  vec2 stepUV = uTexel * uDirection;
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  c += texture2D(tInput, vUv + stepUV * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv - stepUV * 1.384615).rgb * 0.316216;
  c += texture2D(tInput, vUv + stepUV * 3.230769).rgb * 0.070270;
  c += texture2D(tInput, vUv - stepUV * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const compositeFragment = `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 sceneCol = texture2D(tScene, vUv).rgb;
  vec3 bloomCol = texture2D(tBloom, vUv).rgb;
  vec2 p = vUv - 0.5;
  float vig = smoothstep(0.92, 0.28, length(p * vec2(1.05, 1.2)));
  vec3 color = vec3(0.01, 0.012, 0.016);
  color += (sceneCol + bloomCol * uBloom) * mix(0.84, 1.0, vig);
  color = aces(color * uExposure);
  gl_FragColor = vec4(pow(color, vec3(0.4545)), 1.0);
}
`;

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function makeFontTexture() {
  const scale = 12;
  const canvas = document.createElement('canvas');
  canvas.width = 10 * 5 * scale;
  canvas.height = 7 * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  for (let digit = 0; digit < 10; digit++) {
    for (let y = 0; y < 7; y++) {
      const bits = GLYPHS[digit][y];
      for (let x = 0; x < 5; x++) {
        if (((bits >> (4 - x)) & 1) === 0) continue;
        ctx.fillRect((digit * 5 + x) * scale, y * scale, scale, scale);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  if ('colorSpace' in texture && THREE.NoColorSpace) texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeAdditiveMaterial(options) {
  const material = new THREE.ShaderMaterial(options);
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.blendEquation = THREE.AddEquation;
  material.side = THREE.DoubleSide;
  return material;
}

function makeGrain() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(128, 128);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 170 + Math.random() * 85;
    image.data[i] = n;
    image.data[i + 1] = n;
    image.data[i + 2] = n;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  document.querySelector('.grain').style.backgroundImage = 'url(' + canvas.toDataURL() + ')';
}

function init() {
  if (!window.THREE) {
    showError('Three.js 没有加载。请从 web 目录打开这个页面。');
    return;
  }

  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!renderer.getContext()) {
    showError('这个浏览器没有可用的 WebGL。');
    return;
  }

  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = function (gl, program, vs, fs) {
    const log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n');
    showError(log || '着色器编译失败');
  };

  const rtType = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 160);
  const font = makeFontTexture();

  const uniforms = {
    uCols: { value: COLS },
    uBrick: { value: BRICK },
    uDepth: { value: DEPTH },
    uTime: { value: 0 },
    uFont: { value: font },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: wallVertex,
    fragmentShader: wallFragment,
  });
  material.transparent = true;
  material.depthWrite = true;
  material.depthTest = true;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.blendEquation = THREE.AddEquation;
  material.side = THREE.FrontSide;

  const count = COLS * ROWS;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const ids = new Float32Array(count);
  const fades = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ids[i] = i;
    fades[i] = 1;
  }
  geometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(ids, 1));
  const fadeAttr = new THREE.InstancedBufferAttribute(fades, 1);
  fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aFade', fadeAttr);

  const wall = new THREE.InstancedMesh(geometry, material, count);
  wall.frustumCulled = false;
  wall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(wall);

  const world = new World({
    gravity: new Vec3(0, GRAVITY, 0),
  });
  world.broadphase = new SAPBroadphase(world);
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.45;
  world.defaultContactMaterial.restitution = 0.02;

  const halfW = BRICK.x * 0.5;
  const halfH = BRICK.y * 0.5;
  const halfD = DEPTH * 0.5;
  const brickShape = new Box(new Vec3(halfW, halfH, halfD));
  const maxDist = Math.hypot(((COLS - 1) * STRIDE_X) * 0.5, ((ROWS - 1) * STRIDE_Y) * 0.5);
  const bricks = [];
  for (let i = 0; i < count; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const origin = new THREE.Vector3(
      (col - (COLS - 1) * 0.5) * STRIDE_X,
      (row - (ROWS - 1) * 0.5) * STRIDE_Y,
      0
    );
    const dist = Math.hypot(origin.x, origin.y);
    const body = new Body({ mass: 0, allowSleep: false });
    body.addShape(brickShape);
    body.position.set(origin.x, origin.y, 0);
    body.collisionFilterGroup = 1;
    body.collisionFilterMask = 1;
    world.addBody(body);
    const anchor = new Body({ mass: 0 });
    anchor.position.set(origin.x, origin.y - halfH, 0);
    world.addBody(anchor);
    const hinge = new HingeConstraint(body, anchor, {
      pivotA: new Vec3(0, -halfH, 0),
      pivotB: new Vec3(0, 0, 0),
      axisA: new Vec3(1, 0, 0),
      axisB: new Vec3(1, 0, 0),
      collideConnected: false,
    });
    bricks.push({
      origin,
      pos: origin.clone(),
      quat: new THREE.Quaternion(),
      body,
      hinge,
      constraintOn: false,
      released: false,
      hinged: false,
      dusted: false,
      dustAt: 0,
      delay: (dist / Math.max(maxDist, 0.001)) * WAVE,
      fade: 1,
      seed: Math.random(),
    });
  }
  const dummy = new THREE.Object3D();
  const homeQuat = new THREE.Quaternion();
  const dragForce = new Vec3();

  function hingeAngleOf(body) {
    const q = body.quaternion;
    const sinX = 2 * (q.w * q.x + q.y * q.z);
    const cosX = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(sinX, cosX);
  }

  function releaseBrick(brick) {
    const theta = 0.045 + brick.seed * 0.02;
    const pivotY = brick.origin.y - halfH;
    const body = brick.body;
    body.position.set(brick.origin.x, brick.origin.y, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0.12, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    body.mass = BRICK_MASS;
    body.type = Body.DYNAMIC;
    body.collisionFilterMask = 0;
    body.updateMassProperties();
    body.position.set(
      brick.origin.x,
      pivotY + halfH * Math.cos(theta),
      halfH * Math.sin(theta)
    );
    body.quaternion.set(Math.sin(theta * 0.5), 0, 0, Math.cos(theta * 0.5));
    body.wakeUp();
    world.addConstraint(brick.hinge);
    brick.constraintOn = true;
    brick.released = true;
    brick.hinged = true;
    brick.dusted = false;
    brick.dustAt = 0;
    emitFromBody(body, 0, halfH, 0, 6);
  }

  function detachBrick(brick) {
    if (brick.constraintOn) {
      world.removeConstraint(brick.hinge);
      brick.constraintOn = false;
    }
    brick.hinged = false;
    brick.body.collisionFilterMask = 1;
    brick.body.wakeUp();
    emitFromBody(brick.body, 0, -halfH, 0, 4);
  }

  function parkBrick(brick) {
    if (brick.constraintOn) {
      world.removeConstraint(brick.hinge);
      brick.constraintOn = false;
    }
    const body = brick.body;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    body.position.set(brick.origin.x, brick.origin.y, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.mass = 0;
    body.type = Body.STATIC;
    body.collisionFilterMask = 1;
    body.updateMassProperties();
  }

  function syncBricks() {
    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i];
      dummy.position.copy(brick.pos);
      dummy.quaternion.copy(brick.quat);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      wall.setMatrixAt(i, dummy.matrix);
      fades[i] = brick.fade;
    }
    wall.instanceMatrix.needsUpdate = true;
    fadeAttr.needsUpdate = true;
  }

  function simulate(dt, now) {
    const elapsed = (now - startedAt) / 1000;
    let settled = mode === 'reforming';
    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i];
      if (mode === 'collapsing' || mode === 'collapsed') {
        if (!brick.released && elapsed >= brick.delay) releaseBrick(brick);
        if (brick.released && brick.hinged) {
          const angle = hingeAngleOf(brick.body);
          const spinning = Math.hypot(
            brick.body.angularVelocity.x,
            brick.body.angularVelocity.y,
            brick.body.angularVelocity.z
          );
          if (!brick.dusted && angle > 0.5) {
            brick.dusted = true;
            emitFromBody(brick.body, 0, halfH, 0, 4);
          }
          if (now - brick.dustAt > 480 && spinning > 0.45) {
            brick.dustAt = now;
            emitFromBody(brick.body, (brick.seed - 0.5) * BRICK.x * 0.5, halfH, 0, 2);
          }
          if (angle > 1.15) detachBrick(brick);
        }
      } else if (mode === 'reforming') {
        const k = 1 - Math.pow(0.002, dt);
        brick.pos.lerp(brick.origin, Math.min(1, k));
        brick.quat.slerp(homeQuat, Math.min(1, k));
        brick.hinged = false;
        brick.fade = 1;
        if (brick.pos.distanceToSquared(brick.origin) < 0.0008 && brick.quat.angleTo(homeQuat) < 0.04) {
          brick.pos.copy(brick.origin);
          brick.quat.identity();
          brick.released = false;
        } else {
          settled = false;
        }
      }
    }
    if (mode === 'collapsing' || mode === 'collapsed') {
      applyDustDrag(now);
      world.step(1 / 60, dt, 6);
      for (let i = 0; i < bricks.length; i++) {
        const brick = bricks[i];
        if (!brick.released) continue;
        const body = brick.body;
        brick.pos.set(body.position.x, body.position.y, body.position.z);
        brick.quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        const below = Math.max(0, -brick.pos.y - WALL_H * 0.95);
        brick.fade = Math.max(0, 1 - below * 0.1);
      }
    }
    if (mode === 'reforming' && settled) {
      for (let i = 0; i < bricks.length; i++) parkBrick(bricks[i]);
      mode = 'idle';
      collapse = 0;
      updateUI();
    }
    syncBricks();
  }

  function restoreBricks() {
    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i];
      parkBrick(brick);
      brick.pos.copy(brick.origin);
      brick.quat.identity();
      brick.released = false;
      brick.hinged = false;
      brick.dusted = false;
      brick.dustAt = 0;
      brick.fade = 1;
    }
    syncBricks();
    clearPowder();
  }
  const POWDER = 2000;
  const powder = [];
  const powderPos = new Float32Array(POWDER * 3);
  const powderAlpha = new Float32Array(POWDER);
  const powderGrow = new Float32Array(POWDER);
  const powderSeed = new Float32Array(POWDER);
  const dustShape = new Sphere(0.02);
  for (let i = 0; i < POWDER; i++) {
    const body = new Body({
      mass: 0,
      allowSleep: false,
      collisionFilterGroup: 2,
      collisionFilterMask: 0,
      linearDamping: 0.02,
      angularDamping: 1,
    });
    body.addShape(dustShape);
    body.type = Body.STATIC;
    powder.push({
      active: false,
      inWorld: false,
      life: 0,
      max: 1,
      lane: 0,
      body,
    });
    powderSeed[i] = Math.random();
    powderPos[i * 3 + 1] = -40;
  }
  let powderCursor = 0;
  const localPoint = new Vec3();
  const worldPoint = new Vec3();
  const pointVel = new Vec3();

  function retireSpeck(speck, index) {
    speck.active = false;
    powderAlpha[index] = 0;
    powderGrow[index] = 0;
    if (speck.inWorld) {
      world.removeBody(speck.body);
      speck.inWorld = false;
    }
    speck.body.velocity.set(0, 0, 0);
    speck.body.force.set(0, 0, 0);
    speck.body.mass = 0;
    speck.body.type = Body.STATIC;
  }

  function spawnPowder(x, y, z, vx, vy, vz) {
    const i = powderCursor;
    powderCursor = (powderCursor + 1) % POWDER;
    const speck = powder[i];
    if (speck.inWorld) retireSpeck(speck, i);
    const body = speck.body;
    body.position.set(x, y, z);
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    body.mass = DUST_MASS;
    body.type = Body.DYNAMIC;
    body.updateMassProperties();
    world.addBody(body);
    body.wakeUp();
    speck.inWorld = true;
    speck.active = true;
    speck.lane = Math.random();
    speck.max = 9 + Math.random() * 4;
    speck.life = speck.max;
  }

  function emitFromBody(body, localX, localY, localZ, count) {
    for (let k = 0; k < count; k++) {
      const depth = Math.pow(Math.random(), 0.65) * 1.15;
      localPoint.set(
        localX + (Math.random() - 0.5) * 0.5,
        localY + (Math.random() - 0.5) * 0.32,
        localZ + depth
      );
      body.quaternion.vmult(localPoint, worldPoint);
      body.position.vadd(worldPoint, worldPoint);
      body.getVelocityAtWorldPoint(worldPoint, pointVel);
      const speed = Math.hypot(pointVel.x, pointVel.y, pointVel.z);
      const spread = 0.28 * speed + 0.1;
      spawnPowder(
        worldPoint.x,
        worldPoint.y,
        worldPoint.z,
        pointVel.x + (Math.random() - 0.5) * spread,
        pointVel.y + (Math.random() - 0.5) * spread * 0.8 + 0.04,
        pointVel.z + (Math.random() - 0.2) * spread + 0.08
      );
    }
  }

  const wind = new Vec3();

  function sampleWind(x, y, z, time, lane) {
    const t = time * 0.001;
    const wx = Math.sin(y * 0.85 + z * 0.7 + t * 0.8) * 0.66 + Math.cos(z * 1.05 - t * 0.35) * 0.2;
    const wy = Math.cos(x * 0.68 + z * 0.5 + t * 0.55) * 0.42 + 0.36;
    let wz = 0.16 + Math.sin(x * 0.42 + y * 0.3 + t * 0.28) * 0.14;
    if (lane < 0.34) wz *= 0.18;
    else if (lane < 0.68) wz += 0.38;
    else wz += 0.9;
    wind.set(wx, wy, wz);
  }

  function applyDustDrag(now) {
    for (let i = 0; i < POWDER; i++) {
      const speck = powder[i];
      if (!speck.active) continue;
      const velocity = speck.body.velocity;
      const position = speck.body.position;
      sampleWind(position.x, position.y, position.z, now, speck.lane);
      const rx = velocity.x - wind.x;
      const ry = velocity.y - wind.y;
      const rz = velocity.z - wind.z;
      const speed = Math.hypot(rx, ry, rz);
      if (speed < 1e-5) continue;
      dragForce.set(-DUST_DRAG * speed * rx, -DUST_DRAG * speed * ry, -DUST_DRAG * speed * rz);
      speck.body.force.vadd(dragForce, speck.body.force);
    }
  }

  function simulatePowder(dt) {
    for (let i = 0; i < POWDER; i++) {
      const speck = powder[i];
      if (!speck.active) {
        powderAlpha[i] = 0;
        continue;
      }
      speck.life -= dt;
      const position = speck.body.position;
      if (speck.life <= 0 || position.y < -WALL_H * 1.4) {
        retireSpeck(speck, i);
        continue;
      }
      const u = 1 - speck.life / speck.max;
      const fadeIn = Math.min(1, u / 0.06);
      const fadeOut = Math.min(1, (1 - u) / 0.24);
      powderPos[i * 3] = position.x;
      powderPos[i * 3 + 1] = position.y;
      powderPos[i * 3 + 2] = position.z;
      powderAlpha[i] = fadeIn * fadeOut;
      powderGrow[i] = 0.75 + u * 0.7;
    }
    powderPosAttr.needsUpdate = true;
    powderAlphaAttr.needsUpdate = true;
    powderGrowAttr.needsUpdate = true;
  }

  function clearPowder() {
    for (let i = 0; i < POWDER; i++) {
      if (powder[i].active || powder[i].inWorld) retireSpeck(powder[i], i);
      powderAlpha[i] = 0;
      powderGrow[i] = 0;
    }
    powderPosAttr.needsUpdate = true;
    powderAlphaAttr.needsUpdate = true;
    powderGrowAttr.needsUpdate = true;
  }

  const powderGeometry = new THREE.BufferGeometry();
  const powderPosAttr = new THREE.BufferAttribute(powderPos, 3);
  const powderAlphaAttr = new THREE.BufferAttribute(powderAlpha, 1);
  const powderGrowAttr = new THREE.BufferAttribute(powderGrow, 1);
  powderPosAttr.setUsage(THREE.DynamicDrawUsage);
  powderAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  powderGrowAttr.setUsage(THREE.DynamicDrawUsage);
  powderGeometry.setAttribute('position', powderPosAttr);
  powderGeometry.setAttribute('aAlpha', powderAlphaAttr);
  powderGeometry.setAttribute('aGrow', powderGrowAttr);
  powderGeometry.setAttribute('aSeed', new THREE.BufferAttribute(powderSeed, 1));
  const powderMaterial = new THREE.ShaderMaterial({
    vertexShader: powderVertex,
    fragmentShader: powderFragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });
  const powderPoints = new THREE.Points(powderGeometry, powderMaterial);
  powderPoints.frustumCulled = false;
  powderPoints.renderOrder = 3;
  scene.add(powderPoints);

  const dustCount = 160;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSeeds = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * WALL_W * 1.15;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * WALL_H * 1.3;
    dustPositions[i * 3 + 2] = -0.05 + Math.random() * 2.4;
    dustSeeds[i] = Math.random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(dustSeeds, 1));
  const dustMaterial = makeAdditiveMaterial({
    uniforms: { uTime: uniforms.uTime },
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
  });
  dustMaterial.depthTest = true;
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  scene.add(dust);

  const screenScene = new THREE.Scene();
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  screen.frustumCulled = false;
  screenScene.add(screen);

  function makeTarget(width, height, withDepth) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: rtType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: !!withDepth,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    return target;
  }

  let sceneRT = makeTarget(2, 2, true);
  let ping = makeTarget(2, 2, false);
  let pong = makeTarget(2, 2, false);

  const thresholdMat = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      uThreshold: { value: 0.62 },
    },
    vertexShader: screenVertex,
    fragmentShader: thresholdFragment,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uDirection: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: screenVertex,
    fragmentShader: blurFragment,
  });
  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.55 },
      uExposure: { value: 1.12 },
    },
    vertexShader: screenVertex,
    fragmentShader: compositeFragment,
  });

  let baseZ = 16;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let mode = 'idle';
  let collapse = 0;
  let startedAt = 0;

  function frameCamera() {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const halfFov = (camera.fov * Math.PI) / 360;
    const distV = (WALL_H * 0.5) / Math.tan(halfFov);
    const distH = (WALL_W * 0.5) / (Math.tan(halfFov) * aspect);
    baseZ = Math.max(distV, distH) * 0.68;
  }

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    const bloomW = Math.max(2, Math.floor(width / 2));
    const bloomH = Math.max(2, Math.floor(height / 2));
    sceneRT.setSize(width, height);
    ping.setSize(bloomW, bloomH);
    pong.setSize(bloomW, bloomH);
    blurMat.uniforms.uTexel.value.set(1 / bloomW, 1 / bloomH);
    frameCamera();
  }

  function blit(material, target) {
    screen.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(screenScene, screenCamera);
  }

  function blur(x, y) {
    blurMat.uniforms.tInput.value = ping.texture;
    blurMat.uniforms.uDirection.value.set(x, y);
    blit(blurMat, pong);
    const swap = ping;
    ping = pong;
    pong = swap;
  }

  function updateUI() {
    document.body.dataset.state = mode;
    buttonLabel.textContent = mode === 'collapsed' || mode === 'reforming' ? '重组' : '触发';
    statusLabel.textContent = {
      idle: '墙体完整',
      collapsing: '自中心崩解',
      collapsed: '已经倒塌',
      reforming: '自中心重组',
    }[mode];
    meter.style.width = (collapse * 100).toFixed(2) + '%';
    triggerButton.disabled = mode === 'collapsing' || mode === 'reforming';
  }

  function trigger() {
    if (mode === 'collapsing' || mode === 'reforming') return;
    mode = mode === 'collapsed' ? 'reforming' : 'collapsing';
    if (mode === 'reforming') clearPowder();
    startedAt = performance.now();
    updateUI();
  }

  function resetWall() {
    mode = 'idle';
    collapse = 0;
    restoreBricks();
    updateUI();
  }

  triggerButton.addEventListener('click', function (event) {
    event.stopPropagation();
    trigger();
  });
  canvas.addEventListener('pointerdown', function (event) {
    if (event.target !== canvas) return;
    trigger();
  });
  window.addEventListener('keydown', function (event) {
    if (event.code === 'Space') {
      event.preventDefault();
      if (event.repeat) return;
      trigger();
    } else if (event.code === 'KeyR') {
      resetWall();
    }
  });
  window.addEventListener('pointermove', function (event) {
    pointer.tx = (event.clientX / window.innerWidth - 0.5) * 0.65;
    pointer.ty = (0.5 - event.clientY / window.innerHeight) * 0.28;
  });
  window.addEventListener('resize', resize);

  makeGrain();
  resize();
  updateUI();
  restoreBricks();

  let lastTime = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (mode === 'collapsing') {
      const elapsed = (now - startedAt) / 1000;
      collapse = Math.min(1, elapsed / WAVE);
      if (elapsed >= WAVE) {
        mode = 'collapsed';
        collapse = 1;
      }
      updateUI();
    }
    if (mode !== 'idle') simulate(dt, now);
    simulatePowder(dt);

    uniforms.uTime.value = now * 0.001;
    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;
    camera.position.set(pointer.x * 0.04, pointer.y * 0.03, baseZ);
    camera.lookAt(0, 0, 0);

    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    thresholdMat.uniforms.tInput.value = sceneRT.texture;
    blit(thresholdMat, ping);
    blur(2.2, 0);
    blur(0, 2.2);
    blur(6.5, 0);
    blur(0, 6.5);

    compositeMat.uniforms.tScene.value = sceneRT.texture;
    compositeMat.uniforms.tBloom.value = ping.texture;
    blit(compositeMat, null);
  }

  requestAnimationFrame(tick);
}

try {
  init();
} catch (error) {
  showError(error && error.message ? error.message : String(error));
}
