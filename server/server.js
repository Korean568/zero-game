// Zero has disappeared 협동 멀티플레이 서버.
// 방 코드마다 세계 시드, 찾은 0 목록, 접속한 친구들을 기억하고 위치와 사건을 중계한다.
// Render 무료 웹 서비스에서 돌린다. 로컬 시험: node server.js (기본 포트 8787)
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0과 O는 헷갈려서 뺐다
const COLORS = ['#ff5d47', '#3d8bfd', '#2fbf71', '#b15cff', '#ff9f1c', '#ff4fa3', '#00b8c4', '#8a6d3b'];
const MAX_PLAYERS = 8, MAX_ITEMS = 1000, EMPTY_ROOM_MS = 10 * 60 * 1000;

const rooms = new Map();
let nextId = 1;

function newCode() {
  if (process.env.FIXED_ROOM && !rooms.has(process.env.FIXED_ROOM)) return process.env.FIXED_ROOM; // 시험용
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '') || '숫자1';
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 2);
const info = (p) => ({ id: p.id, name: p.name, color: p.color, d: p.d, f: p.f });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) {
  const data = JSON.stringify(obj);
  for (const p of room.players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(data);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(`ok rooms=${rooms.size}`);
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  let room = null, player = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      if (room) return;
      if (m.create) {
        const code = newCode();
        room = { code, seed: 1 + Math.floor(Math.random() * 2147483646), found: new Map(), players: new Map(), finale: false, emptySince: 0 };
        rooms.set(code, room);
      } else {
        room = rooms.get(String(m.room || '').toUpperCase());
        if (!room) { send(ws, { t: 'error', code: 'no-room' }); room = null; return; }
        if (room.finale) { send(ws, { t: 'error', code: 'ended' }); room = null; return; }
        if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', code: 'full' }); room = null; return; }
      }
      const used = new Set([...room.players.values()].map((p) => p.color));
      player = { id: nextId++, name: cleanName(m.name), color: COLORS.find((c) => !used.has(c)) || COLORS[0], ws, d: null, f: null, lastPos: 0 };
      send(ws, {
        t: 'welcome', you: player.id, room: room.code, seed: room.seed, finale: room.finale,
        found: [...room.found.entries()], players: [...room.players.values()].map(info), color: player.color,
      });
      room.players.set(player.id, player);
      room.emptySince = 0;
      broadcast(room, { t: 'join', p: info(player) }, ws);
      return;
    }
    if (!room || !player) return;

    if (m.t === 'pos') {
      const now = Date.now();
      if (now - player.lastPos < 50 || !vec3(m.d) || !vec3(m.f)) return;
      player.lastPos = now; player.d = m.d; player.f = m.f;
      broadcast(room, { t: 'pos', id: player.id, d: m.d, f: m.f, b: m.b ? 1 : 0, m: m.m ? 1 : 0 }, ws);
    } else if (m.t === 'found') {
      const id = m.id;
      if (!Number.isInteger(id) || id < 0 || id >= MAX_ITEMS) return;
      if (room.found.has(id)) { send(ws, { t: 'dup', id }); return; }
      room.found.set(id, player.name);
      broadcast(room, { t: 'found', id, by: player.id, name: player.name });
    } else if (m.t === 'finale') {
      if (room.finale) return;
      room.finale = true;
      broadcast(room, { t: 'finale', by: player.id, name: player.name });
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    room.players.delete(player.id);
    broadcast(room, { t: 'leave', id: player.id, name: player.name });
    if (!room.players.size) room.emptySince = Date.now();
  });
});

// 끊긴 연결 정리, 빈 방 지우기
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) if (!r.players.size && r.emptySince && now - r.emptySince > EMPTY_ROOM_MS) rooms.delete(code);
}, 25000);

server.listen(PORT, () => console.log(`zero server on :${PORT}`));
