// Builds the Three.js scene for a MapDef: merged textured blockout, sky panorama, cloud sea, lights, props, pads, point.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box, MapDef, Mat } from '../data/maps';
import { Level } from '../engine/Physics';
import { propModel, texture } from './Assets';

export interface Quality { shadows: number; pixelRatio: number; particles: number; bloom: boolean; tex: 'hi' | 'lo'; }

const TILE = 6;

/** box with world-space UVs (so textures keep their scale on any size) */
function boxGeo(b: Box, thick = 0): THREE.BufferGeometry {
  const y0 = (b.y ?? 0) - thick, y1 = (b.y ?? 0) + b.h;
  const g = new THREE.BoxGeometry(b.w, y1 - y0, b.d);
  g.translate(b.x, (y0 + y1) / 2, b.z);
  worldUV(g);
  return g;
}
function wedgeGeo(b: Box): THREE.BufferGeometry {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y ?? 0, y1 = y0 + b.h;
  // heights at the four top corners
  const hAt = (x: number, z: number) => Level.top(b, x, z)!;
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [x, Math.max(y0 + 0.001, hAt(x, z)), z]);
  const pos: number[] = [];
  const quad = (a: number[], bb: number[], cc: number[], d: number[]) => pos.push(...a, ...bb, ...cc, ...a, ...cc, ...d);
  quad(c[0], c[3], c[2], c[1]);                                       // sloped top
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);        // bottom
  quad([x0, y0, z0], [x0, c[0][1], z0], [x1, c[1][1], z0], [x1, y0, z0]);
  quad([x1, y0, z1], [x1, c[2][1], z1], [x0, c[3][1], z1], [x0, y0, z1]);
  quad([x0, y0, z1], [x0, c[3][1], z1], [x0, c[0][1], z0], [x0, y0, z0]);
  quad([x1, y0, z0], [x1, c[1][1], z0], [x1, c[2][1], z1], [x1, y0, z1]);
  void y1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  worldUV(g);
  return g.toNonIndexed();
}
function worldUV(g: THREE.BufferGeometry) {
  const p = g.attributes.position, n = g.attributes.normal ?? (g.computeVertexNormals(), g.attributes.normal);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / TILE; uv[i * 2 + 1] = v / TILE;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** cherry-blossom canopy (image-to-3D keeps the trunk but loses thin foliage) */
function blossoms(s: number): THREE.Object3D {
  const n = 70;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffb3cf', emissive: new THREE.Color('#ff8fb8'), emissiveIntensity: 0.18, roughness: 0.8, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s * 0.42;
    p.set(Math.cos(a) * r, s * (0.62 + rnd() * 0.3) - r * 0.25, Math.sin(a) * r);
    const k = s * (0.07 + rnd() * 0.07);
    sc.set(k * 1.3, k, k * 1.3);
    q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd()));
    inst.setMatrixAt(i, m.compose(p, q, sc));
    inst.setColorAt(i, new THREE.Color().setHSL(0.93 + rnd() * 0.04, 0.7, 0.72 + rnd() * 0.12));
  }
  inst.castShadow = true;
  return inst;
}

export class MapScene {
  group = new THREE.Group();
  sun: THREE.DirectionalLight;
  pointRing: THREE.Mesh;
  pointDisc: THREE.Mesh;
  particles: THREE.Points | null = null;
  clouds: THREE.Mesh | null = null;
  pads: THREE.Object3D[] = [];
  private pUniforms = { t: { value: 0 } };
  private cloudU = { t: { value: 0 } };

