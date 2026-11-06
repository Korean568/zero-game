// 스토리: 등장인물, 장별 대사, 대사 창.
window.Story = (function () {
  const $ = (id) => document.getElementById(id);
  const CAST = {
    one: { name: '일이', face: '1', color: '#ff5d47' },
    nine: { name: '구구 할아버지', face: '9', color: '#3d6bb3' },
    null: { name: '널', face: '∅', color: '#2a2140' },
    narr: { name: '', face: '', color: '' },
  };

  const PROLOGUE = [
    ['narr', '옛날 옛적, 숫자들은 서로 줄을 서서 큰 수를 만들며 살았다.'],
    ['narr', "어느 날 밤, 빈칸 괴물 '널'이 나타나 세상의 0을 모두 삼켜 버렸다."],
    ['nine', '0이 사라지니 10은 1이 되고, 100점짜리 시험지도 1점이 됐단다. 나는 9에서 더 올라갈 수가 없어.'],
    ['one', '그럼 제가 찾아올게요. 0이 있어야 저도 10이 될 수 있으니까요.'],
    ['nine', '0들은 일곱 대륙으로 흩어졌어. 지도의 빨간 원을 따라가 보렴. 0인 척하는 가짜들은 조심하고.'],
    ['one', '세로로 길쭉한 게 진짜 0! 다녀오겠습니다!'],
  ];
  const PROLOGUE_MP = ['nine', '친구 숫자들도 함께 간다니 든든하구나. 찾은 0은 모두의 것이 된단다.'];

  const CHAPTERS = {
    1: { title: '1장 · 0이 태어난 땅', lines: [
      ['nine', "여기가 0의 고향이야. 인도의 브라마굽타가 처음으로 0을 '수'로 대접했지."],
      ['one', '고향에 숨었다면 쉽게 나오진 않겠는데요.'],
    ] },
    2: { title: '2장 · 바다를 건넌 숫자', lines: [
      ['nine', '이탈리아 소년 피보나치는 북아프리카 항구에서 0을 처음 배웠단다.'],
      ['one', '0이 배를 타고 유럽까지 갔군요.'],
    ] },
    3: { title: '3장 · 금지된 숫자', lines: [
      ['nine', '여기선 한때 0을 못 쓰게 했어. 0 하나만 붙여도 장부의 금액이 바뀌니까.'],
      ['one', '그만큼 힘이 센 숫자라는 뜻이네요.'],
    ] },
    4: { title: '4장 · 조개껍데기 0', lines: [
      ['nine', '마야 사람들은 인도와 따로, 스스로 0을 만들었어. 조개껍데기 모양으로 그렸지.'],
      ['one', '0은 한 번만 발명된 게 아니었구나.'],
    ] },
    5: { title: '5장 · 매듭 사이의 빈칸', lines: [
      ['nine', '잉카 사람들은 끈에 매듭을 지어 수를 적었어. 매듭이 없는 자리가 바로 0이었단다.'],
      ['one', '아무것도 없는 자리에도 뜻이 있네요.'],
    ] },
    6: { title: '6장 · 나무 없는 평원', lines: [
      ['nine', "이 대륙엔 널라버라는 평원이 있어. 라틴어로 '나무가 없다'는 뜻이지."],
      ['one', '널? 0을 삼킨 괴물 이름이랑 똑같잖아요!'],
      ['nine', "그래. '없음'을 뜻하는 말은 세상 여기저기 숨어 있단다."],
    ] },
    7: { title: '7장 · 얼음의 0도', lines: [
      ['nine', '물이 어는 온도가 0도야. 0이 없으면 온도계도 기준을 잃지.'],
      ['one', '춥지만, 여기 0들도 꼭 데려갈게요.'],
    ] },
  };

  const FINALE = [
    ['narr', "세상의 원점, 위도 0도 경도 0도. 바다 위에 빈칸 괴물 '널'이 떠 있다."],
    ['null', '왜 0을 되찾으려 하지? 0은 아무것도 아니잖아. 없어져도 아무도 몰랐을 텐데.'],
    ['one', '아니요, 다들 알았어요. 0이 사라지자 10도 100도 무너졌는걸요.'],
    ['one', '0은 아무것도 없다는 뜻이지만, 그 빈자리가 있어야 수가 커질 수 있어요.'],
    ['null', '…그렇다면 마지막 0을 걸고 문제를 내지. 풀어 봐.'],
  ];
  const EPILOGUE = [
    ['null', '빈자리에도 쓸모가 있었구나. 그럼 나도… 누군가의 자리를 지켜 줄 수 있을까?'],
    ['nine', "물론이지. 0도 처음엔 '없음'이라며 무시당했지만, 이제 모든 큰 수를 떠받치잖니."],
    ['one', '보세요, 이제 저는 1이 아니라 10정이에요!'],
    ['narr', '그날 이후, 널은 세상의 원점에서 빈자리들을 지키는 파수꾼이 되었다고 한다.'],
  ];
  const EPILOGUE_MP = ['one', '혼자였으면 못 했을 거예요. 다 같이 찾은 덕분이에요!'];

  /* ---------- 대사 창 ---------- */
  let queue = [], done = null, isOpen = false;
  let format = (s) => s;

  function render([who, text]) {
    const c = CAST[who] || CAST.narr;
    const face = $('talkFace');
    face.textContent = c.face;
    face.style.background = c.color || 'transparent';
    $('talkWho').textContent = c.name;
    $('talkText').innerHTML = format(text);
    $('talk').classList.toggle('narr', who === 'narr');
  }
  function next() {
    if (!isOpen) return;
    if (!queue.length) {
      close();
      const cb = done; done = null;
      if (cb) cb();
      return;
    }
    render(queue.shift());
  }
  function play(lines, cb) {
    queue = lines.slice();
    done = cb || null;
    isOpen = true;
    $('talk').classList.add('show');
    next();
  }
  function close() {
    isOpen = false;
    queue = [];
    $('talk').classList.remove('show');
  }
  // 대사 중에는 넘기기 키를 게임보다 먼저 받아 간다
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) next();
    } else if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      queue = []; next();
    }
  }, true);
  document.addEventListener('DOMContentLoaded', () => $('talk').addEventListener('click', () => next()));
  if (document.readyState !== 'loading') $('talk').addEventListener('click', () => next());

  return {
    play, close,
    skip() { queue = []; next(); },
    get open() { return isOpen; },
    set format(fn) { format = fn; },
    prologue: (mp) => (mp ? [...PROLOGUE.slice(0, 5), PROLOGUE_MP, PROLOGUE[5]] : PROLOGUE),
    chapter: (id) => CHAPTERS[id],
    FINALE,
    epilogue: (mp) => (mp ? [...EPILOGUE.slice(0, 3), EPILOGUE_MP, EPILOGUE[3]] : EPILOGUE),
  };
})();
