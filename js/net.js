// 협동 멀티플레이 접속. 서버(server/server.js)는 방 코드, 찾은 0 목록, 친구 위치를 중계한다.
// 서버 주소를 바꾸려면 아래 SERVER를 고치거나, 시험할 때는 주소 뒤에 ?server=ws://localhost:8787 을 붙인다.
window.Net = (function () {
  const SERVER = 'wss://zero-game-server.onrender.com';
  const ERRORS = { 'no-room': '그런 방이 없어요. 코드를 다시 확인해 주세요.', full: '방이 꽉 찼어요(최대 8명).', ended: '이미 끝난 방이에요.' };

  let ws = null, me = null, room = null, connected = false;
  const handlers = {};
  const on = (t, fn) => { (handlers[t] || (handlers[t] = [])).push(fn); };
  const emit = (t, m) => (handlers[t] || []).forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });

  function serverUrl() {
    const q = new URLSearchParams(location.search).get('server');
    return q || window.ZERO_SERVER || SERVER;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 무료 서버는 한동안 안 쓰면 잠들어서, 깨어날 때까지 기다린다
  async function wake(url, status) {
    const http = url.replace(/^ws/, 'http').replace(/\/$/, '') + '/health';
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      try {
        const r = await fetch(http, { cache: 'no-store' });
        if (r.ok) return true;
      } catch (e) { /* 아직 잠들어 있음 */ }
      status(`서버 깨우는 중… ${Math.round((Date.now() - t0) / 1000)}초 (처음엔 1분쯤 걸릴 수 있어요)`);
      await sleep(3000);
    }
    return false;
  }

  async function connect(hello, status) {
    const url = serverUrl();
    status('서버에 연결하는 중…');
    if (!(await wake(url, status))) throw new Error('서버에 연결할 수 없어요. 혼자 하기로 시작해 주세요.');
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      const timer = setTimeout(() => { fail('서버 응답이 없어요.'); try { ws.close(); } catch (e) { /* 무시 */ } }, 15000);
      ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...hello }));
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!connected && m.t === 'welcome') {
          clearTimeout(timer);
          me = m.you; room = m.room; connected = true; settled = true;
          resolve(m);
          return;
        }
        if (!connected && m.t === 'error') { clearTimeout(timer); fail(ERRORS[m.code] || '접속하지 못했어요.'); return; }
        emit(m.t, m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (connected) { connected = false; emit('close', {}); }
        else fail('연결이 끊겼어요.');
      };
    });
  }

  function send(obj) {
    if (connected && ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  return { connect, send, on, get me() { return me; }, get room() { return room; }, get connected() { return connected; } };
})();
