// 행성 지형, 하늘·바다, 나무, 랜드마크, 캐릭터 모델.
window.World = (function () {
  const D = window.GameData;
  const R = 986;          // 행성 반지름 (대륙 넓이를 좌우한다. 360일 때보다 넓이 7.5배)
  const W = 1800, H = 900; // 지형 격자 해상도
  const RAD = Math.PI / 180;

  let scene_ = null, atmosphere_ = null, lite = false; // lite: 휴대폰용 가벼운 설정
  const cullables = [], propSets = []; // 카메라 위치에 따라 켜고 끄는 물체들

  const heightGrid = new Float32Array(W * H);
  const contGrid = new Uint8Array(W * H);
  const desertGrid = new Float32Array(W * H);

  /* ---------- 수학 도우미 ---------- */
  function ll2v(lat, lon, out) {
    const a = lat * RAD, o = lon * RAD;
    return (out || new THREE.Vector3()).set(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o));
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;

  // 재현 가능한 난수 (지형·나무 배치 고정)
  let seed = 20260000;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const perm = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) perm[i] = rnd();
  const hash = (x, y, z) => perm[((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 4095];
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const a = mix(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), b = mix(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u);
    const c = mix(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), d = mix(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u);
    return mix(mix(a, b, v), mix(c, d, v), w);
  }
  function fbm(x, y, z, oct) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); n += a; a *= 0.5; x = x * 2.03 + 11; y = y * 2.03 + 7; z = z * 2.03 + 3; }
    return s / n;
  }

  /* ---------- 지형 격자 ---------- */
  function sampleArr(arr, u, v) {
    u -= 0.5; v -= 0.5;
    v = clamp(v, 0, H - 1.001);
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
    const r0 = y0 * W, r1 = r0 + W;
    return mix(mix(arr[r0 + xa], arr[r0 + xb], fx), mix(arr[r1 + xa], arr[r1 + xb], fx), fy);
  }
  function uvOf(d) {
    const lon = Math.atan2(-d.z, d.x), lat = Math.asin(clamp(d.y, -1, 1));
    return [(lon / (2 * Math.PI) + 0.5) * W, (0.5 - lat / Math.PI) * H];
  }
  function heightAt(d) { const [u, v] = uvOf(d); return sampleArr(heightGrid, u, v); }
  function contAt(d) {
    const [u, v] = uvOf(d);
    return contGrid[clamp(Math.floor(v), 0, H - 1) * W + ((Math.floor(u) % W) + W) % W];
  }

  const px = (lon) => (lon + 180) / 360 * W, py = (lat) => (90 - lat) / 180 * H;

  function raster(draw) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const off of [-W, 0, W]) { g.setTransform(1, 0, 0, 1, off, 0); draw(g); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return g.getImageData(0, 0, W, H).data;
  }
  function polyPath(g, pts) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    g.closePath();
  }
  function toFloat(data) {
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = data[i * 4] / 255;
    return out;
  }
  function blur(arr, rad, passes) {
    const tmp = new Float32Array(W * H), n = rad * 2 + 1;
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < H; y++) {
        let s = 0; const r = y * W;
        for (let i = -rad; i <= rad; i++) s += arr[r + ((i + W) % W)];
        for (let x = 0; x < W; x++) {
          tmp[r + x] = s / n;
          s += arr[r + (x + rad + 1) % W] - arr[r + (x - rad + W) % W];
        }
      }
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) s += tmp[clamp(i, 0, H - 1) * W + x];
        for (let y = 0; y < H; y++) {
          arr[y * W + x] = s / n;
          s += tmp[clamp(y + rad + 1, 0, H - 1) * W + x] - tmp[clamp(y - rad, 0, H - 1) * W + x];
        }
      }
    }
    return arr;
  }

  // 랜드마크 목록: 지형을 평평하게 다지고, 충돌 범위로도 쓴다
  const landmarks = [];
  for (const id in D.SPOTS) for (const s of D.SPOTS[id]) landmarks.push({ ...s, cont: +id, dir: ll2v(s.lat, s.lon) });
  for (const s of D.EXTRAS) landmarks.push({ ...s, dir: ll2v(s.lat, s.lon) });

  function bakeTerrain() {
    const mask = blur(toFloat(raster((g) => {
      g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round';
      g.lineWidth = W / 360 * 2.4; // 해안선을 바깥으로 넓힌다
      for (const p of D.POLYGONS) { polyPath(g, p.pts); g.stroke(); g.fill(); }
    })), 4, 2);

    const mtn = blur(toFloat(raster((g) => {
      g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const m of D.MOUNTAINS) {
        g.lineWidth = m.w * W / 360;
        g.beginPath();
        m.pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
        g.stroke();
      }
    })), 7, 2);

    const des = blur(toFloat(raster((g) => {
      g.fillStyle = '#fff';
      for (const [lo, la, rx, ry] of D.DESERTS) {
        g.beginPath();
        g.ellipse(px(lo), py(la), rx * W / 360, ry * H / 180, 0, 0, Math.PI * 2);
        g.fill();
      }
    })), 9, 2);
    desertGrid.set(des);

    // 대륙 번호: 해안선 흔들림까지 덮도록 테두리를 두껍게 칠한다
    const idc = raster((g) => {
      g.lineJoin = 'round';
      for (const p of D.POLYGONS) {
        const col = `rgb(${p.id * 30},0,0)`;
        g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 28;
        polyPath(g, p.pts); g.stroke(); g.fill();
      }
    });
    for (let i = 0; i < W * H; i++) contGrid[i] = Math.round(idc[i * 4] / 30);

    const dx = new Float32Array(W * H), dy = new Float32Array(W * H), dz = new Float32Array(W * H);
    const v = new THREE.Vector3();
    for (let y = 0; y < H; y++) {
      const lat = 90 - (y + 0.5) / H * 180;
      for (let x = 0; x < W; x++) {
        const lon = (x + 0.5) / W * 360 - 180, i = y * W + x;
        ll2v(lat, lon, v);
        dx[i] = v.x; dy[i] = v.y; dz[i] = v.z;
        const nx = v.x, ny = v.y, nz = v.z;
        const wu = (fbm(nx * 5 + 3, ny * 5, nz * 5, 2) - 0.5) * 33;
        const wv = (fbm(nx * 5, ny * 5 + 9, nz * 5, 2) - 0.5) * 33;
        const m = sampleArr(mask, x + 0.5 + wu, y + 0.5 + wv) + (fbm(nx * 60, ny * 60, nz * 60, 2) - 0.5) * 0.22;
        const land = sstep(0.3, 0.7, m);
        const t = (land - 0.5) * 2;
        let h;
        if (t < 0) {
          h = t * 9;
        } else {
          const hills = fbm(nx * 30, ny * 30, nz * 30, 3);
          const mm = sampleArr(mtn, x + 0.5, y + 0.5);
          const ridge = 1 - Math.abs(fbm(nx * 50 + 5, ny * 50, nz * 50, 3) * 2 - 1);
          h = t * (0.9 + hills * 3.4) + t * mm * (2 + ridge * ridge * 16);
        }
        heightGrid[i] = h;
      }
    }

    for (const l of landmarks) {
      const r = l.r + 5, fall = 5;
      const h0 = l.flatH || clamp(heightAt(l.dir), 1.1, 5);
      const cosMax = Math.cos((r + fall) / R);
      for (let i = 0; i < W * H; i++) {
        const c = dx[i] * l.dir.x + dy[i] * l.dir.y + dz[i] * l.dir.z;
        if (c < cosMax) continue;
        const d = Math.acos(Math.min(1, c)) * R;
        heightGrid[i] = mix(heightGrid[i], h0, sstep(r + fall, r, d));
      }
    }
  }

  /* ---------- 대륙 색 되살리기 ---------- */
  const sat = { value: [1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 1] };
  function patchSat(mat) {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uSat = sat;
      s.vertexShader = 'attribute float aCont;uniform float uSat[9];varying float vSat;\n' +
        s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSat=uSat[int(aCont+.5)];');
      s.fragmentShader = 'varying float vSat;\n' +
        s.fragmentShader.replace('#include <color_fragment>',
          '#include <color_fragment>\nfloat g_=dot(diffuseColor.rgb,vec3(.3,.59,.11));diffuseColor.rgb=mix(vec3(g_)*vec3(.9,.94,1.),diffuseColor.rgb,vSat);');
    };
    return mat;
  }

  /* ---------- 팔레트 ---------- */
  const cache = {};
  const C = (hex) => cache[hex] || (cache[hex] = new THREE.Color(hex));
  const PAL = {
    deep: C('#14476e'), shelf: C('#2f8f9c'), sand: C('#efdba4'),
    ice: C('#f0f6fa'), ice2: C('#d3e6f2'), tundra: C('#a9b288'), boreal: C('#4c7f52'),
    temperate: C('#7dbb4d'), tropic: C('#3fae55'), desert: C('#e8c67e'), desert2: C('#d9a65e'),
    redsand: C('#d48a4b'), rock: C('#8c8378'), snow: C('#f6f8fb'),
  };

  // 0물 1얼음 2툰드라 3침엽수림 4온대 5열대 6사막
  function biomeAt(d, h) {
    if (h < 0.25) return 0;
    const lat = Math.asin(clamp(d.y, -1, 1)) / RAD;
    const lon = Math.atan2(-d.z, d.x) / RAD;
    if (lat < -60 || (lat > 60 && lon > -60 && lon < -18)) return 1;
    const [u, v] = uvOf(d);
    if (sampleArr(desertGrid, u, v) > 0.45) return 6;
    const a = Math.abs(lat) + (vnoise(d.x * 9, d.y * 9, d.z * 9) - 0.5) * 10;
    if (a > 66) return 2;
    if (a > 50) return 3;
    if (a > 25) return 4;
    return 5;
  }

  const tmpC = new THREE.Color();
  function faceColor(d, h, slope) {
    const j = vnoise(d.x * 180, d.y * 180, d.z * 180) - 0.5;
    const b = biomeAt(d, h);
    if (h < 0) tmpC.copy(PAL.shelf).lerp(PAL.deep, sstep(0, 7, -h));
    else if (h < 0.55) tmpC.copy(PAL.sand);
    else if (b === 1) tmpC.copy(PAL.ice).lerp(PAL.ice2, j + 0.5);
    else if (b === 2) tmpC.copy(PAL.tundra);
    else if (b === 3) tmpC.copy(PAL.boreal);
    else if (b === 4) tmpC.copy(PAL.temperate);
    else if (b === 5) tmpC.copy(PAL.tropic);
    else if (d.x < 0 && d.z < 0 && d.y < 0) tmpC.copy(PAL.redsand);
    else tmpC.copy(PAL.desert).lerp(PAL.desert2, j + 0.5);
    if (h > 6.5 && b !== 1) tmpC.lerp(PAL.rock, sstep(6.5, 9, h + j * 3));
    if (slope > 2.6 && h > 2 && b !== 1) tmpC.lerp(PAL.rock, 0.6);
    if (h > 10.5 + j * 3) tmpC.copy(PAL.snow);
    const k = 1 + j * 0.16;
    tmpC.r *= k; tmpC.g *= k; tmpC.b *= k;
    return tmpC;
  }

  /* ---------- 지형: 정육면체 구 타일 ---------- */
  // 정육면체 여섯 면을 NC×NC 칸으로 나눈다. 칸 4×4개를 한 덩어리로 묶어 거친 지형을 그리고,
  // 플레이어 가까운 칸만 고운 타일로 그때그때 만들어 거친 칸 대신 보여 준다.
  const NC = 24, GROUP = 4, COARSE_Q = 6, SKIRT = 6;
  let FINE_Q = 32, FINE_RANGE = 230;
  const FACES = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  function cubeDir(f, s, t, out) {
    const [n, u, v] = FACES[f], a = Math.tan(s * Math.PI / 4), b = Math.tan(t * Math.PI / 4);
    return out.set(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b).normalize();
  }
  // 구름 묶음용: 가장 큰 축으로 면을 고르는 간단한 칸 번호
  function cubeCell(x, y, z, N) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let f, u, v;
    if (ax >= ay && ax >= az) { f = x > 0 ? 0 : 1; u = y / ax; v = z / ax; }
    else if (ay >= az) { f = y > 0 ? 2 : 3; u = x / ay; v = z / ay; }
    else { f = z > 0 ? 4 : 5; u = x / az; v = y / az; }
    const cu = Math.min(N - 1, Math.floor((u + 1) / 2 * N)), cv = Math.min(N - 1, Math.floor((v + 1) / 2 * N));
    return f * N * N + cu * N + cv;
  }

  const tv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const tm = new THREE.Vector3(), te1 = new THREE.Vector3(), te2 = new THREE.Vector3(), tdir = new THREE.Vector3();
  // 칸 하나를 q×q 격자로 만든다. skirt: 가장자리에 아래로 늘어뜨린 벽을 붙여 이웃 칸과의 틈을 가린다.
  function cellTris(f, i, j, q, skirt) {
    const n = q + 1, dirs = new Float32Array(n * n * 3), hs = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      cubeDir(f, ((i + x / q) / NC) * 2 - 1, ((j + y / q) / NC) * 2 - 1, tdir);
      const k = y * n + x;
      dirs[k * 3] = tdir.x; dirs[k * 3 + 1] = tdir.y; dirs[k * 3 + 2] = tdir.z;
      hs[k] = heightAt(tdir);
    }
    const tris = q * q * 2 + (skirt ? q * 8 : 0);
    const pos = new Float32Array(tris * 9), col = new Float32Array(tris * 9), cont = new Float32Array(tris * 3);
    let o = 0;
    const ks = [0, 0, 0], drop = [0, 0, 0];
    function emit(a, da, b, db, c, dc) {
      ks[0] = a; ks[1] = b; ks[2] = c; drop[0] = da; drop[1] = db; drop[2] = dc;
      let hsum = 0, cnt = 0, hmin = Infinity, hmax = -Infinity;
      tm.set(0, 0, 0);
      for (let v = 0; v < 3; v++) {
        const k = ks[v], h = hs[k];
        tv[v].set(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]);
        tm.add(tv[v]);
        tv[v].multiplyScalar(R + h - (drop[v] ? SKIRT : 0));
        if (!drop[v]) { hsum += h; cnt++; if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
      }
      te1.subVectors(tv[1], tv[0]); te2.subVectors(tv[2], tv[0]); te1.cross(te2);
      const flip = te1.dot(tv[0]) < 0; // 바깥을 보게 감는 방향을 맞춘다
      tm.normalize();
      const hm = hsum / cnt, color = faceColor(tm, hm, hmax - hmin), id = hm > -1 ? contAt(tm) : 0;
      for (let v = 0; v < 3; v++) {
        const src = tv[flip && v ? 3 - v : v], p = o * 9 + v * 3;
        pos[p] = src.x; pos[p + 1] = src.y; pos[p + 2] = src.z;
        col[p] = color.r; col[p + 1] = color.g; col[p + 2] = color.b;
        cont[o * 3 + v] = id;
      }
      o++;
    }
    for (let y = 0; y < q; y++) for (let x = 0; x < q; x++) {
      const k00 = y * n + x, k10 = k00 + 1, k01 = k00 + n, k11 = k01 + 1;
      emit(k00, 0, k10, 0, k11, 0);
      emit(k00, 0, k11, 0, k01, 0);
    }
    if (skirt) {
      for (let x = 0; x < q; x++) {
        for (const row of [0, q]) { const a = row * n + x, b = a + 1; emit(a, 0, b, 0, b, 1); emit(a, 0, b, 1, a, 1); }
        for (const colm of [0, q]) { const a = x * n + colm, b = a + n; emit(a, 0, b, 0, b, 1); emit(a, 0, b, 1, a, 1); }
      }
    }
    return { pos, col, cont };
  }

  const groups = [], cellList = [], fineTiles = new Map();
  let coarseMat = null, fineMat = null;
  function buildCoarse() {
    coarseMat = patchSat(new THREE.MeshLambertMaterial({ vertexColors: true }));
    fineMat = patchSat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const NG = NC / GROUP;
    for (let f = 0; f < 6; f++) for (let gi = 0; gi < NG; gi++) for (let gj = 0; gj < NG; gj++) {
      const parts = [], cells = [];
      let verts = 0;
      for (let ci = 0; ci < GROUP; ci++) for (let cj = 0; cj < GROUP; cj++) {
        const i = gi * GROUP + ci, j = gj * GROUP + cj, t = cellTris(f, i, j, COARSE_Q, false);
        const cell = { f, i, j, key: `${f},${i},${j}`, start: verts, count: t.pos.length / 3, fine: false, dir: cubeDir(f, ((i + 0.5) / NC) * 2 - 1, ((j + 0.5) / NC) * 2 - 1, new THREE.Vector3()) };
        cells.push(cell); cellList.push(cell); parts.push(t);
        verts += cell.count;
      }
      const pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3), cont = new Float32Array(verts);
      let o = 0;
      for (const t of parts) { pos.set(t.pos, o * 3); col.set(t.col, o * 3); cont.set(t.cont, o); o += t.pos.length / 3; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aCont', new THREE.BufferAttribute(cont, 1));
      g.computeVertexNormals();
      const idx = new Uint16Array(verts);
      for (let k = 0; k < verts; k++) idx[k] = k;
      const ia = new THREE.BufferAttribute(idx, 1);
      ia.setUsage(THREE.DynamicDrawUsage);
      g.setIndex(ia);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, coarseMat);
      mesh.matrixAutoUpdate = false;
      scene_.add(mesh);
      const group = { mesh, geo: g, idx, cells, dirty: false, dir: g.boundingSphere.center.clone().normalize(), margin: g.boundingSphere.radius / R };
      cells.forEach((c) => { c.group = group; });
      groups.push(group);
    }
  }
  // 고운 타일이 생긴 칸은 거친 덩어리에서 그 칸의 삼각형만 빼고 그린다
  function rebuildIndex(group) {
    let n = 0;
    for (const c of group.cells) if (!c.fine) for (let k = 0; k < c.count; k++) group.idx[n++] = c.start + k;
    group.geo.index.needsUpdate = true;
    group.geo.setDrawRange(0, n);
    group.dirty = false;
  }
  function buildFine(cell) {
    const t = cellTris(cell.f, cell.i, cell.j, FINE_Q, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
    g.setAttribute('aCont', new THREE.BufferAttribute(t.cont, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, fineMat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene_.add(mesh);
    fineTiles.set(cell.key, { mesh, cell });
    cell.fine = true; cell.group.dirty = true;
  }
  function dropFine(key) {
    const t = fineTiles.get(key);
    scene_.remove(t.mesh);
    t.mesh.geometry.dispose();
    fineTiles.delete(key);
    t.cell.fine = false; t.cell.group.dirty = true;
  }

  /* ---------- 지오메트리 조립기 ---------- */
  const mT = new THREE.Matrix4(), mQ = new THREE.Quaternion(), vS = new THREE.Vector3(), vP = new THREE.Vector3();
  class Builder {
    constructor() { this.parts = []; this.base = new THREE.Matrix4(); }
    add(geo, color, matrix) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      const m = new THREE.Matrix4().copy(this.base);
      if (matrix) m.multiply(matrix);
      g.applyMatrix4(m);
      g.computeVertexNormals();
      const c = C(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      this.parts.push({ pos: g.attributes.position.array, nor: g.attributes.normal.array, col: arr });
      return this;
    }
    tf(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
      mQ.setFromAxisAngle(vS.set(0, 1, 0), ry);
      return new THREE.Matrix4().compose(vP.set(x, y, z), mQ, new THREE.Vector3(sx, sy, sz));
    }
    box(w, h, d, c, x = 0, y = 0, z = 0, ry = 0) { return this.add(new THREE.BoxGeometry(w, h, d), c, this.tf(x, y + h / 2, z, 1, 1, 1, ry)); }
    cyl(rt, rb, h, c, x = 0, y = 0, z = 0, seg = 8) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, this.tf(x, y + h / 2, z)); }
    cone(r, h, c, x = 0, y = 0, z = 0, seg = 8, ry = 0) { return this.add(new THREE.ConeGeometry(r, h, seg), c, this.tf(x, y + h / 2, z, 1, 1, 1, ry)); }
    ball(r, c, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 1) { return this.add(new THREE.IcosahedronGeometry(r, detail), c, this.tf(x, y, z, sx, sy, sz)); }
    beam(x1, y1, z1, x2, y2, z2, r, c, seg = 5) {
      const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2), d = b.clone().sub(a), len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      return this.add(new THREE.CylinderGeometry(r, r, len, seg), c, m);
    }
    within(matrix, fn) { const old = this.base; this.base = old.clone().multiply(matrix); fn(this); this.base = old; return this; }
    build(contId) {
      let n = 0; for (const p of this.parts) n += p.pos.length;
      const pos = new Float32Array(n), nor = new Float32Array(n), col = new Float32Array(n);
      let o = 0;
      for (const p of this.parts) { pos.set(p.pos, o); nor.set(p.nor, o); col.set(p.col, o); o += p.pos.length; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (contId !== undefined) g.setAttribute('aCont', new THREE.BufferAttribute(new Float32Array(n / 3).fill(contId), 1));
      return g;
    }
  }

  function frameAt(dir, yaw = 0) {
    const n = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const X = n.clone().cross(dir).normalize(), Z = X.clone().cross(dir).normalize();
    const m = new THREE.Matrix4().makeBasis(X, dir, Z);
    if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
    return m;
  }

  /* ---------- 랜드마크 ---------- */
  const WHITE = '#f6f1e6', STONE = '#b9ad98', SANDST = '#dcbc7c', RED = '#c9412e', JADE = '#5fae98', GOLD = '#e8b931', ROOF = '#3d4d63';
  const LM = {
    taj(b) {
      b.box(20, 0.8, 20, '#d9d3c5', 0, 0, 0).box(15, 1.2, 15, WHITE, 0, 0.8, 0);
      b.box(9, 6, 9, WHITE, 0, 2, 0).box(3.2, 4.4, 0.3, ROOF, 0, 2, 4.56);
      b.ball(3.7, '#fffdf7', 0, 9.3, 0, 1, 1.15, 1, 2).cone(0.3, 2.2, GOLD, 0, 12.8, 0);
      for (const [x, z] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]]) b.ball(1.05, '#fffdf7', x, 8.5, z, 1, 1, 1, 1);
      for (const [x, z] of [[-6.8, -6.8], [6.8, -6.8], [-6.8, 6.8], [6.8, 6.8]]) {
        b.cyl(0.5, 0.65, 8, WHITE, x, 2, z).cyl(0.75, 0.75, 0.25, '#ddd6c6', x, 7, z).ball(0.7, '#fffdf7', x, 10.2, z);
      }
      b.box(3, 0.1, 12, '#57bcd8', 0, 0.82, 12);
    },
    fuji(b) {
      b.add(new THREE.CylinderGeometry(1.6, 9.5, 11, 12), '#6c6f85', b.tf(0, 5.5, 0));
      b.add(new THREE.CylinderGeometry(1.5, 4.4, 4.2, 12), '#f7f9fc', b.tf(0, 8.9, 0));
      for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 9.5 + (i % 2); b.cyl(0.15, 0.2, 1, '#6b4a33', Math.cos(a) * r, 0, Math.sin(a) * r).ball(0.9, '#f4a6c3', Math.cos(a) * r, 1.6, Math.sin(a) * r); }
    },
    wall(b) {
      for (let i = -8; i <= 8; i++) {
        const x = i * 2.1, z = Math.sin(i * 0.5) * 4, nz = Math.sin((i + 1) * 0.5) * 4;
        b.box(2.3, 2.2, 1.3, '#a79c88', x, 0, z, -Math.atan2(nz - z, 2.1));
        b.box(0.5, 0.5, 1.3, '#94897a', x - 0.6, 2.2, z).box(0.5, 0.5, 1.3, '#94897a', x + 0.6, 2.2, z);
        if (i % 4 === 0) b.box(3.2, 4, 3.2, '#a0947f', x, 0, z).box(3.6, 0.5, 3.6, '#8a7f6d', x, 4, z);
      }
    },
    seoul(b) {
      b.add(new THREE.CylinderGeometry(2, 8, 4, 10), '#5c9a54', b.tf(0, 2, 0));
      b.cyl(0.55, 0.8, 11, '#eef1f5', 0, 4, 0).cyl(2.1, 1.2, 1.4, '#d44b54', 0, 12.4, 0).cyl(1.1, 1.8, 0.8, '#eef1f5', 0, 13.8, 0).cyl(0.1, 0.32, 5, '#d44b54', 0, 14.6, 0);
    },
    pyramids(b) {
      const stone = '#dcb871';
      b.add(new THREE.ConeGeometry(8.5, 12, 4), stone, b.tf(-2, 6, -4, 1, 1, 1, Math.PI / 4));
      b.add(new THREE.ConeGeometry(6, 8.6, 4), '#d1ab65', b.tf(8, 4.3, 2, 1, 1, 1, Math.PI / 4));
      b.add(new THREE.ConeGeometry(4, 5.6, 4), stone, b.tf(13, 2.8, 8, 1, 1, 1, Math.PI / 4));
      b.box(2.4, 2, 6, SANDST, -9, 0, 7).box(2, 2.4, 2, SANDST, -9, 1.6, 10).box(2.8, 1.5, 0.5, '#3f6aa8', -9, 3, 9.7);
    },
    baobab(b) {
      for (const [x, z, s] of [[-7, -5, 1], [-4, 5, 1.2], [3, -6, 0.9], [6, 4, 1.15], [-9, 2, 0.85], [9, -2, 1]]) {
        b.within(b.tf(x, 0, z, s, s, s), () => {
          b.cyl(1, 1.5, 7, '#8d6f55', 0, 0, 0, 9);
          for (let i = 0; i < 6; i++) {
            const a = i * 1.05; b.beam(0, 6.6, 0, Math.cos(a) * 2.8, 8.2, Math.sin(a) * 2.8, 0.22, '#7a5e47');
            b.ball(1.2, '#5e9b4a', Math.cos(a) * 2.8, 8.6, Math.sin(a) * 2.8, 1, 0.5, 1);
          }
        });
      }
    },
    table(b) {
      b.add(new THREE.CylinderGeometry(7.5, 10, 6, 11), '#7a7f73', b.tf(0, 3, 0));
      b.add(new THREE.CylinderGeometry(7.7, 7.7, 0.5, 11), '#93a06f', b.tf(0, 6.2, 0));
    },
    pisa(b) {
      b.box(10, 0.2, 10, '#8fbf63', 0, 0, 0);
      const lean = new THREE.Matrix4().makeRotationZ(-0.1);
      b.within(lean, () => {
        for (let i = 0; i < 7; i++) {
          b.cyl(1.9, 1.9, 1.5, WHITE, 0, 0.1 + i * 1.7, 0, 14).cyl(2.25, 2.25, 0.2, '#d7cfbe', 0, 1.6 + i * 1.7, 0, 14);
        }
        b.cyl(1.3, 1.3, 1.5, WHITE, 0, 12, 0, 12);
      });
    },
    eiffel(b) {
      const c = '#7d6a55';
      const leg = (x, z) => {
        b.beam(x * 5.2, 0, z * 5.2, x * 3, 5, z * 3, 0.5, c);
        b.beam(x * 3, 5, z * 3, x * 1.4, 10, z * 1.4, 0.32, c);
        b.beam(x * 1.4, 10, z * 1.4, x * 0.3, 18, z * 0.3, 0.16, c);
      };
      leg(1, 1); leg(-1, 1); leg(1, -1); leg(-1, -1);
      b.box(7.6, 0.5, 7.6, c, 0, 5, 0).box(3.8, 0.4, 3.8, c, 0, 10, 0).box(1.4, 0.35, 1.4, c, 0, 15, 0);
      b.cyl(0.08, 0.3, 3, c, 0, 18, 0);
    },
    bigben(b) {
      b.box(3.6, 11, 3.6, '#c7a971', 0, 0, 0).box(4, 3.4, 4, '#b89a62', 0, 11, 0);
      for (const [x, z] of [[0, 2.03], [0, -2.03], [2.03, 0], [-2.03, 0]]) {
        b.add(new THREE.CylinderGeometry(1.35, 1.35, 0.1, 18), '#fbf8ea', new THREE.Matrix4().compose(new THREE.Vector3(x, 12.7, z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, 0, z).normalize()), new THREE.Vector3(1, 1, 1)));
      }
      b.add(new THREE.ConeGeometry(2.9, 5, 4), '#4c5c52', b.tf(0, 16.9, 0, 1, 1, 1, Math.PI / 4));
      b.box(14, 4, 3.4, '#c1a269', 8, 0, 0);
      for (let i = 0; i < 6; i++) b.cone(0.6, 1.6, '#4c5c52', 3 + i * 2, 4, 0, 4);
    },
    maya(b) {
      for (let i = 0; i < 7; i++) { const s = 18 - i * 2.2; b.box(s, 1.3, s, i % 2 ? '#b8b199' : '#a8a18a', 0, i * 1.3, 0); }
      b.box(4, 9.2, 2.8, '#c2bba3', 0, 0, 7.4 - 0.2);
      b.box(3.8, 3, 3.8, '#a49d86', 0, 9.1, 0).box(1.4, 2, 0.15, '#2b2a26', 0, 9.1, 1.95).box(4.4, 0.5, 4.4, '#8f8870', 0, 12.1, 0);
    },
    liberty(b) {
      b.box(7.5, 3, 7.5, '#b5ad9c', 0, 0, 0).box(4.4, 3.6, 4.4, '#c8c0ae', 0, 3, 0);
      b.add(new THREE.CylinderGeometry(0.95, 2, 6, 9), '#74bfa5', b.tf(0, 9.6, 0));
      b.ball(0.95, '#83cbb2', 0, 13.3, 0);
      for (let i = 0; i < 7; i++) { const a = -1.3 + i * 0.43; b.beam(0, 13.8, 0, Math.sin(a) * 1.6, 14.9, Math.cos(a) * 1.6, 0.07, '#83cbb2', 3); }
      b.beam(0.9, 11.6, 0, 1.8, 15.2, 0, 0.32, '#74bfa5').cyl(0.45, 0.25, 0.6, GOLD, 1.8, 15.2, 0).ball(0.42, '#ffb12b', 1.8, 16.1, 0);
    },
    gate(b) {
      const c = '#c8452f';
      for (const x of [-9, 9]) {
        for (const z of [-1.1, 1.1]) b.box(0.8, 12, 0.8, c, x, 0, z);
        b.box(0.8, 0.7, 3, c, x, 11.2, 0).box(0.8, 0.7, 3, c, x, 7.5, 0);
      }
      b.box(36, 0.5, 2.6, c, 0, 4.6, 0);
      for (const z of [-1.1, 1.1]) {
        let px_ = -18, py_ = 5.1;
        for (let i = 1; i <= 18; i++) {
          const x = -18 + i * 2, t = (Math.abs(x) - 9) / 9;
          const y = Math.abs(x) >= 9 ? 12 - t * 7 : 5.4 + 6.6 * (x / 9) * (x / 9);
          b.beam(px_, py_, z, x, y, z, 0.07, c, 3);
          if (i % 2 === 0 && Math.abs(x) < 18) b.beam(x, y, z, x, 5, z, 0.04, c, 3);
          px_ = x; py_ = y;
        }
      }
    },
    machu(b) {
      for (let i = 0; i < 5; i++) { const s = 21 - i * 3.2; b.box(s, 1.2, s, i % 2 ? '#6ea552' : '#7fb35f', 0, i * 1.2, 0); }
      for (const [x, z] of [[-3, -3], [2, -2], [-2, 2.6], [3, 3]]) { b.box(2.3, 1.1, 1.8, '#a5a093', x, 6, z); b.add(new THREE.ConeGeometry(1.8, 1.1, 4), '#8c7a55', b.tf(x, 7.6, z, 1, 1, 1, Math.PI / 4)); }
      b.add(new THREE.ConeGeometry(5.6, 15, 7), '#5b7d4e', b.tf(-12, 7.5, -12));
      b.add(new THREE.ConeGeometry(1.6, 3.5, 7), '#7c8a6b', b.tf(-12, 13.3, -12));
    },
    christ(b) {
      b.add(new THREE.CylinderGeometry(1.4, 5, 3.4, 8), '#5f9153', b.tf(0, 1.7, 0));
      b.box(2, 2.4, 2, '#d9d4c7', 0, 3.4, 0);
      b.add(new THREE.CylinderGeometry(0.75, 1.2, 8, 8), WHITE, b.tf(0, 9.8, 0));
      b.box(10, 0.9, 0.9, WHITE, 0, 12.6, 0);
      b.ball(0.8, WHITE, 0, 14.7, 0);
    },
    amazon(b) {
      b.cyl(1.5, 2.6, 17, '#6b4c33', 0, 0, 0, 9);
      for (let i = 0; i < 5; i++) { const a = i * 1.26; b.beam(0, 0, 0, Math.cos(a) * 3.8, 0, Math.sin(a) * 3.8, 0.75, '#6b4c33'); }
      for (const [x, y, z, r] of [[0, 19, 0, 7.4], [-5, 17, 2, 4.6], [5, 17.6, -2, 4.8], [2, 17, 5, 4.2], [-2, 17, -5, 4.4]]) b.ball(r, x % 2 ? '#2e8b45' : '#38a050', x, y, z, 1, 0.5, 1);
    },
    opera(b) {
      b.box(20, 1.5, 11, '#d7b7a0', 0, 0, 0);
      const shell = (x, z, s, ry) => {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 1.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, ry, 0)), new THREE.Vector3(s * 0.75, s * 1.45, s * 1.15));
        b.add(new THREE.SphereGeometry(2.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#fbfbf7', m);
      };
      shell(-6, 1, 1.45, 1.57); shell(-2, 1, 1.15, 1.57); shell(1.4, 1, 0.9, 1.57);
      shell(4.8, 2.5, 1, 1.57); shell(7.4, 2.5, 0.75, 1.57);
    },
    uluru(b) { b.ball(5.2, '#b9552d', 0, 1.2, 0, 2, 0.95, 1.3, 2); b.ball(3.2, '#a94a26', 5.5, 1, 3, 1.7, 0.7, 1.1, 1); },
    nullarbor(b) {
      b.cyl(0.3, 0.5, 4, '#6d5238', 0, 0, 0, 6).ball(2.1, '#6d9a4a', 0, 5.2, 0, 1, 0.8, 1);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; b.ball(0.5, '#a39b70', Math.cos(a) * 4.5, 0.2, Math.sin(a) * 4.5, 1, 0.5, 1, 0); }
    },
    sejong(b) {
      b.box(8, 2.6, 4, '#d0432f', 0, 0.5, 0).box(3.4, 2, 3.2, '#e8e9ea', -6, 0.5, 0).box(1.2, 0.5, 1.2, '#223', 0, 3.1, 0);
      b.cyl(0.06, 0.1, 7, '#444', 5, 0, -2, 5).box(1.7, 1.1, 0.05, '#ffffff', 5.85, 5.8, -2);
      b.ball(0.27, '#c8324b', 5.85, 6.42, -1.95, 1, 0.5, 0.2, 1).ball(0.27, '#2c4f9e', 5.85, 6.25, -1.95, 1, 0.5, 0.2, 1);
    },
    pole(b) {
      for (let i = 0; i < 6; i++) b.cyl(0.14, 0.14, 0.42, i % 2 ? '#d4352c' : '#fafafa', 0, i * 0.42, 0);
      b.ball(0.55, '#d8e2ea', 0, 3, 0, 1, 1, 1, 2);
      const colors = ['#d4352c', '#1f5fb4', '#f2c230', '#2f9e60', '#eb6e2f', '#884bb0', '#fafafa', '#222'];
      colors.forEach((c, i) => {
        const a = i / 8 * Math.PI * 2, x = Math.cos(a) * 4.6, z = Math.sin(a) * 4.6;
        b.cyl(0.05, 0.05, 2.8, '#555', x, 0, z, 4).box(0.95, 0.6, 0.04, c, x + 0.5, 2.15, z);
      });
    },
    penguins(b) {
      b.add(new THREE.ConeGeometry(4, 6, 5), '#c4e2f0', b.tf(-7, 3, -5));
      b.add(new THREE.ConeGeometry(3, 4.2, 5), '#dbeef6', b.tf(7, 2.1, -6));
      for (let i = 0; i < 16; i++) {
        const a = i * 2.4, r = 2 + i * 0.47, x = Math.cos(a) * r, z = Math.sin(a) * r, s = 0.8 + (i % 3) * 0.13;
        b.within(b.tf(x, 0, z, s, s, s, a), () => {
          b.ball(0.65, '#1f2531', 0, 0.75, 0, 1, 1.25, 0.9).ball(0.47, '#fbfbf7', 0, 0.68, 0.26, 1, 1.25, 0.8);
          b.ball(0.38, '#1f2531', 0, 1.65, 0).cone(0.12, 0.3, '#f0a020', 0, 1.5, 0.42, 4);
        });
      }
    },
    nullisland(b) {
      // 관측 부표
      b.cyl(1.2, 1.5, 0.8, '#e8c33a', 9, 0, -8).cyl(0.14, 0.5, 4.2, '#d93f33', 9, 0.8, -8).ball(0.32, '#fff0b0', 9, 5.2, -8);
      for (const [x, z] of [[-11, -7], [-6, -11], [-13, -2]]) { b.beam(x, 0, z, x + 1, 7, z + 0.5, 0.2, '#8a6a42'); for (let i = 0; i < 6; i++) { const a = i * 1.05; b.beam(x + 1, 7, z + 0.5, x + 1 + Math.cos(a) * 2.6, 6.2, z + 0.5 + Math.sin(a) * 2.6, 0.2, '#3d9c4c', 3); } }
    },
  };

  const WALL_EXTRA = [];
  for (let i = -8; i <= 8; i += 2) WALL_EXTRA.push([i * 2.1, Math.sin(i * 0.5) * 4, 2]);

  function buildLandmarks() {
    const colliders = [];
    const mat = patchSat(new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (const l of landmarks) {
      const b = new Builder();
      LM[l.key](b);
      const frame = frameAt(l.dir);
      const h = heightAt(l.dir);
      frame.setPosition(l.dir.clone().multiplyScalar(R + h));
      const g = b.build(l.cont);
      g.applyMatrix4(frame);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      cullables.push({ obj: mesh, dir: l.dir, margin: g.boundingSphere.radius / R });
      scene_.add(mesh);
      l.frame = frame;
      if (l.key === 'nullisland') continue;
      if (l.key === 'wall') {
        for (const [x, z, r] of WALL_EXTRA) {
          const p = new THREE.Vector3(x, 0, z).applyMatrix4(frame).normalize();
          colliders.push({ dir: p, r });
        }
      } else if (l.key === 'baobab') {
        for (const [x, z] of [[-7, -5], [-4, 5], [3, -6], [6, 4], [-9, 2], [9, -2]]) colliders.push({ dir: new THREE.Vector3(x, 0, z).applyMatrix4(frame).normalize(), r: 1.5 });
      } else colliders.push({ dir: l.dir.clone(), r: l.r });
    }
    return colliders;
  }

  /* ---------- 나무·바위 ---------- */
  function protoGeos() {
    const p = {};
    let b = new Builder();
    b.cyl(0.18, 0.28, 1.2, '#6a4b33', 0, 0, 0, 5).cone(1.35, 2.1, '#2f7a4c', 0, 1, 0, 6).cone(1.05, 1.8, '#3a8d58', 0, 2.3, 0, 6).cone(0.7, 1.5, '#47a266', 0, 3.4, 0, 6);
    p.conifer = b.build();
    b = new Builder();
    b.cyl(0.2, 0.34, 1.7, '#7a5a3f', 0, 0, 0, 5).ball(1.35, '#67b34d', 0, 2.5, 0, 1, 0.95, 1, 0).ball(0.95, '#7cc45a', 0.75, 2.05, 0.3, 1, 1, 1, 0);
    p.broad = b.build();
    b = new Builder();
    b.cyl(0.2, 0.34, 4.2, '#6a4f37', 0, 0, 0, 5).ball(1.9, '#279a4e', 0, 4.9, 0, 1, 0.65, 1, 0).ball(1.3, '#35ad5b', 1, 4.2, 0.6, 1, 0.65, 1, 0);
    p.jungle = b.build();
    b = new Builder();
    b.beam(0, 0, 0, 0.35, 4.2, 0, 0.17, '#9a7d58');
    for (let i = 0; i < 6; i++) { const a = i * 1.05; b.beam(0.35, 4.2, 0, 0.35 + Math.cos(a) * 1.9, 3.5, Math.sin(a) * 1.9, 0.2, '#47ad55', 3); }
    p.palm = b.build();
    b = new Builder();
    b.cyl(0.32, 0.36, 2.8, '#4d9a57', 0, 0, 0, 6).beam(0, 1.1, 0, 0.95, 1.3, 0, 0.17, '#4d9a57').beam(0.95, 1.3, 0, 0.95, 2.1, 0, 0.17, '#4d9a57').beam(0, 1.6, 0, -0.8, 1.8, 0, 0.15, '#4d9a57').beam(-0.8, 1.8, 0, -0.8, 2.5, 0, 0.15, '#4d9a57');
    p.cactus = b.build();
    b = new Builder();
    b.ball(1, '#8c8679', 0, 0.3, 0, 1.2, 0.8, 1, 0);
    p.rock = b.build();
    b = new Builder();
    b.cone(1.1, 3.4, '#cfe8f4', 0, -0.1, 0, 4).cone(0.65, 2.1, '#e6f4fa', 1, -0.1, 0.5, 4);
    p.ice = b.build();
    return p;
  }

  function buildProps(colliders) {
    const groups = { conifer: [], broad: [], jungle: [], palm: [], cactus: [], rock: [], ice: [] };
    const d = new THREE.Vector3();
    for (let i = 0, n = lite ? 120000 : 300000; i < n; i++) {
      const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - y * y);
      d.set(s * Math.cos(a), y, s * Math.sin(a));
      const h = heightAt(d);
      if (h < 0.6 || h > 9) continue;
      let blocked = false;
      for (const l of landmarks) if (d.dot(l.dir) > Math.cos((l.r + 4) / R)) { blocked = true; break; }
      if (blocked) continue;
      const b = biomeAt(d, h), n = vnoise(d.x * 70, d.y * 70, d.z * 70), r = rnd();
      let kind = null;
      if (b === 1) { if (r < 0.1) kind = 'ice'; }
      else if (b === 2) { if (r < 0.1) kind = 'rock'; else if (r < 0.2) kind = 'conifer'; }
      else if (b === 3) { if (n > 0.38 && r < 0.75) kind = 'conifer'; else if (r > 0.97) kind = 'rock'; }
      else if (b === 4) { if (n > 0.42 && r < 0.6) kind = r < 0.14 ? 'conifer' : 'broad'; else if (r > 0.98) kind = 'rock'; }
      else if (b === 5) { if (h < 1.5 && r < 0.3) kind = 'palm'; else if (n > 0.36 && r < 0.8) kind = 'jungle'; }
      else if (b === 6) { if (r < 0.05) kind = 'cactus'; else if (r < 0.1) kind = 'rock'; }
      if (kind) groups[kind].push({ dir: d.clone(), h, cont: contAt(d), yaw: rnd() * 6.28, s: 0.7 + rnd() * 0.5 });
    }
    const protos = protoGeos();
    const mat = patchSat(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const m = new THREE.Matrix4();
    for (const k in groups) {
      const list = groups[k]; if (!list.length) continue;
      const g = protos[k], im = new THREE.InstancedMesh(g, mat, list.length), cont = new Float32Array(list.length);
      const matrices = new Float32Array(list.length * 16), dirs = new Float32Array(list.length * 3), conts = new Float32Array(list.length);
      list.forEach((t, i) => {
        m.copy(frameAt(t.dir, t.yaw));
        m.scale(vS.set(t.s, t.s, t.s));
        m.setPosition(t.dir.clone().multiplyScalar(R + t.h - 0.1));
        m.toArray(matrices, i * 16);
        dirs[i * 3] = t.dir.x; dirs[i * 3 + 1] = t.dir.y; dirs[i * 3 + 2] = t.dir.z;
        conts[i] = t.cont;
      });
      const contAttr = new THREE.InstancedBufferAttribute(cont, 1);
      contAttr.setUsage(THREE.DynamicDrawUsage);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aCont', contAttr);
      im.castShadow = true; im.receiveShadow = false; im.frustumCulled = false;
      im.count = 0;
      scene_.add(im);
      propSets.push({ im, matrices, dirs, conts, contAttr, n: list.length });
    }
  }

  // 지평선 너머의 나무는 인스턴스 목록에서 뺀다. 우주에서 볼 때는 10그루 중 1그루만.
  const lastPropCam = new THREE.Vector3(1e9, 0, 0);
  function updateProps(camDir, cosMax, thin) {
    for (const s of propSets) {
      const arr = s.im.instanceMatrix.array, ca = s.contAttr.array;
      let k = 0;
      for (let i = 0; i < s.n; i += thin) {
        if (s.dirs[i * 3] * camDir.x + s.dirs[i * 3 + 1] * camDir.y + s.dirs[i * 3 + 2] * camDir.z < cosMax) continue;
        for (let j = 0; j < 16; j++) arr[k * 16 + j] = s.matrices[i * 16 + j];
        ca[k] = s.conts[i];
        k++;
      }
      s.im.count = k;
      s.im.instanceMatrix.needsUpdate = true;
      s.contAttr.needsUpdate = true;
    }
  }

  const camDir_ = new THREE.Vector3();
  // 매 프레임: 고운 타일을 만들고 지우고, 지평선 너머를 감춘다
  const want = [];
  function cull(camPos) {
    const dist = camPos.length();
    camDir_.copy(camPos).divideScalar(dist);
    const alt = dist - R, far = alt > 110;
    const horizon = Math.acos(Math.min(1, R / dist)) + Math.acos(R / (R + 18));

    const nearOK = alt < 200, cosNear = Math.cos(FINE_RANGE / R), cosDrop = Math.cos((FINE_RANGE + 90) / R);
    fineTiles.forEach((t, key) => { if (!nearOK || camDir_.dot(t.cell.dir) < cosDrop) dropFine(key); });
    if (nearOK) {
      want.length = 0;
      for (const c of cellList) {
        if (c.fine) continue;
        const dot = camDir_.dot(c.dir);
        if (dot > cosNear) want.push([dot, c]);
      }
      want.sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < Math.min(2, want.length); k++) buildFine(want[k][1]); // 한 프레임에 두 칸씩
    }
    for (const g of groups) {
      if (g.dirty) rebuildIndex(g);
      g.mesh.visible = camDir_.dot(g.dir) > Math.cos(Math.min(Math.PI, horizon + g.margin));
    }
    for (const c of cullables) c.obj.visible = camDir_.dot(c.dir) > Math.cos(Math.min(Math.PI, horizon + c.margin));
    if (lastPropCam.distanceToSquared(camPos) > 16) {
      lastPropCam.copy(camPos);
      const reach = far ? horizon + 0.1 : Math.min(horizon + 0.05, 200 / R);
      updateProps(camDir_, Math.cos(Math.min(Math.PI, reach)), far ? 10 : 1);
    }
    atmosphere_.visible = uniforms.uSpace.value > 0.01;
  }

  function buildClouds() {
    const cells = {};
    for (let i = 0; i < 700; i++) {
      const y = rnd() * 1.6 - 0.8, a = rnd() * 6.28, s = Math.sqrt(1 - y * y);
      const dir = new THREE.Vector3(s * Math.cos(a), y, s * Math.sin(a));
      const frame = frameAt(dir, rnd() * 6.28);
      frame.setPosition(dir.clone().multiplyScalar(R + 30 + rnd() * 10));
      const size = 2.2 + rnd() * 3;
      const key = cubeCell(dir.x, dir.y, dir.z, 5);
      const b = cells[key] || (cells[key] = new Builder());
      b.within(frame, () => {
        b.ball(size, '#ffffff', 0, 0, 0, 1.6, 0.6, 1, 1);
        b.ball(size * 0.7, '#ffffff', size * 1.1, 0, 0.3, 1.5, 0.6, 1, 1);
        b.ball(size * 0.65, '#f3f8fc', -size * 1.15, -0.1, -0.2, 1.4, 0.6, 1, 1);
      });
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#566878' });
    for (const key in cells) {
      const g = cells[key].build();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.matrixAutoUpdate = false;
      cullables.push({ obj: mesh, dir: g.boundingSphere.center.clone().normalize(), margin: g.boundingSphere.radius / R + 0.12 });
      scene_.add(mesh);
    }
  }

  /* ---------- 하늘·바다 ---------- */
  const uniforms = {
    uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) }, uSpace: { value: 1 },
  };

  function buildOcean() {
    const mat = new THREE.ShaderMaterial({
      uniforms, transparent: true,
      vertexShader: `uniform float uTime; varying vec3 vW; varying vec3 vUp;
        void main(){ vec3 p=position; vec3 n=normalize(p); vUp=n;
          float w=sin(p.x*.55+uTime*1.1)+sin(p.y*.62+uTime*.9)+sin(p.z*.48-uTime*1.3);
          p+=n*w*.11; vW=(modelMatrix*vec4(p,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }`,
      fragmentShader: `uniform vec3 uSun; uniform float uSpace; varying vec3 vW; varying vec3 vUp;
        void main(){ vec3 N=normalize(cross(dFdx(vW),dFdy(vW))); if(dot(N,vUp)<0.)N=-N;
          N=normalize(mix(N,normalize(vUp),uSpace));
          vec3 V=normalize(cameraPosition-vW); float dif=max(dot(N,uSun),0.);
          vec3 col=mix(vec3(.05,.28,.52),vec3(.12,.56,.76),dif*dif);
          float fr=pow(1.-max(dot(V,N),0.),3.); col=mix(col,vec3(.62,.84,.96),fr*.55);
          col+=vec3(1.,.95,.8)*pow(max(dot(reflect(-uSun,N),V),0.),48.)*.55;
          gl_FragColor=vec4(col,.84); }`,
    });
    // 지형 덩어리와 같은 칸 나눔으로 바다를 쪼개 지평선 너머는 그리지 않는다
    const NG = NC / GROUP, q = 16, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    for (let f = 0; f < 6; f++) for (let gi = 0; gi < NG; gi++) for (let gj = 0; gj < NG; gj++) {
      const pos = new Float32Array(q * q * 18);
      let o = 0;
      const at = (x, y, out) => cubeDir(f, ((gi + x / q) / NG) * 2 - 1, ((gj + y / q) / NG) * 2 - 1, out).multiplyScalar(R);
      const tri = (p1, p2, p3) => {
        te1.subVectors(p2, p1); te2.subVectors(p3, p1); te1.cross(te2);
        const list = te1.dot(p1) < 0 ? [p1, p3, p2] : [p1, p2, p3];
        for (const p of list) { pos[o++] = p.x; pos[o++] = p.y; pos[o++] = p.z; }
      };
      for (let y = 0; y < q; y++) for (let x = 0; x < q; x++) {
        at(x, y, a); at(x + 1, y, b); at(x + 1, y + 1, c); at(x, y + 1, d);
        tri(a, b, c); tri(a, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.matrixAutoUpdate = false;
      cullables.push({ obj: mesh, dir: g.boundingSphere.center.clone().normalize(), margin: g.boundingSphere.radius / R });
      scene_.add(mesh);
    }
  }

  function buildSky() {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 uUp; uniform vec3 uSun; uniform float uSpace; varying vec3 vD;
        void main(){ vec3 d=normalize(vD); float h=dot(d,uUp);
          vec3 day=mix(vec3(.84,.93,.98),vec3(.28,.58,.92),smoothstep(-.12,.62,h));
          day+=vec3(1.,.9,.7)*pow(max(dot(d,uSun),0.),90.)*.7;
          vec3 space=vec3(.018,.024,.075)+vec3(.04,.02,.09)*pow(1.-abs(d.y),3.);
          gl_FragColor=vec4(mix(day,space,uSpace),1.); }`,
    }));
    dome.renderOrder = -2; dome.frustumCulled = false;
    group.add(dome);

    const n = 2600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = rnd() * 2 - 1, a = rnd() * 6.28, s = Math.sqrt(1 - y * y), r = 2700;
      pos[i * 3] = s * Math.cos(a) * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = s * Math.sin(a) * r;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, depthWrite: false }));
    stars.renderOrder = -1; stars.frustumCulled = false;
    group.add(stars);
    group.userData.stars = stars;
    return group;
  }

  function buildAtmosphere() {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 1.22, 12), new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }',
      fragmentShader: `uniform float uSpace; varying vec3 vN; varying vec3 vW;
        void main(){ float f=max(dot(normalize(cameraPosition-vW),-normalize(vN)),0.);
          float a=pow(f,1.2)*(1.-smoothstep(.1,.72,f))*2.6; gl_FragColor=vec4(vec3(.35,.65,1.)*a*uSpace,a*uSpace); }`,
    }));
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------- 캐릭터·아이템 ---------- */
  function lambert(color, extra) { return new THREE.MeshLambertMaterial({ color, ...extra }); }
  const ZERO_MAT = lambert('#a98a4a'); // 빛나 보이지 않게 어두운 무광 색

  function ovalGeo(rx, ry, hx, hy, depth) {
    const s = new THREE.Shape();
    s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    const h = new THREE.Path();
    h.absellipse(0, 0, hx, hy, 0, Math.PI * 2, true, 0);
    s.holes.push(h);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.09, bevelSegments: 2, curveSegments: 30 });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  const GEO_ZERO = ovalGeo(1.22, 1.9, 0.56, 1.14, 0.62);
  const GEO_O = ovalGeo(1.75, 1.75, 0.92, 0.92, 0.62);

  function makeEyes(x, y, z, r) {
    const g = new THREE.Group();
    const w = lambert('#ffffff'), k = lambert('#17202f');
    const gw = new THREE.SphereGeometry(r, 12, 10), gk = new THREE.SphereGeometry(r * 0.56, 10, 8);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(gw, w); e.position.set(s * x, y, z); g.add(e);
      const p = new THREE.Mesh(gk, k); p.position.set(s * x, y, z + r * 0.62); g.add(p);
    }
    return g;
  }

  function makeOne() {
    const s = new THREE.Shape();
    const pts = [[-.9,-1.5],[.9,-1.5],[.9,-1],[.45,-1],[.45,1.5],[-.2,1.5],[-.95,.85],[-.65,.45],[-.45,.62],[-.45,-1],[-.9,-1]];
    pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.62, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
    geo.translate(0, 0, -0.31);
    const root = new THREE.Group(), body = new THREE.Group();
    const mat = lambert('#ff5d47', { emissive: '#7a1508', emissiveIntensity: 0.35 });
    const m = new THREE.Mesh(geo, mat); m.position.y = 2; m.castShadow = true;
    body.add(m);
    body.add(makeEyes(0.27, 2.75, 0.42, 0.27));
    root.add(body);
    const legGeo = new THREE.CapsuleGeometry(0.15, 0.3, 3, 6);
    const legs = [];
    for (const sx of [-0.42, 0.42]) {
      const pivot = new THREE.Group(); pivot.position.set(sx, 0.55, 0);
      const l = new THREE.Mesh(legGeo, lambert('#2a2f42')); l.position.y = -0.3; l.castShadow = true;
      pivot.add(l); root.add(pivot); legs.push(pivot);
    }
    const bb = new Builder();
    bb.add(new THREE.CylinderGeometry(1.9, 1.15, 0.85, 6), '#f7f3e8', bb.tf(0, 0.25, 0, 0.8, 1, 1.5));
    bb.add(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 6), '#3f6bb0', bb.tf(0, 0.67, 0, 0.8, 1, 1.5));
    const boat = new THREE.Mesh(bb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    boat.castShadow = true; boat.visible = false;
    root.add(boat);
    return { root, body, legs, boat };
  }

  function makeZero() {
    const root = new THREE.Group(), spin = new THREE.Group();
    const m = new THREE.Mesh(GEO_ZERO, ZERO_MAT); m.castShadow = true;
    spin.add(m);
    const eyes = makeEyes(0.33, 1.5, 0.42, 0.2);
    eyes.visible = false; spin.add(eyes);
    root.add(spin);
    return { root, spin, eyes };
  }

  function makeDecoy(type) {
    const root = new THREE.Group(), spin = new THREE.Group();
    let mesh;
    if (type === 'letter') {
      mesh = new THREE.Mesh(GEO_O, ZERO_MAT);
    } else {
      const b = new Builder();
      if (type === 'donut') {
        b.add(new THREE.TorusGeometry(1.25, 0.66, 10, 22), '#d79a5a');
        b.add(new THREE.TorusGeometry(1.25, 0.6, 10, 22), '#ff8fb6', new THREE.Matrix4().makeTranslation(0, 0, 0.22));
        for (let i = 0; i < 14; i++) {
          const a = i * 0.9, r = 0.9 + (i % 3) * 0.32;
          b.box(0.09, 0.28, 0.09, ['#fff', '#6fd6f0', '#ffe066'][i % 3], Math.cos(a) * r, Math.sin(a) * r, 0.78, a);
        }
      } else if (type === 'tire') {
        b.add(new THREE.TorusGeometry(1.25, 0.6, 8, 16), '#2a2c33');
        b.add(new THREE.CylinderGeometry(0.72, 0.72, 0.4, 14), '#aeb4bd', new THREE.Matrix4().makeRotationX(Math.PI / 2));
      } else if (type === 'hoop') {
        b.add(new THREE.TorusGeometry(1.85, 0.13, 8, 34), '#ff5fa2');
      } else {
        for (let i = 0; i < 8; i++) {
          b.add(new THREE.TorusGeometry(1.25, 0.5, 8, 6, Math.PI / 4), i % 2 ? '#ffffff' : '#e23c33', new THREE.Matrix4().makeRotationZ(i * Math.PI / 4));
        }
      }
      mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    }
    mesh.castShadow = true;
    spin.add(mesh);
    root.add(spin);
    return { root, spin };
  }

  /* ---------- 조립 ---------- */
  function init(scene, opts = {}) {
    scene_ = scene;
    lite = !!opts.lite;
    if (lite) { FINE_Q = 20; FINE_RANGE = 170; }
    bakeTerrain();
    buildCoarse();
    const colliders = buildLandmarks();
    buildProps(colliders);
    buildClouds();
    buildOcean();
    atmosphere_ = buildAtmosphere(); scene.add(atmosphere_);
    const sky = buildSky(); scene.add(sky);
    return { colliders, sky };
  }

  return {
    R, W, H, ll2v, heightAt, contAt, biomeAt, frameAt, init, cull, landmarks, sat, uniforms, rnd,
    makeOne, makeZero, makeDecoy, heightGrid, contGrid, clamp, sstep, mix,
  };
})();
