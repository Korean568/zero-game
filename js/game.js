// 게임 진행: 이동, 카메라, 0 찾기, 화면 표시, 소리, 엔딩.
(function () {
  const D = GameData, R = World.R;
  const { ll2v, heightAt, contAt, clamp, sstep, mix } = World;
  const $ = (id) => document.getElementById(id);
  const V = () => new THREE.Vector3();

  // 손가락이 주 입력인 기기(휴대폰·태블릿)면 터치 조작을 켠다
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch) document.body.classList.add('touch');

  /* ---------- 사라진 0 표시 ---------- */
  let restored = false;
  const Z = (s) => (restored ? String(s) : String(s).replace(/0/g, '<span class="gone"></span>'));
  const fmtTime = (t) => {
    const s = Math.floor(t), m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  // 1 뒤에 0이 n개 붙은 수의 이름: 1, 10, 100, 1000, 1만, 10만 … 1정, 10정
  const UNITS = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정'];
  const numberName = (n) => (n < 4 ? String(10 ** n) : String(10 ** (n % 4)) + UNITS[Math.floor(n / 4)]);

  /* ---------- 소리 ---------- */
  const Snd = {
    ctx: null, master: null, muted: false, step: 0, next: 0,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.next = this.ctx.currentTime + 0.1;
      setInterval(() => this.schedule(), 100);
    },
    tone(f, dur, type = 'triangle', vol = 0.1, when = 0, slide = 0) {
      if (!this.ctx) return;
      const t = when || this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    hat(when, vol) {
      const c = this.ctx, n = Math.floor(c.sampleRate * 0.04), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = vol;
      s.buffer = buf; s.connect(f); f.connect(g); g.connect(this.master); s.start(when);
    },
    // 0을 찾을수록 악기가 하나씩 늘어난다
    schedule() {
      const c = this.ctx; if (!c || state === 'title') return;
      const spb = 0.25;
      const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
      const mel = [76, 0, 79, 76, 72, 0, 74, 76, 72, 0, 69, 72, 76, 0, 74, 72, 69, 0, 72, 74, 77, 0, 76, 74, 74, 0, 71, 74, 79, 0, 76, 74];
      const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
      while (this.next < c.currentTime + 0.3) {
        const i = this.step, ch = chords[Math.floor(i / 8) % 4], n = found.length;
        this.tone(midi(ch[[0, 1, 2, 1][i % 4]] + 12), 0.22, 'triangle', 0.045, this.next);
        if (n >= 5 && i % 4 === 0) this.tone(midi(ch[0] - 12), 0.5, 'sine', 0.11, this.next);
        if (n >= 15 && mel[i % 32]) this.tone(midi(mel[i % 32]), 0.24, 'square', 0.022, this.next);
        if (n >= 30 && i % 2 === 1) this.hat(this.next, 0.05);
        this.next += spb; this.step++;
      }
    },
    jump() { this.tone(330, 0.16, 'square', 0.03, 0, 330); },
    wrong() { this.tone(220, 0.22, 'sawtooth', 0.06, 0, -110); setTimeout(() => this.tone(150, 0.3, 'sawtooth', 0.06, 0, -60), 180); },
    get() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.13), i * 85)); },
    win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => setTimeout(() => { this.tone(f, 0.45, 'square', 0.06); this.tone(f / 2, 0.45, 'triangle', 0.12); }, i * 150)); },
    toggle() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
      toast(this.muted ? '소리 끔' : '소리 켬');
    },
  };

  /* ---------- 장면 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
  let pixelRatio = Math.min(window.devicePixelRatio, isTouch ? 1 : 1.25);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 1, 6000);

  const hemi = new THREE.HemisphereLight('#d8ecff', '#7d8a63', 1.25);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#fff2dc', 2.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(isTouch ? 512 : 1024, isTouch ? 512 : 1024);
  Object.assign(sunLight.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 5, far: 320 });
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.3;
  scene.add(sunLight, sunLight.target);

  let colliders, sky;

  /* ---------- 상태 ---------- */
  let state = 'title'; // title | dive | play | quiz | card | ending | result
  let elapsed = 0, fooled = 0, mistakes = 0, shownSec = -1;
  const found = [];     // 찾은 0마다 그 대륙 번호를 넣는다
  const TOTAL = Object.values(D.COUNTS).reduce((a, b) => a + b, 0);
  const foundIn = (id) => found.filter((c) => c === id).length;
  const contDone = (id) => foundIn(id) >= D.COUNTS[id];
  const allFound = () => found.length >= TOTAL;
  const items = [];
  const satTarget = [1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 1];
  const NI = ll2v(0, 0);

  const up = ll2v(35.8, 127.2);
  const camFwd = V(), face = V(), sunT = V();
  let pitch = 0.42, dist = 15, air = 0, vy = 0, groundSm = 0, walkPhase = 0, moving = false, onWater = false;
  let dragging = false, nearItem = null, curCont = -1, atNull = false;
  const keys = {};
  const joy = { x: 0, y: 0, sprint: false }; // 터치 조이스틱 입력
  const hero = World.makeOne();
  scene.add(hero.root);
  const followers = [];
  const trail = [];

  function tangentNorth(d, out) {
    out.set(0, 1, 0);
    if (Math.abs(d.y) > 0.99) out.set(1, 0, 0);
    return out.addScaledVector(d, -out.dot(d)).normalize();
  }

  /* ---------- 아이템 배치 ---------- */
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const clearOfColliders = (d, m) => colliders.every((c) => d.angleTo(c.dir) * R > c.r + m);

  function placeNear(l) {
    const start = Math.random() * 6.28, r = l.r + 3.6;
    for (let i = 0; i < 14; i++) {
      const a = start + i * 0.45;
      const d = V().set(Math.cos(a) * r, 0, Math.sin(a) * r).applyMatrix4(l.frame).normalize();
      if (heightAt(d) > 0.5 && clearOfColliders(d, 1.5)) return d;
    }
    return V().set(r, 0, 0).applyMatrix4(l.frame).normalize();
  }

  function addItem(real, type, dir, cont) {
    const m = real ? World.makeZero() : World.makeDecoy(type);
    const h = Math.max(heightAt(dir), 0);
    m.root.position.copy(dir).multiplyScalar(R + h + 2.2);
    m.root.quaternion.setFromRotationMatrix(World.frameAt(dir));
    scene.add(m.root);
    items.push({ real, type, dir, hintDir: real ? fuzzyDir(dir) : null, cont, root: m.root, spin: m.spin, zero: real ? m : null, taken: false, phase: Math.random() * 6 });
  }

  // 지도는 대략적인 범위만 알려 준다. 진짜 0은 원의 가운데가 아니라 원 안 어딘가에 있다.
  const HINT_R = 50;
  function fuzzyDir(dir) {
    const north = tangentNorth(dir, V()), east = V().crossVectors(north, dir).normalize();
    const a = Math.random() * 6.28, r = Math.random() * HINT_R * 0.62 / R;
    return dir.clone().addScaledVector(north, Math.cos(a) * r).addScaledVector(east, Math.sin(a) * r).normalize();
  }

  // 지도 범위에 도착해도 모양을 살펴야 하도록, 진짜 곁에 알파벳 O를 둔다
  function addDecoyNear(center, id) {
    const north = tangentNorth(center, V()), east = V().crossVectors(north, center).normalize();
    const start = Math.random() * 6.28;
    for (let i = 0; i < 10; i++) {
      const a = start + i * 1.1, r = (8 + Math.random() * 8) / R;
      const d = center.clone().addScaledVector(north, Math.cos(a) * r).addScaledVector(east, Math.sin(a) * r).normalize();
      if (heightAt(d) < 0.5 || !clearOfColliders(d, 1.5)) continue;
      addItem(false, 'letter', d, id);
      return;
    }
  }

  // 대륙 안의 빈 땅 한 곳. 다른 물건과 되도록 떨어뜨리고, 자리가 없으면 간격을 줄인다.
  function randomLand(id, away) {
    const d = V();
    for (const sep of [30, 16, 6]) {
      for (let t = 0; t < 5000; t++) {
        const y = Math.random() * 2 - 1, a = Math.random() * 6.28, s = Math.sqrt(1 - y * y);
        d.set(s * Math.cos(a), y, s * Math.sin(a));
        if (contAt(d) !== id || heightAt(d) < 1 || !clearOfColliders(d, 4)) continue;
        if (d.angleTo(up) * R < 30 || away.some((o) => o.angleTo(d) * R < sep)) continue;
        return d.clone();
      }
    }
    return null;
  }

  function setupItems() {
    const types = Object.keys(D.DECOYS);
    let t = Math.floor(Math.random() * types.length);
    const nextType = () => types[t++ % types.length];
    for (let id = 1; id <= 7; id++) {
      const spots = shuffle(World.landmarks.filter((l) => l.cont === id && D.SPOTS[id].some((s) => s.key === l.key)));
      const count = D.COUNTS[id], used = [];
      const addReal = (d) => { used.push(d); addItem(true, null, d, id); addDecoyNear(d, id); };
      // 진짜의 절반쯤은 랜드마크 곁에, 나머지는 벌판에 숨는다. 랜드마크 하나는 가짜 몫으로 남긴다.
      const atSpots = Math.min(spots.length - 1, Math.ceil(count / 2));
      spots.forEach((l, i) => {
        const d = placeNear(l);
        if (i < atSpots) addReal(d);
        else { used.push(d); addItem(false, nextType(), d, id); }
      });
      for (let i = atSpots; i < count; i++) addReal(randomLand(id, used) || placeNear(spots[0]));
      for (let i = 0; i < 4; i++) {
        const d = randomLand(id, used);
        if (d) { used.push(d); addItem(false, nextType(), d, id); }
      }
    }
  }

  /* ---------- 입자 ---------- */
  const PN = 1600;
  const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3);
  const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pC0 = new Float32Array(PN * 3);
  let pHead = 0, pGravity = V();
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.3, map: pTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  particles.frustumCulled = false;
  scene.add(particles);

  const cTmp = new THREE.Color();
  function burst(pos, color, n, speed) {
    cTmp.set(color);
    for (let i = 0; i < n; i++) {
      const k = pHead; pHead = (pHead + 1) % PN;
      const y = Math.random() * 2 - 1, a = Math.random() * 6.28, s = Math.sqrt(1 - y * y), sp = speed * (0.5 + Math.random() * 0.6);
      pPos[k * 3] = pos.x; pPos[k * 3 + 1] = pos.y; pPos[k * 3 + 2] = pos.z;
      pVel[k * 3] = s * Math.cos(a) * sp; pVel[k * 3 + 1] = y * sp; pVel[k * 3 + 2] = s * Math.sin(a) * sp;
      pC0[k * 3] = cTmp.r; pC0[k * 3 + 1] = cTmp.g; pC0[k * 3 + 2] = cTmp.b;
      pLife[k] = 1;
    }
  }
  function updateParticles(dt) {
    pGravity.copy(up).multiplyScalar(-9 * dt);
    for (let k = 0; k < PN; k++) {
      if (pLife[k] <= 0) continue;
      pLife[k] -= dt * 0.75;
      const l = Math.max(pLife[k], 0);
      pVel[k * 3] += pGravity.x; pVel[k * 3 + 1] += pGravity.y; pVel[k * 3 + 2] += pGravity.z;
      pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      pCol[k * 3] = pC0[k * 3] * l; pCol[k * 3 + 1] = pC0[k * 3 + 1] * l; pCol[k * 3 + 2] = pC0[k * 3 + 2] * l;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- 화면 표시 ---------- */
  function renderNumber() {
    const n = found.length;
    $('number').innerHTML = '<b class="one">1</b>' + (n ? `<b class="zero">0</b><small>×${n}</small>` : '<span class="gone big"></span>');
    $('reading').textContent = `${numberName(n)} · ${n}/${TOTAL + 1}개`;
    drawMapBase();
  }
  let toastTimer = 0;
  function toast(html, ms = 2600) {
    const el = $('toast');
    el.innerHTML = html; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  let bannerTimer = 0;
  function banner(text) {
    const el = $('banner');
    el.textContent = text; el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function setHint() {
    let html;
    if (allFound()) html = `<em>마지막 0</em>${Z('위도 0°, 경도 0°. 지도의 ★로 가자.')}`;
    else if (curCont > 0 && contDone(curCont)) html = `<em>${D.CONTINENTS[curCont].name} 완료</em>이 대륙의 0을 모두 찾았다. 다른 대륙의 빨간 원으로 가자.`;
    else if (curCont > 0) html = `<em>${D.CONTINENTS[curCont].name} ${foundIn(curCont)}/${D.COUNTS[curCont]}</em>지도의 빨간 원 안 어딘가에 0이 숨어 있다.`;
    else html = '<em>바다</em>지도의 빨간 원이 있는 대륙으로 항해하자.';
    $('hint').innerHTML = html;
  }

  /* ---------- 지도: 0을 찾는 유일한 단서 ---------- */
  const mapC = $('map'), mapG = mapC.getContext('2d');
  const bigC = $('bigMap'), bigG = bigC.getContext('2d');
  const mapBase = document.createElement('canvas');
  const BW = 1440, BH = 720;
  mapBase.width = BW; mapBase.height = BH;
  let mapZoom = 1, bigOpen = false;

  function drawMapBase() {
    const g = mapBase.getContext('2d'), img = g.createImageData(BW, BH);
    for (let y = 0; y < BH; y++) {
      const gy = Math.floor((y + 0.5) / BH * World.H);
      for (let x = 0; x < BW; x++) {
        const i = gy * World.W + Math.floor((x + 0.5) / BW * World.W), o = (y * BW + x) * 4;
        const land = World.heightGrid[i] > 0, id = World.contGrid[i];
        let c = [28, 62, 104];
        if (land) c = id === 0 ? [240, 214, 140] : contDone(id) ? [111, 201, 110] : [176, 184, 196];
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const toBase = (d) => [
    (Math.atan2(-d.z, d.x) / Math.PI * 180 + 180) / 360 * BW,
    (90 - Math.asin(clamp(d.y, -1, 1)) / Math.PI * 180) / 180 * BH,
  ];
  const wrapX = (dx) => ((dx + BW / 2) % BW + BW) % BW - BW / 2;
  const mapTargets = () => (allFound() ? [NI] : items.filter((it) => it.real && !it.taken).map((it) => it.hintDir));

  const aheadDir = V();
  function paintMap(g, cw, ch, zoom, labels, time) {
    const [px, py] = toBase(up);
    const e = clamp((zoom - 1) / 4, 0, 1), sw = BW / zoom, sh = BH / zoom;
    const cx = mix(BW / 2, px, e), cy = clamp(mix(BH / 2, py, e), sh / 2, BH - sh / 2);
    const k = cw / sw, sx = cx - sw / 2, sy = cy - sh / 2;
    const project = (x, y) => [k * (wrapX(x - cx) + sw / 2), k * (y - sy)];
    g.imageSmoothingEnabled = zoom < 2;
    for (const off of [-BW, 0, BW]) g.drawImage(mapBase, (off - sx) * k, -sy * k, BW * k, BH * k);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';

    if (labels) {
      g.font = `700 ${Math.round(cw / 34)}px "Malgun Gothic","Apple SD Gothic Neo",sans-serif`;
      for (const id in D.CONTINENTS) {
        const c = D.CONTINENTS[id];
        const [x, y] = project((c.label[0] + 180) / 360 * BW, (90 - c.label[1]) / 180 * BH);
        const t = c.name + (contDone(+id) ? ' ✓' : ` ${foundIn(+id)}/${D.COUNTS[id]}`);
        g.lineWidth = cw / 140; g.strokeStyle = 'rgba(10,20,40,.75)'; g.strokeText(t, x, y);
        g.fillStyle = '#fff'; g.fillText(t, x, y);
      }
    }

    const pxPerDeg = BW / 360 * k, ry = HINT_R / R * 180 / Math.PI * pxPerDeg;
    for (const d of mapTargets()) {
      const [bx, by] = toBase(d);
      const [x, y] = project(bx, by);
      if (allFound()) {
        g.font = `${cw / 20 + Math.sin(time * 5) * 3}px sans-serif`;
        g.strokeStyle = '#1b2233'; g.lineWidth = cw / 160; g.fillStyle = '#ffd34d';
        g.strokeText('★', x, y); g.fillText('★', x, y);
        continue;
      }
      // 평면 지도라 고위도일수록 가로로 늘어난다
      const rx = Math.min(ry / Math.max(Math.sqrt(1 - d.y * d.y), 0.15), ry * 5);
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(229,40,28,.26)'; g.fill();
      g.strokeStyle = '#e5281c'; g.lineWidth = Math.max(1.5, cw / 320); g.stroke();
    }

    const [hx, hy] = project(px, py);
    aheadDir.copy(up).addScaledVector(face, 0.09).normalize();
    const [ax, ay] = toBase(aheadDir);
    const u = cw / 44;
    g.save(); g.translate(hx, hy); g.rotate(Math.atan2(ay - py, wrapX(ax - px)));
    g.beginPath(); g.moveTo(u, 0); g.lineTo(-u * 0.65, u * 0.65); g.lineTo(-u * 0.3, 0); g.lineTo(-u * 0.65, -u * 0.65); g.closePath();
    g.fillStyle = '#ff5d47'; g.strokeStyle = '#fff'; g.lineWidth = cw / 200; g.stroke(); g.fill();
    g.restore();
  }
  function drawMaps(time) {
    // 빨간 원 근처에 오면 구석 지도가 자동으로 확대된다
    let near = Infinity;
    for (const d of mapTargets()) near = Math.min(near, d.angleTo(up) * R);
    mapZoom += ((near < 70 ? 5 : 1) - mapZoom) * 0.12;
    paintMap(mapG, mapC.width, mapC.height, mapZoom, mapZoom < 1.5, time);
    if (bigOpen) paintMap(bigG, bigC.width, bigC.height, 1, true, time);
  }
  function toggleBigMap() {
    bigOpen = !bigOpen;
    $('bigMapBox').classList.toggle('show', bigOpen);
  }

  /* ---------- 입력 ---------- */
  window.addEventListener('keydown', (e) => {
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (state === 'title' && e.code === 'Enter') startGame();
    if (e.code === 'KeyN') Snd.toggle();
    if (state === 'card' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE')) { closeCard(); return; }
    if (state === 'quiz' && e.code === 'Escape') Quiz.cancel();
    if (state !== 'play') return;
    if (e.code === 'Space' && air <= 0.01) { vy = 15; air = 0.02; Snd.jump(); }
    if (e.code === 'KeyE') pickUp();
    if (e.code === 'KeyM' || e.code === 'Tab' || (e.code === 'Escape' && bigOpen)) toggleBigMap();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const view = $('view');
  let lastX = 0, lastY = 0, dragId = null;
  view.addEventListener('pointerdown', (e) => { if (dragging) return; dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragging = false; });
  view.addEventListener('pointercancel', (e) => { if (e.pointerId === dragId) dragging = false; });
  view.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragId || state !== 'play') return;
    camFwd.applyAxisAngle(up, -(e.clientX - lastX) * 0.005).normalize();
    pitch = clamp(pitch + (e.clientY - lastY) * 0.004, 0.14, 1.15);
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('wheel', (e) => { dist = clamp(dist + e.deltaY * 0.012, 8, 30); }, { passive: true });
  $('cardOk').addEventListener('click', () => closeCard());
  $('startBtn').addEventListener('click', () => startGame());
  $('againBtn').addEventListener('click', () => location.reload());

  /* ---------- 터치 조작 ---------- */
  if (isTouch) {
    const pad = $('joy'), knob = $('joyKnob'), MAX = 46;
    let joyId = null, cx = 0, cy = 0;
    const moveJoy = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > MAX) { dx *= MAX / len; dy *= MAX / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const on = len > MAX * 0.18;
      joy.x = on ? dx / MAX : 0;
      joy.y = on ? -dy / MAX : 0;
      joy.sprint = len >= MAX; // 끝까지 밀면 달린다
    };
    const endJoy = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null; joy.x = 0; joy.y = 0; joy.sprint = false;
      knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId;
      pad.setPointerCapture(joyId);
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      moveJoy(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveJoy(e); });
    pad.addEventListener('pointerup', endJoy);
    pad.addEventListener('pointercancel', endJoy);

    // 버튼은 키보드와 같은 동작을 부른다
    document.querySelectorAll('[data-key]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: b.dataset.key }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: b.dataset.key }));
      });
    });

    $('tips').innerHTML = '<div>왼쪽 조이스틱으로 이동, 끝까지 밀면 달리기</div><div>화면을 끌면 시점이 돌아간다</div><div>지도 버튼의 빨간 원 안에서 세로로 길쭉한 0을 찾아 줍자</div>';
    $('prompt').textContent = '줍기 버튼: 정체불명의 동그라미';
    $('bigMapNote').textContent = '빨간 원 안 어딘가에 0이 있다 · 화살표는 현재 위치 · 지도 버튼으로 닫기';
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  /* ---------- 동작 ---------- */
  function openQuiz(onSolved, onCancel) {
    state = 'quiz';
    moving = false;
    $('prompt').classList.remove('show');
    Quiz.open({
      onWrong() { mistakes++; elapsed += 5; Snd.wrong(); },
      onSolved() { state = 'play'; onSolved(); },
      onCancel() { state = 'play'; if (onCancel) onCancel(); },
    });
  }

  function collectZero(it) {
    it.taken = true;
    it.zero.eyes.visible = true;
    it.zero.spin.rotation.set(0, 0, 0);
    followers.push({ root: it.root, spin: it.zero.spin, dir: it.dir.clone(), fwd: face.clone(), hop: followers.length * 0.7 });
    it.root.scale.setScalar(0.75);
    if (followers.length > 8) it.root.traverse((o) => { o.castShadow = false; }); // 긴 행렬의 그림자는 생략해 프레임을 지킨다
    const id = it.cont, first = foundIn(id) === 0;
    found.push(id);
    satTarget[id] = 0.2 + 0.8 * foundIn(id) / D.COUNTS[id];
    renderNumber();
    setHint();
    Snd.get();
    if (first) showCard(id);   // 역사 이야기는 대륙마다 첫 0에서 한 번씩
    else announceProgress(id);
  }

  function announceProgress(id) {
    const name = D.CONTINENTS[id].name;
    if (allFound()) {
      banner('마지막 0이 부른다');
      toast('일곱 대륙의 색이 모두 돌아왔다. 이제 지도의 ★, <b>세상의 원점</b>으로!', 5000);
    } else if (contDone(id)) {
      banner(`${name} 완료`);
      toast(`${name}의 0을 모두 찾았다. 지금 세상의 수는 <b>${numberName(found.length)}</b>`);
    } else {
      toast(`${name} ${foundIn(id)}/${D.COUNTS[id]} · 지금 세상의 수는 <b>${numberName(found.length)}</b>`);
    }
  }

  function pickUp() {
    const it = nearItem; if (!it) return;
    if (it.real) { openQuiz(() => collectZero(it)); return; }
    it.taken = true;
    it.root.visible = false;
    fooled++; elapsed += 10;
    Snd.wrong();
    toast(`<b class="bad">가짜!</b> ${D.DECOYS[it.type]} <i>${Z('+10초')}</i>`, 3800);
  }

  function showCard(id) {
    const f = D.FACTS[id];
    $('cardPlace').textContent = f.place;
    $('cardTitle').textContent = f.title;
    $('cardBody').innerHTML = Z(f.body);
    $('cardNum').textContent = numberName(found.length);
    $('cardNumLabel').textContent = `${found.length}번째 0을 찾았다! 세상에 이 수가 돌아왔다`;
    $('card').classList.add('show');
    state = 'card';
    cardOpenAt = performance.now();
    setHint();
  }
  let cardOpenAt = 0;
  function closeCard() {
    if (performance.now() - cardOpenAt < 350) return;
    $('card').classList.remove('show');
    state = 'play';
  }

  /* ---------- 이동 ---------- */
  const move = V(), camRight = V(), axis = V(), oldUp = V(), qT = new THREE.Quaternion(), mB = new THREE.Matrix4(), xT = V();
  function orient(obj, fwd, u) {
    xT.crossVectors(u, fwd).normalize();
    mB.makeBasis(xT, u, fwd);
    obj.quaternion.setFromRotationMatrix(mB);
  }
  const reortho = (v) => v.addScaledVector(up, -v.dot(up)).normalize();

  function updatePlayer(dt) {
    const ix = clamp((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x, -1, 1);
    const iz = clamp((keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y, -1, 1);
    camRight.crossVectors(camFwd, up).normalize();
    move.set(0, 0, 0).addScaledVector(camFwd, iz).addScaledVector(camRight, ix);
    moving = move.lengthSq() > 0;

    const h = heightAt(up);
    onWater = h < -0.15;
    if (moving) {
      move.normalize();
      const sprint = keys.ShiftLeft || keys.ShiftRight || joy.sprint;
      const speed = onWater ? (sprint ? 72 : 58) : (sprint ? 38 : 25);
      oldUp.copy(up);
      axis.crossVectors(up, move).normalize();
      up.applyAxisAngle(axis, speed * dt / R).normalize();
      qT.setFromUnitVectors(oldUp, up);
      camFwd.applyQuaternion(qT); face.applyQuaternion(qT); sunT.applyQuaternion(qT); move.applyQuaternion(qT);
      // 옆으로 가면 카메라가 천천히 따라 돈다
      if (!dragging && iz >= 0 && ix !== 0) {
        camFwd.applyAxisAngle(up, -ix * (iz ? 0.9 : 1.5) * dt);
      }
      const turn = 1 - Math.exp(-dt * 12);
      face.lerp(move, turn);
      walkPhase += dt * Math.min(speed, 24) * 0.75;
      if (!trail.length || trail[trail.length - 1].angleTo(up) * R > 0.35) {
        trail.push(up.clone());
        if (trail.length > 340) trail.shift();
      }
    }
    for (const c of colliders) {
      const a = c.dir.angleTo(up) * R, r = c.r + 0.9;
      if (a < r && a > 0.0001) {
        axis.copy(up).sub(c.dir).addScaledVector(up, -up.clone().sub(c.dir).dot(up)).normalize();
        up.addScaledVector(axis, (r - a) / R).normalize();
      }
    }
    reortho(camFwd); reortho(face); reortho(sunT);

    vy -= 38 * dt;
    air = Math.max(0, air + vy * dt);
    if (air === 0) vy = 0;
    const ground = Math.max(heightAt(up), 0);
    groundSm += (ground - groundSm) * (1 - Math.exp(-dt * 14));

    // 진행 상황 판정
    nearItem = null; let bd = 5.5;
    for (const it of items) {
      if (it.taken) continue;
      const d = it.dir.angleTo(up) * R;
      if (d < bd) { bd = d; nearItem = it; }
    }
    $('prompt').classList.toggle('show', !!nearItem);

    const c = heightAt(up) > 0.2 ? contAt(up) : 0;
    if (c !== curCont) {
      curCont = c;
      if (c > 0) banner(D.CONTINENTS[c].name);
      setHint();
    }
    const nearNull = NI.angleTo(up) * R < 13;
    if (nearNull && !atNull) {
      if (allFound()) openQuiz(() => startEnding(), () => toast('마지막 문제를 풀어야 0이 돌아온다. 섬을 나갔다 다시 들어오면 새 문제가 나온다.', 4500));
      else { banner('널 아일랜드'); toast(Z(`여기는 위도 0°, 경도 0°, 세상의 원점. 일곱 대륙의 0을 모은 뒤 다시 오자. (지금 ${found.length}/${TOTAL}개)`), 5000); }
    }
    atNull = nearNull;
  }

  function placeHero(dt, time) {
    const y = R + groundSm + air;
    hero.root.position.copy(up).multiplyScalar(y);
    orient(hero.root, face, up);
    const swing = moving && air === 0 && !onWater ? Math.sin(walkPhase) * 0.8 : 0;
    hero.legs[0].rotation.x = swing; hero.legs[1].rotation.x = -swing;
    const inBoat = onWater && air < 0.4;
    hero.boat.visible = inBoat;
    hero.legs[0].visible = hero.legs[1].visible = !inBoat;
    const bob = inBoat ? 0.55 + Math.sin(time * 3.2) * 0.12 : moving && air === 0 ? Math.abs(Math.sin(walkPhase)) * 0.16 : 0;
    hero.body.position.y = bob;
    hero.boat.position.y = inBoat ? Math.sin(time * 3.2) * 0.1 : 0;
    hero.boat.rotation.z = inBoat ? Math.sin(time * 2.1) * 0.05 : 0;
    const stretch = 1 + clamp(vy * 0.008, -0.1, 0.12);
    hero.body.scale.set(2 - stretch, stretch, 1);
    hero.body.rotation.x = moving ? 0.07 : 0;
  }

  const fTarget = V(), fDelta = V();
  function updateFollowers(dt, time) {
    followers.forEach((f, i) => {
      const idx = trail.length - 1 - (i + 1) * 8;
      fTarget.copy(idx >= 0 ? trail[idx] : trail[0] || up);
      fDelta.copy(fTarget).sub(f.dir);
      f.dir.lerp(fTarget, 1 - Math.exp(-dt * 7)).normalize();
      fDelta.addScaledVector(f.dir, -fDelta.dot(f.dir));
      if (fDelta.length() > 0.0015) f.fwd.lerp(fDelta.normalize(), 1 - Math.exp(-dt * 8));
      f.fwd.addScaledVector(f.dir, -f.fwd.dot(f.dir)).normalize();
      const hop = moving ? Math.abs(Math.sin(walkPhase * 0.9 + f.hop)) * 0.55 : Math.abs(Math.sin(time * 2 + f.hop)) * 0.08;
      f.root.position.copy(f.dir).multiplyScalar(R + Math.max(heightAt(f.dir), 0) + 1.45 + hop);
      orient(f.root, f.fwd, f.dir);
    });
  }

  function updateItems(dt, time, refDir) {
    for (const it of items) {
      if (it.taken) continue;
      const vis = it.dir.dot(refDir) > 0.93;
      it.root.visible = vis && state !== 'title';
      if (!vis) continue;
      it.spin.rotation.y = time * 0.6 + it.phase;
    }
  }

  /* ---------- 카메라 ---------- */
  const camTarget = V(), lookTarget = V(), radial = V();
  function chaseTargets() {
    const p = hero.root.position;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camTarget.copy(p).addScaledVector(camFwd, -dist * cp).addScaledVector(up, dist * sp + 1.5);
    const r = camTarget.length();
    radial.copy(camTarget).divideScalar(r);
    const minR = R + Math.max(heightAt(radial), 0) + 2.2;
    if (r < minR) camTarget.copy(radial).multiplyScalar(minR);
    lookTarget.copy(p).addScaledVector(up, 2.6).addScaledVector(camFwd, 3);
  }

  const sunDir = V(), tmpV = V(), tmpV2 = V();
  function updateLighting(refUp, tRef) {
    sunDir.copy(refUp).multiplyScalar(0.8).addScaledVector(tRef, 0.55);
    tmpV.crossVectors(refUp, tRef);
    sunDir.addScaledVector(tmpV, 0.22).normalize();
    World.uniforms.uSun.value.copy(sunDir);
    World.uniforms.uUp.value.copy(refUp);
    hemi.position.copy(refUp);
    tmpV2.copy(refUp).multiplyScalar(R + groundSm);
    sunLight.target.position.copy(tmpV2);
    sunLight.position.copy(tmpV2).addScaledVector(sunDir, 150);
  }
  function updateSpace() {
    const alt = camera.position.length() - R;
    const s = sstep(90, 520, alt);
    World.uniforms.uSpace.value = s;
    sky.position.copy(camera.position);
    sky.userData.stars.material.opacity = s;
    sky.userData.stars.visible = s > 0.01;
  }

  /* ---------- 시작 ---------- */
  let titleAngle = 2.1, diveT = 0;
  const diveFrom = V(), diveUp = V(), diveLook = V();

  function titleCam(dt) {
    titleAngle += dt * 0.07;
    const r = R * 3.1, ph = 0.3;
    camera.position.set(Math.cos(titleAngle) * Math.cos(ph) * r, Math.sin(ph) * r, Math.sin(titleAngle) * Math.cos(ph) * r);
    camera.up.set(0, 1, 0);
    // 지구를 화면 오른쪽에 두기 위해 왼쪽을 바라본다
    tmpV.set(0, 1, 0).cross(camera.position).normalize();
    lookTarget.copy(tmpV).multiplyScalar(window.innerWidth > 700 ? -R * 0.95 : 0);
    camera.lookAt(lookTarget);
    radial.copy(camera.position).normalize();
    tmpV.set(0.5, 0.75, 0.2).normalize();
    updateLighting(radial, tmpV.addScaledVector(radial, -tmpV.dot(radial)).normalize());
  }

  function startGame() {
    if (state !== 'title') return;
    Snd.init();
    if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
    $('title').classList.add('hide');
    state = 'dive'; diveT = 0;
    diveFrom.copy(camera.position);
    diveUp.copy(camera.up);
    diveLook.copy(lookTarget);
    document.body.classList.add('playing');
    placeHero(0, 0);
  }

  function updateDive(dt) {
    diveT += dt / 3.2;
    const t = clamp(diveT, 0, 1), e = t * t * (3 - 2 * t);
    chaseTargets();
    const a = diveFrom.clone().normalize(), b = camTarget.clone().normalize();
    const d = a.clone().lerp(b, e).normalize();
    const r = mix(diveFrom.length(), camTarget.length(), e * e);
    camera.position.copy(d).multiplyScalar(r);
    camera.up.copy(diveUp).lerp(up, e).normalize();
    tmpV.copy(diveLook).lerp(lookTarget, e);
    camera.lookAt(tmpV);
    updateLighting(radial.copy(camera.position).normalize().lerp(up, e * e).normalize(), reortho(sunT.clone()));
    if (diveT >= 1) {
      state = 'play';
      camera.position.copy(camTarget);
      banner(D.CONTINENTS[1].name);
      setHint();
      $('tips').classList.add('show');
      setTimeout(() => $('tips').classList.remove('show'), 11000);
    }
  }

  /* ---------- 엔딩 ---------- */
  let endT = 0, finalZero = null, fired = false, restoredDone = false, nextFirework = 0;
  const endF = V(), endX = V(), endCam = V(), endLook = V(), endFrom = V();
  const SPACING = 2.75;

  function lineDir(i, out) {
    const off = (i - (followers.length + 1) / 2) * SPACING;
    return out.copy(NI).addScaledVector(endX, off / R).normalize();
  }

  function startEnding() {
    state = 'ending'; endT = 0;
    $('prompt').classList.remove('show');
    tangentNorth(NI, endF).negate();           // 남쪽(카메라 방향)
    endX.crossVectors(NI, endF).normalize();
    const top = R + heightAt(NI);
    const lineW = (followers.length + 2) * SPACING;
    const back = clamp(lineW / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 1.08, 30, 190);
    endCam.copy(NI).multiplyScalar(top + 7 + back * 0.2).addScaledVector(endF, back);
    endLook.copy(NI).multiplyScalar(top + 2.8);
    endFrom.copy(camera.position);
    const z = World.makeZero();
    z.eyes.visible = true;
    scene.add(z.root);
    finalZero = z;
    z.root.position.set(0, 0, 0);
    followers.forEach((f) => { f.from = f.dir.clone(); });
    hero.fromDir = up.clone();
    moving = false;
    found.push(8);
    Snd.tone(196, 1.5, 'sawtooth', 0.05, 0, 600);
  }

  const lt = V();
  function updateEnding(dt, time) {
    endT += dt;
    const camE = sstep(0, 1.6, endT);
    camera.position.lerpVectors(endFrom, endCam, camE);
    camera.up.copy(NI);
    camera.lookAt(endLook);

    // 1과 0들이 한 줄로 선다
    const lineE = sstep(0.1, 1.5, endT);
    lineDir(0, lt);
    up.copy(hero.fromDir).lerp(lt, lineE).normalize();
    hero.root.position.copy(up).multiplyScalar(R + Math.max(heightAt(up), 0));
    orient(hero.root, endF, up);
    hero.boat.visible = false; hero.legs[0].visible = hero.legs[1].visible = true;
    hero.body.position.y = 0; hero.body.scale.set(1, 1, 1); hero.body.rotation.x = 0;
    hero.legs[0].rotation.x = hero.legs[1].rotation.x = 0;
    followers.forEach((f, i) => {
      lineDir(i + 1, lt);
      f.dir.copy(f.from).lerp(lt, lineE).normalize();
      const s = mix(0.75, 1, lineE);
      f.root.scale.setScalar(s);
      const dance = endT > 3.2 ? Math.abs(Math.sin(time * 5 + i * 0.5)) * 0.7 : 0;
      f.root.position.copy(f.dir).multiplyScalar(R + Math.max(heightAt(f.dir), 0) + 1.95 + dance);
      orient(f.root, endF, f.dir);
    });
    if (endT > 3.2) hero.body.position.y = Math.abs(Math.sin(time * 5)) * 0.7;

    // 여덟 번째 0이 하늘에서 떨어진다
    lineDir(followers.length + 1, lt);
    const fallT = clamp((endT - 1.2) / 1.1, 0, 1);
    const fallY = (1 - fallT * fallT) * 90;
    const sc = mix(5, 1, fallT);
    finalZero.root.scale.setScalar(sc);
    const dance8 = endT > 3.2 ? Math.abs(Math.sin(time * 5 + 4)) * 0.7 : 0;
    finalZero.root.position.copy(lt).multiplyScalar(R + Math.max(heightAt(lt), 0) + 1.95 * sc + fallY + dance8);
    orient(finalZero.root, endF, lt);

    if (fallT >= 1 && !restoredDone) {
      restoredDone = true;
      restored = true;
      document.body.classList.add('restored');
      renderNumber();
      setHint();
      $('timer').innerHTML = fmtTime(elapsed);
      Snd.win();
      banner(numberName(found.length));
    }
    if (restoredDone && endT < 30 && time > nextFirework) {
      nextFirework = time + 0.42;
      lt.copy(NI).addScaledVector(endX, (Math.random() - 0.5) * 110 / R).addScaledVector(endF, -Math.random() * 15 / R).normalize().multiplyScalar(R + 16 + Math.random() * 18);
      burst(lt, ['#ff5d47', '#ffd34d', '#6fd6f0', '#a7f070', '#ff8fd0'][Math.floor(Math.random() * 5)], 80, 16);
      Snd.tone(900 + Math.random() * 500, 0.1, 'sine', 0.02);
    }
    if (endT > 5.4 && !fired) {
      fired = true;
      showResult();
    }
  }

  function showResult() {
    state = 'result';
    let best = null;
    try {
      const prev = parseFloat(localStorage.getItem('zero-best'));
      best = isNaN(prev) ? elapsed : Math.min(prev, elapsed);
      localStorage.setItem('zero-best', String(best));
    } catch (e) { /* 저장 불가 환경에서는 기록만 생략 */ }
    const rank = elapsed < 1200 ? '0의 화신' : elapsed < 1800 ? '세계 일주 수학자' : elapsed < 2700 ? '믿음직한 탐험가' : '느긋한 여행자';
    $('rTime').textContent = fmtTime(elapsed);
    $('rFooled').textContent = fooled + '번';
    $('rMistakes').textContent = mistakes + '번';
    $('rRank').textContent = rank;
    $('rBest').textContent = best === null ? '-' : fmtTime(best);
    $('result').classList.add('show');
  }

  /* ---------- 메인 루프 ---------- */
  const clock = new THREE.Clock();
  let time = 0, mapTick = 0;
  function frame() {
    requestAnimationFrame(frame);
    step(clock.getDelta());
  }
  function step(dtRaw) {
    const dt = Math.min(dtRaw, 0.05);
    time += dt;
    World.uniforms.uTime.value = time;
    for (let i = 0; i < 9; i++) World.sat.value[i] += (satTarget[i] - World.sat.value[i]) * (1 - Math.exp(-dt * 1.3));

    if (state === 'title') titleCam(dt);
    else if (state === 'dive') updateDive(dt);
    else if (state === 'play' || state === 'card' || state === 'quiz') {
      if (state === 'play') updatePlayer(dt);
      if (state === 'play' || state === 'quiz') {
        elapsed += dt;
        const s = Math.floor(elapsed);
        if (s !== shownSec) { shownSec = s; $('timer').innerHTML = Z(fmtTime(elapsed)); }
      }
      placeHero(dt, time);
      updateFollowers(dt, time);
      chaseTargets();
      camera.position.lerp(camTarget, 1 - Math.exp(-dt * 9));
      camera.up.copy(up);
      camera.lookAt(lookTarget);
      updateLighting(up, sunT);
    } else {
      updateEnding(dt, time);
      updateLighting(NI, endF);
    }
    updateItems(dt, time, state === 'ending' || state === 'result' ? NI : up);
    updateParticles(dt);
    updateSpace();

    if (state !== 'title' && (mapTick++ % 4 === 0)) drawMaps(time);
    World.cull(camera.position);
    renderer.render(scene, camera);
    adaptQuality(dtRaw);
  }

  // 느린 컴퓨터(발표장 노트북 등)에서는 화질을 낮춰 프레임을 지킨다
  let perfTime = 0, perfFrames = 0, perfLevel = 0, perfWarm = 0;
  function adaptQuality(dtRaw) {
    if (document.hidden || dtRaw > 1) return; // 탭이 잠깐 멈춘 경우는 세지 않는다
    if ((perfWarm += dtRaw) < 2) return;      // 시작 직후 컴파일 지연은 무시
    perfTime += dtRaw; perfFrames++;
    if (perfTime < 1.5) return;
    const fps = perfFrames / perfTime;
    perfTime = 0; perfFrames = 0;
    if (fps >= 27 || perfLevel >= 3) return;
    perfLevel++;
    if (perfLevel === 1) pixelRatio = Math.min(pixelRatio, 1);
    else if (perfLevel === 2) pixelRatio = 0.75;
    else {
      pixelRatio = 0.6;
      sunLight.castShadow = false;
    }
    renderer.setPixelRatio(pixelRatio);
    resize();
    perfWarm = 0;
  }

  /* ---------- 초기화 ---------- */
  function init() {
    const w = World.init(scene, { lite: isTouch });
    colliders = w.colliders; sky = w.sky;
    resize();
    tangentNorth(up, camFwd);
    face.copy(camFwd);
    tangentNorth(up, sunT).applyAxisAngle(up, 2.3);
    groundSm = Math.max(heightAt(up), 0);
    hero.root.position.copy(up).multiplyScalar(R + groundSm);
    setupItems();
    renderNumber();
    $('timer').innerHTML = Z('00:00');
    $('story').innerHTML = D.STORY.map((s) => `<p>${Z(s)}</p>`).join('');
    try {
      const b = parseFloat(localStorage.getItem('zero-best'));
      if (!isNaN(b)) $('bestTitle').innerHTML = '최고 기록 ' + Z(fmtTime(b));
    } catch (e) { /* 저장소 없으면 표시 안 함 */ }
    $('loading').classList.add('hide');
    $('title').classList.add('ready');
    frame();
  }

  // 발표 중 시연·점검용 지름길 (개발자 콘솔에서 사용)
  window.GAME = {
    teleport(lat, lon) { ll2v(lat, lon, up); reortho(camFwd); reortho(face); reortho(sunT); groundSm = Math.max(heightAt(up), 0); },
    teleportTo(item) { up.copy(item.dir).addScaledVector(tangentNorth(item.dir, V()), -3 / R).normalize(); reortho(camFwd); reortho(face); reortho(sunT); groundSm = Math.max(heightAt(up), 0); },
    get state() { return state; }, get items() { return items; }, get found() { return found; },
    get nearItem() { return nearItem; }, press(code) { keys[code] = true; }, release(code) { keys[code] = false; },
    pick() { pickUp(); }, close() { cardOpenAt = 0; closeCard(); }, start() { startGame(); },
    skipDive() { diveT = 1; }, setPitch(p) { pitch = p; }, setDist(d) { dist = d; }, turn(a) { camFwd.applyAxisAngle(up, a); },
    renderer, scene, camera, get perfLevel() { return perfLevel; },
    tick(frames = 1, dt = 1 / 60) { for (let i = 0; i < frames; i++) step(dt); },
    aim(dir) { camFwd.copy(dir).addScaledVector(up, -dir.dot(up)).normalize(); face.copy(camFwd); },
    snapCam() { chaseTargets(); camera.position.copy(camTarget); camera.up.copy(up); camera.lookAt(lookTarget); },
    get up() { return up.clone(); }, get onWater() { return onWater; }, get elapsed() { return elapsed; },
    get followers() { return followers.length; }, get curCont() { return curCont; },
  };

  // 오프닝이 재생될 때는 지형 생성을 먼저 끝낸다. 오프닝 도중에 만들면 그동안 영상이 멈춘다.
  if (document.querySelector('iframe[title="CLKKY STUDIO"]')) init();
  else setTimeout(init, 40);
})();
