// 수학 5-2 3단원 "합동과 대칭": 선대칭도형 잇기 문제.
// 세 종류: 도형↔대칭축 수 잇기 / 대응점끼리 잇기 / 점을 이어 선대칭도형 완성하기
window.Quiz = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const INK = '#131c33', BLUE = '#2a6fdb', OK = '#2f9e60', BAD = '#e23c33', FILL = '#ffe9b8';
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(str, x, y, size, parent, opts = {}) {
    const t = el('text', { x, y, 'font-size': size, fill: opts.fill || INK, 'font-weight': opts.weight || 700, 'text-anchor': opts.anchor || 'middle', 'dominant-baseline': 'middle' }, parent);
    t.textContent = str;
    return t;
  }

  /* ---------- 공통: 점 잇기 ---------- */
  let S = null, cb = null, svg = null;

  function reset(viewW, viewH) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    S = {
      nodes: [], selected: null, justLinked: false, done: false, chain: false, onLink: null, undo: null, hitR: 24,
      back: el('g', {}, svg), lines: el('g', {}, svg), front: el('g', {}, svg),
    };
    S.rubber = el('line', { stroke: BLUE, 'stroke-width': 3, 'stroke-dasharray': '6 5', visibility: 'hidden', 'pointer-events': 'none' }, S.lines);
  }
  function addNode(id, x, y, r = 8) {
    const c = el('circle', { cx: x, cy: y, r, fill: INK, stroke: '#fff', 'stroke-width': 2 }, S.front);
    const n = { id, x, y, r, c };
    S.nodes.push(n);
    return n;
  }
  const toSvg = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  function hit(p) {
    let best = null, bd = S.hitR;
    for (const n of S.nodes) {
      if (n.locked) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  function moveRubberStart(n) {
    S.rubber.setAttribute('x1', n.x); S.rubber.setAttribute('y1', n.y);
    S.rubber.setAttribute('x2', n.x); S.rubber.setAttribute('y2', n.y);
  }
  function select(n) {
    if (S.selected) { S.selected.c.setAttribute('fill', S.selected.locked ? OK : INK); S.selected.c.setAttribute('r', S.selected.r); }
    S.selected = n;
    if (n) { n.c.setAttribute('fill', BLUE); n.c.setAttribute('r', n.r + 3); moveRubberStart(n); }
    else S.rubber.setAttribute('visibility', 'hidden');
  }
  function drawLine(a, b, color, width = 4) {
    return el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' }, S.lines);
  }
  function link(a, b) {
    S.onLink(a, b);
    if (!S.done) select(S.chain ? b : null);
  }
  function wrong(a, b, msg) {
    const l = drawLine(a, b, BAD, 4);
    setTimeout(() => l.remove(), 550);
    $('quizStatus').innerHTML = `<b class="bad">${msg}</b> +5초`;
    const sheet = $('quizSheet');
    sheet.classList.remove('shake');
    void sheet.getBoundingClientRect();
    sheet.classList.add('shake');
    cb.onWrong();
  }
  function finish(msg) {
    select(null);
    S.done = true;
    $('quizStatus').innerHTML = `<b class="good">정답!</b> ${msg}`;
    $('quizUndo').hidden = true;
    $('quizLater').hidden = true;
    const done = cb;
    setTimeout(() => { $('quiz').classList.remove('show'); done.onSolved(); }, 1600);
  }

  function bind() {
    svg = $('quizSvg');
    svg.addEventListener('pointerdown', (e) => {
      if (!S || S.done) return;
      const n = hit(toSvg(e));
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 캡처가 안 돼도 클릭으로 이을 수 있다 */ }
      if (!n) { select(null); return; }
      if (S.selected && S.selected !== n) { link(S.selected, n); S.justLinked = true; return; }
      if (S.selected === n) { select(null); return; }
      select(n);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!S || S.done || !S.selected) return;
      const p = toSvg(e);
      S.rubber.setAttribute('x2', p.x); S.rubber.setAttribute('y2', p.y);
      S.rubber.setAttribute('visibility', 'visible');
    });
    svg.addEventListener('pointerup', (e) => {
      if (!S || S.done) return;
      if (S.justLinked) { S.justLinked = false; return; }
      const n = hit(toSvg(e));
      if (S.selected && n && n !== S.selected) link(S.selected, n);
    });
    $('quizLater').addEventListener('click', () => cancel());
    $('quizUndo').addEventListener('click', () => { if (S && S.undo) S.undo(); });
  }

  /* ---------- 1. 도형과 대칭축의 수 잇기 ---------- */
  const reg = (n, r, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(rot + i * 2 * Math.PI / n) * r, Math.sin(rot + i * 2 * Math.PI / n) * r]);
  const SHAPES = [
    { name: '정삼각형', pts: reg(3, 33), axes: '3개' },
    { name: '정사각형', pts: reg(4, 34, Math.PI / 4), axes: '4개' },
    { name: '정오각형', pts: reg(5, 32), axes: '5개' },
    { name: '정육각형', pts: reg(6, 32), axes: '6개' },
    { name: '이등변삼각형', pts: [[0, -32], [20, 26], [-20, 26]], axes: '1개' },
    { name: '등변사다리꼴', pts: [[-34, 22], [-16, -20], [16, -20], [34, 22]], axes: '1개' },
    { name: '직사각형', pts: [[-36, -20], [36, -20], [36, 20], [-36, 20]], axes: '2개' },
    { name: '마름모', pts: [[0, -33], [22, 0], [0, 33], [-22, 0]], axes: '2개' },
    { name: '평행사변형', pts: [[-36, 20], [-14, -20], [36, -20], [14, 20]], axes: '없음' },
    { name: '원', circle: 30, axes: '셀 수 없이 많음' },
  ];
  function buildAxis() {
    const picks = [], seen = new Set();
    for (const s of shuffle(SHAPES)) {
      if (seen.has(s.axes)) continue;
      seen.add(s.axes); picks.push(s);
      if (picks.length === 4) break;
    }
    const rowH = 92;
    reset(560, rowH * 4);
    $('quizAsk').textContent = '왼쪽 도형과 그 도형의 대칭축 수를 선으로 이으세요.';
    const right = shuffle(picks.map((s) => s.axes));
    picks.forEach((s, i) => {
      const y = rowH * i + rowH / 2;
      const g = el('g', { transform: `translate(66 ${y - 9})` }, S.back);
      if (s.circle) el('circle', { r: s.circle, fill: FILL, stroke: INK, 'stroke-width': 2.5 }, g);
      else el('polygon', { points: s.pts.map((p) => p.join(',')).join(' '), fill: FILL, stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g);
      text(s.name, 66, y + 34, 13, S.back, { weight: 600 });
      addNode('L' + i, 168, y).answer = s.axes;
      addNode('R' + i, 352, y).value = right[i];
      text(right[i], 372, y, 19, S.back, { anchor: 'start', weight: 800 });
    });
    let left = 4;
    S.onLink = (a, b) => {
      if (a.id[0] === b.id[0]) return;
      const L = a.id[0] === 'L' ? a : b, Rt = L === a ? b : a;
      if (L.answer !== Rt.value) { wrong(L, Rt, '대칭축 수가 달라요.'); return; }
      drawLine(L, Rt, OK);
      for (const n of [L, Rt]) { n.locked = true; n.c.setAttribute('fill', OK); }
      if (--left === 0) finish('대칭축을 따라 접으면 완전히 겹치는 도형이 선대칭도형이에요.');
    };
  }

  /* ---------- 2. 대응점끼리 잇기 ---------- */
  // 대칭축 오른쪽 꼭짓점만 적고, 왼쪽은 거울처럼 만든다. top: 축 위의 꼭짓점 y
  const FIGS = [
    { top: -160, right: [[110, -40], [45, -40], [45, 150]] },
    { top: -160, right: [[130, -60], [80, -60], [80, 150]] },
    { top: -130, right: [[60, -30], [130, -110], [110, 120]] },
    { right: [[50, -40], [140, -130], [140, 130], [50, 40]] },
    { top: -150, right: [[110, -80], [150, 30], [60, 150]] },
    { right: [[60, -140], [140, 0], [60, 140]] },
  ];
  const LETTERS = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊ';
  let figOrder = [];
  function buildPairs() {
    if (!figOrder.length) figOrder = shuffle(FIGS);
    const fig = figOrder.pop();
    const rot = [0, 90, 30, -30][Math.floor(Math.random() * 4)] * Math.PI / 180;
    const cs = Math.cos(rot), sn = Math.sin(rot), CX = 280, CY = 210;
    const tf = ([x, y]) => [CX + x * cs - y * sn, CY + x * sn + y * cs];
    reset(560, 420);
    S.hitR = 26;
    $('quizAsk').textContent = '대칭축(빨간 점선)을 기준으로 서로 대응하는 점끼리 선으로 이으세요.';
    const outline = [];
    if (fig.top !== undefined) outline.push({ p: [0, fig.top], pair: null });
    fig.right.forEach((p, i) => outline.push({ p, pair: i }));
    fig.right.slice().reverse().forEach((p, i) => outline.push({ p: [-p[0], p[1]], pair: fig.right.length - 1 - i }));
    const pts = outline.map((o) => tf(o.p));
    el('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: FILL, stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }, S.back);
    const a0 = tf([0, -200]), a1 = tf([0, 200]);
    el('line', { x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1], stroke: BAD, 'stroke-width': 2.5, 'stroke-dasharray': '10 7' }, S.back);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    outline.forEach((o, i) => {
      const [x, y] = pts[i];
      const len = Math.hypot(x - cx, y - cy) || 1;
      text(LETTERS[i], x + (x - cx) / len * 24, y + (y - cy) / len * 24, 18, S.back, { weight: 800 });
      if (o.pair !== null) addNode('P' + i, x, y).pair = o.pair;
    });
    let left = fig.right.length;
    S.onLink = (a, b) => {
      if (a.pair !== b.pair) { wrong(a, b, '대응점이 아니에요.'); return; }
      drawLine(a, b, OK);
      for (const n of [a, b]) { n.locked = true; n.c.setAttribute('fill', OK); }
      if (--left === 0) finish('대응점을 이은 선분은 대칭축과 수직으로 만나고, 대칭축이 그 선분을 똑같이 둘로 나눠요.');
    };
  }

  /* ---------- 3. 점을 이어 선대칭도형 완성하기 ---------- */
  const HALVES = [
    [[4, 0], [2, 2], [1, 2], [1, 5], [3, 8], [4, 8]],
    [[4, 1], [1, 3], [3, 4], [0, 7], [4, 7]],
    [[4, 0], [3, 2], [0, 3], [2, 5], [1, 8], [4, 6]],
    [[4, 2], [2, 0], [0, 2], [0, 4], [4, 8]],
    [[4, 1], [3, 1], [3, 3], [1, 3], [1, 5], [3, 5], [3, 8], [4, 8]],
    [[4, 0], [1, 4], [3, 4], [3, 8], [4, 8]],
  ];
  let halfOrder = [];
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function primKeys(a, b) {
    // 한 번에 그은 긴 선과 나눠 그은 선을 같게 보도록 격자 한 칸 단위로 쪼갠다
    const dx = b[0] - a[0], dy = b[1] - a[1], g = gcd(Math.abs(dx), Math.abs(dy)) || 1, out = [];
    for (let i = 0; i < g; i++) {
      const p = [a[0] + dx / g * i, a[1] + dy / g * i], q = [a[0] + dx / g * (i + 1), a[1] + dy / g * (i + 1)];
      out.push(p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? `${p}|${q}` : `${q}|${p}`);
    }
    return out;
  }
  function buildComplete() {
    if (!halfOrder.length) halfOrder = shuffle(HALVES);
    const half = halfOrder.pop();
    const flip = Math.random() < 0.5;      // 가로 대칭축 문제
    const map = flip ? ([c, r]) => [r, c] : (p) => p;
    const STEP = 40, OX = 40, OY = 26;
    const toXY = ([c, r]) => ({ x: OX + c * STEP, y: OY + r * STEP });
    reset(400, 372);
    S.hitR = 19; S.chain = true;
    $('quizAsk').textContent = `점을 차례로 이어 대칭축 ${flip ? '아래쪽' : '오른쪽'}을 그려 선대칭도형을 완성하세요. 대칭축 위의 점에서 시작하면 편해요.`;
    const a0 = toXY(map([4, -0.4])), a1 = toXY(map([4, 8.4]));
    el('line', { x1: a0.x, y1: a0.y, x2: a1.x, y2: a1.y, stroke: BAD, 'stroke-width': 2.5, 'stroke-dasharray': '10 7' }, S.back);
    const givenPts = half.map(map).map(toXY);
    for (let i = 0; i + 1 < givenPts.length; i++) el('line', { x1: givenPts[i].x, y1: givenPts[i].y, x2: givenPts[i + 1].x, y2: givenPts[i + 1].y, stroke: INK, 'stroke-width': 4.5, 'stroke-linecap': 'round' }, S.back);
    for (let c = 0; c <= 8; c++) for (let r = 0; r <= 8; r++) {
      const { x, y } = toXY([c, r]);
      addNode(`${c},${r}`, x, y, 4.5).grid = [c, r];
    }
    const target = new Set();
    for (let i = 0; i + 1 < half.length; i++) {
      const a = map([8 - half[i][0], half[i][1]]), b = map([8 - half[i + 1][0], half[i + 1][1]]);
      primKeys(a, b).forEach((k) => target.add(k));
    }
    const drawn = [];
    S.onLink = (a, b) => {
      drawn.push({ a, b, line: drawLine(a, b, BLUE) });
      const cur = new Set();
      drawn.forEach((d) => primKeys(d.a.grid, d.b.grid).forEach((k) => cur.add(k)));
      if (cur.size === target.size && [...target].every((k) => cur.has(k))) {
        drawn.forEach((d) => d.line.setAttribute('stroke', OK));
        finish('대칭축으로 접으면 양쪽이 완전히 겹쳐요.');
      }
    };
    S.undo = () => {
      const d = drawn.pop();
      if (!d) { select(null); return; }
      d.line.remove();
      select(d.a);
    };
    $('quizUndo').hidden = false;
  }

  /* ---------- 문제 열기 ---------- */
  const KINDS = { axis: buildAxis, pairs: buildPairs, complete: buildComplete };
  let queue = [];
  function open(callbacks) {
    if (!svg) bind();
    cb = callbacks;
    if (!queue.length) queue = shuffle(Object.keys(KINDS));
    $('quizUndo').hidden = true;
    $('quizLater').hidden = false;
    $('quizStatus').textContent = '';
    KINDS[queue.pop()]();
    $('quiz').classList.add('show');
  }
  function cancel() {
    if (!S || S.done) return;
    S = null;
    $('quiz').classList.remove('show');
    cb.onCancel();
  }

  return { open, cancel };
})();