  constructor(public map: MapDef, public level: Level, q: Quality, scene: THREE.Scene) {
    const m = map;
    scene.background = new THREE.Color(m.fog[0]);
    scene.fog = new THREE.Fog(m.fog[0], m.fog[1], m.fog[2]);
    // ---------------- lights
    const hemi = new THREE.HemisphereLight(m.ambient[0], m.ambient[1], m.ambient[2]);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight(m.sun.color, m.sun.intensity);
    const sd = new THREE.Vector3(...m.sun.dir).normalize();
    this.sun.position.copy(sd.multiplyScalar(80));
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows) {
      const S = Math.max(m.size[0], m.size[1]) + 10;
      Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 220 });
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    }
    this.group.add(this.sun, this.sun.target);
    const tint = new THREE.PointLight(m.tint, 30, 40, 1.6);
    tint.position.set(m.point[0], m.point[1] + 5, m.point[2]);
    this.group.add(tint);
    // ---------------- materials
    const tex = (k: 'ground' | 'wall') => texture(`env/tex_${m.id}_${k}.webp`);
    const mats: Record<Mat, THREE.Material> = {
      ground: new THREE.MeshStandardMaterial({ map: tex('ground'), color: new THREE.Color(m.id === 'hangar' ? '#6e6a62' : '#b8b8b8'), roughness: 0.85, metalness: 0.05 }),
      wall: new THREE.MeshStandardMaterial({ map: tex('wall'), roughness: 0.75, metalness: 0.1 }),
      trim: new THREE.MeshStandardMaterial({ map: tex('wall'), color: new THREE.Color('#d8d2c8'), roughness: 0.6, metalness: 0.25 }),
      accent: new THREE.MeshStandardMaterial({ map: tex('wall'), color: new THREE.Color(m.tint).lerp(new THREE.Color('#ffffff'), 0.4), emissive: new THREE.Color(m.tint), emissiveIntensity: 0.25, roughness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: new THREE.Color(m.tint), transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, emissive: new THREE.Color(m.tint), emissiveIntensity: 0.3 }),
    };
    const buckets: Record<string, THREE.BufferGeometry[]> = {};
    const add = (mat: Mat, g: THREE.BufferGeometry) => (buckets[mat] ??= []).push(g.index ? g.toNonIndexed() : g);
    const voidMap = map.floors.length > 1;
    for (const f of map.floors) {
      add(f.mat ?? 'ground', boxGeo({ ...f, h: 0.01 }, voidMap ? 0.01 : 0.5));
      if (voidMap) {
        // floating island underside: a rock skirt that tapers into the clouds
        const under = new THREE.CylinderGeometry(1, 0.35, 1, 7, 1);
        under.scale(Math.max(f.w, f.d) * 0.55, Math.min(f.w, f.d) * 0.5 + 3, Math.min(f.w, f.d) * 0.55);
        under.translate(f.x, -(Math.min(f.w, f.d) * 0.25 + 1.5), f.z);
        worldUV(under);
        if (f.mat !== 'trim') add('wall', under);
        else add('trim', boxGeo({ ...f, h: 0.01 }, 0.4));
      }
    }
    for (const b of map.boxes) add(b.mat ?? 'wall', b.ramp ? wedgeGeo(b) : boxGeo(b));
    for (const [k, list] of Object.entries(buckets)) {
      for (const g of list) { if (!g.attributes.normal) g.computeVertexNormals(); for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); }
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[k as Mat]);
      mesh.castShadow = k !== 'ground'; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // ---------------- sky: panorama wrapped twice around a cylinder
    const skyTex = texture(`env/sky_${m.id}.webp`, true);
    skyTex.wrapS = THREE.MirroredRepeatWrapping; skyTex.repeat.set(2, 1);
    const R = 420, circ = 2 * Math.PI * R, H = circ / 2 / 2.4;
    const skyGeo = new THREE.CylinderGeometry(R, R, H, 64, 1, true);
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.y = H / 2 - 120; sky.renderOrder = -10;
    const capTop = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(m.ambient[0]).multiplyScalar(0.8), side: THREE.BackSide, fog: false, depthWrite: false }));
    capTop.rotation.x = -Math.PI / 2; capTop.position.y = H - 120;
    const capBot = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(m.fog[0]), fog: false, depthWrite: false }));
    capBot.rotation.x = -Math.PI / 2; capBot.position.y = -120;
    this.group.add(sky, capTop, capBot);
    // ---------------- cloud sea under floating maps
    if (voidMap) {
      const cg = new THREE.PlaneGeometry(900, 900, 1, 1); cg.rotateX(-Math.PI / 2);
      const cm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: { t: this.cloudU.t, c1: { value: new THREE.Color(m.fog[0]) }, c2: { value: new THREE.Color(m.id === 'rift' ? '#3a1a66' : '#ffffff') } },
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
        fragmentShader: `uniform float t; uniform vec3 c1; uniform vec3 c2; varying vec2 vUv; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
          float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
          void main(){ vec2 p=vW.xz*0.018; float f=fbm(p+vec2(t*0.02,t*0.013)); float f2=fbm(p*2.3-vec2(t*0.03,0.0));
            float d=length(vW.xz)/450.0; vec3 col=mix(c1,c2,smoothstep(0.35,0.8,f*0.7+f2*0.4));
            gl_FragColor=vec4(col, (1.0-smoothstep(0.6,1.0,d))*0.95); }`,
      });
      this.clouds = new THREE.Mesh(cg, cm);
      this.clouds.position.y = -22;
      this.group.add(this.clouds);
    }
    // ---------------- capture point
    if (m.id !== 'training') {
      const [px, py, pz] = m.point;
      this.pointRing = new THREE.Mesh(new THREE.TorusGeometry(6, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
      this.pointRing.rotation.x = Math.PI / 2; this.pointRing.position.set(px, py + 0.06, pz);
      this.pointDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { t: this.pUniforms.t, c: { value: new THREE.Color('#ffffff') }, prog: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `uniform float t; uniform vec3 c; uniform float prog; varying vec2 vUv;
          void main(){ vec2 p=vUv-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x)/6.2831+0.5;
            float ring=smoothstep(0.02,0.0,abs(fract(r*4.0-t*0.6)-0.5)-0.46);
            float fill=step(a,prog)*step(0.86,r)*step(r,0.96);
            gl_FragColor=vec4(c,(ring*0.25+fill*0.8+0.08)*(1.0-smoothstep(0.96,1.0,r))); }`,
      }));
      this.pointDisc.rotation.x = -Math.PI / 2; this.pointDisc.position.set(px, py + 0.05, pz);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 40, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.position.set(px, py + 20, pz); beam.name = 'pointBeam';
      this.group.add(this.pointRing, this.pointDisc, beam);
    } else {
      this.pointRing = new THREE.Mesh(); this.pointDisc = new THREE.Mesh();
    }
    // ---------------- jump pads
    for (const p of m.pads) {
      const y = p.y ?? level.groundAt(p.x, p.z, 10);
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.15, 8, 32), new THREE.MeshBasicMaterial({ color: m.tint }));
      ring.rotation.x = Math.PI / 2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: m.tint, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 3), new THREE.MeshBasicMaterial({ color: m.tint, transparent: true, opacity: 0.6 }));
      const dir = new THREE.Vector3(p.vx, p.vy, p.vz).normalize();
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      arrow.position.y = 1.2; arrow.name = 'arrow';
      g.add(ring, disc, arrow);
      g.position.set(p.x, y + 0.05, p.z);
      this.pads.push(g); this.group.add(g);
    }
    // ---------------- props (GLB when available, stand-in otherwise)
    for (const p of m.props) this.placeProp(p.id, p.x, p.z, p.y, p.rot ?? 0, p.s ?? 2, p.solid ?? 0.5);
    // ---------------- ambient particles
    if (m.particles !== 'none' && q.particles > 0) this.makeParticles(m, q);
    scene.add(this.group);
  }

  private async placeProp(id: string, x: number, z: number, y: number | undefined, rot: number, s: number, solid: number) {
    const gy = y ?? Math.max(0, this.level.groundAt(x, z, 60));
    const holder = new THREE.Group();
    holder.position.set(x, gy, z); holder.rotation.y = rot;
    this.group.add(holder);
    // stand-in until (or instead of) a generated model: a glowing crystal cluster in the map's accent colour
    const stand = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: this.map.tint, emissive: new THREE.Color(this.map.tint), emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, flatShading: true });
    for (const [dx, dz, k, tilt] of [[0, 0, 1, 0], [solid * 0.7, 0.2, 0.62, 0.35], [-solid * 0.6, -0.3, 0.5, -0.4], [0.1, solid * 0.7, 0.42, 0.25]] as number[][]) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), cm);
      c.scale.set(solid * 0.55 * k + 0.1, s * 0.5 * k, solid * 0.55 * k + 0.1);
      c.position.set(dx, s * 0.45 * k, dz); c.rotation.z = tilt; c.castShadow = true;
      stand.add(c);
    }
    holder.add(stand);
    const m = await propModel(id);
    if (!m) return;
    const box = new THREE.Box3().setFromObject(m);
    const h = box.max.y - box.min.y || 1;
    m.scale.setScalar(s / h);
    m.position.y = -box.min.y * (s / h);
    const cx = (box.min.x + box.max.x) / 2 * (s / h), cz = (box.min.z + box.max.z) / 2 * (s / h);
    m.position.x = -cx; m.position.z = -cz;
    holder.remove(stand);
    holder.add(m);
    if (id.includes('sakura')) holder.add(blossoms(s));
  }

  private makeParticles(m: MapDef, q: Quality) {
    const n = Math.round((m.particles === 'rain' ? 5000 : 1400) * q.particles);
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const [X, Z] = m.size;
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() * 2 - 1) * (X + 10); pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() * 2 - 1) * (Z + 10); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const cfg: Record<string, [string, number, number, number]> = {   // colour, size, fall speed, sway
      petals: ['#ffb7d5', 0.22, 1.2, 1.5], rain: ['#9fb6ff', 0.06, 22, 0.1], sparks: ['#ffb040', 0.08, -1.5, 0.6], embers: ['#ff4d2a', 0.1, -1.2, 0.8], motes: ['#c9a2ff', 0.12, -0.4, 1.2],
    };
    const [col, size, fall, sway] = cfg[m.particles];
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: m.particles === 'petals' ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { t: this.pUniforms.t, c: { value: new THREE.Color(col) }, size: { value: size }, fall: { value: fall }, sway: { value: sway }, rain: { value: m.particles === 'rain' ? 1 : 0 } },
      vertexShader: `uniform float t; uniform float size; uniform float fall; uniform float sway; uniform float rain; attribute float seed; varying float vA;
        void main(){ vec3 p=position; p.y=mod(p.y - t*fall*(0.6+seed*0.8), 30.0) - 2.0 ; p.x+=sin(t*0.7+seed*20.0)*sway; p.z+=cos(t*0.5+seed*13.0)*sway;
          vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=size*(rain>0.5?900.0:600.0)/-mv.z; vA=0.5+0.5*seed; }`,
      fragmentShader: `uniform vec3 c; uniform float rain; varying float vA; void main(){ vec2 d=gl_PointCoord-0.5; float a= rain>0.5 ? (1.0-smoothstep(0.03,0.08,abs(d.x)))*0.5 : 1.0-smoothstep(0.2,0.5,length(d)); gl_FragColor=vec4(c,a*vA); }`,
    });
    this.particles = new THREE.Points(g, mat);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);
  }

  update(time: number, point: { owner: string | null; capture: number; capTeam: string | null; contested: boolean }, viewerTeam: string) {
    this.pUniforms.t.value = time;
    this.cloudU.t.value = time;
    for (const p of this.pads) { const a = p.getObjectByName('arrow')!; a.position.y = 1.1 + Math.sin(time * 4) * 0.25; p.rotation.y = time * 0.5; }
    if (this.map.id === 'training') return;
    const col = point.contested ? '#ffcc33' : point.owner === null ? '#ffffff' : point.owner === viewerTeam ? '#5cc8ff' : '#ff3b5c';
    (this.pointRing.material as THREE.MeshBasicMaterial).color.set(col);
    const du = (this.pointDisc.material as THREE.ShaderMaterial).uniforms;
    du.c.value.set(point.capTeam ? (point.capTeam === viewerTeam ? '#5cc8ff' : '#ff3b5c') : col);
    du.prog.value = point.capture / 100;
    const beam = this.group.getObjectByName('pointBeam') as THREE.Mesh | undefined;
    if (beam) (beam.material as THREE.MeshBasicMaterial).color.set(col);
  }
}
