/* 词刻 · 记忆曲线背单词 — 应用逻辑 v2.0（阶段二：词典/关系词/日历/错词本） */
'use strict';

/* ================= 工具 ================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const todayStr = () => fmtDate(new Date());
const addDays = (dateStr, days) => { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + days); return fmtDate(d); };
const uid = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2400);
}

/* ================= 设置 ================= */
const SET_KEY = 'cike_settings_v2';
const DEFAULT_PROXY = 'https://ezza9b0gam33p.cfc-execute.bj.baidubce.com/';
const DEFAULT_SETTINGS = {
  dailyNew: 30, voice: 'gb', ocrEngine: 'baidu',
  baiduApiKey: '', baiduSecret: '', baiduToken: '', baiduTokenAt: 0, baiduProxy: DEFAULT_PROXY,
  onlineEnrich: true
};
function getSettings() {
  try {
    let s = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
    // 迁移旧版设置（阶段一键名 cike_settings），首次升级后自动合并
    if (!Object.keys(s).length) {
      const old = JSON.parse(localStorage.getItem('cike_settings') || '{}');
      if (Object.keys(old).length) { s = Object.assign({}, old); saveSettings(s); }
    }
    const merged = Object.assign({}, DEFAULT_SETTINGS, s);
    // 代理地址兜底：空值或非 https 的无效地址（如误填的短链）一律回退为内置默认
    if (!merged.baiduProxy || !/^https:\/\//i.test(merged.baiduProxy)) merged.baiduProxy = DEFAULT_PROXY;
    return merged;
  }
  catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettings(s) { localStorage.setItem(SET_KEY, JSON.stringify(s)); }

/* 搜索历史 */
const HIST_KEY = 'cike_search_hist';
function getHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
function addHist(q) {
  const s = (q || '').trim(); if (!s) return;
  let h = getHist().filter((x) => x !== s);
  h.unshift(s); if (h.length > 10) h = h.slice(0, 10);
  localStorage.setItem(HIST_KEY, JSON.stringify(h));
}

/* ================= 数据层（IndexedDB） ================= */
const DB_NAME = 'cike_db', STORE = 'cards', META_STORE = 'meta', DB_VER = 2;
let _db = null;
function openDB() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'k' });
    };
    rq.onsuccess = (e) => { _db = e.target.result; res(_db); };
    rq.onerror = () => rej(rq.error || new Error('IndexedDB 打开失败'));
  });
}
function dbGetAll() {
  return openDB().then((db) => new Promise((res, rej) => {
    const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error);
  }));
}
function dbPut(cards) {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite'); const st = t.objectStore(STORE);
    (Array.isArray(cards) ? cards : [cards]).forEach((c) => st.put(c));
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}
function dbDel(id) {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(id);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}
function dbClear() {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear();
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}
function metaGet(k) {
  return openDB().then((db) => new Promise((res, rej) => {
    const rq = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(k);
    rq.onsuccess = () => res(rq.result ? rq.result.v : undefined); rq.onerror = () => rej(rq.error);
  }));
}
function metaPut(k, v) {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(META_STORE, 'readwrite'); t.objectStore(META_STORE).put({ k, v });
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}

/* ================= SM-2 记忆曲线算法 ================= */
const SM2 = {
  newReview() { return { repetitions: 0, intervalDays: 1, easeFactor: 2.5, dueDate: todayStr(), lapses: 0, lastQuality: null, history: [] }; },
  grade(review, q, date) {
    const r = Object.assign({}, review, { history: (review.history || []).concat([{ date, q }]), lastQuality: q });
    if (q >= 3) {
      r.repetitions += 1;
      r.easeFactor = Math.max(1.3, r.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      if (r.repetitions === 1) r.intervalDays = 1;
      else if (r.repetitions === 2) r.intervalDays = 6;
      else r.intervalDays = Math.max(r.intervalDays + 1, Math.round(r.intervalDays * r.easeFactor));
    } else {
      r.lapses += 1; r.repetitions = 0; r.intervalDays = 1;
    }
    r.dueDate = addDays(date, r.intervalDays);
    return r;
  }
};

/* ================= 发音（英音优先） ================= */
function speak(word) {
  if (!('speechSynthesis' in window)) return;
  const s = getSettings();
  const lang = s.voice === 'us' ? 'en-US' : 'en-GB';
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  u.rate = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const target = lang.toLowerCase().replace(/_/g, '-');
  const pick = voices.find((v) => v.lang.toLowerCase().replace(/_/g, '-').indexOf(target) === 0)
    || voices.find((v) => v.lang.toLowerCase().startsWith('en'));
  if (pick) u.voice = pick;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) { window.speechSynthesis.onvoiceschanged = () => {}; }

/* ================= 内置词典数据包 ================= */
let DICT = null; // { word: { uk, us, pos, defs:[..], tags } }
let REL = null;  // { word: { syn:[..], ant:[..] } }
let dictLoading = null;
function loadDict() {
  if (DICT) return Promise.resolve(true);
  if (dictLoading) return dictLoading;
  dictLoading = (async () => {
    const DICT_CACHE_KEY = 'dict_v3', REL_CACHE_KEY = 'rel_v3';
    try {
      DICT = await metaGet(DICT_CACHE_KEY);
      REL = await metaGet(REL_CACHE_KEY);
    } catch (e) { DICT = null; REL = null; }
    if (DICT) return true;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'dict.js?v=4';
      s.onload = () => {
        if (window.CIKE_DICT) { DICT = window.CIKE_DICT; REL = window.CIKE_REL || {}; res(); }
        else rej(new Error('dict.js 缺少数据'));
      };
      s.onerror = () => rej(new Error('内置词典文件 dict.js 不存在'));
      document.head.appendChild(s);
    });
    try {
      if (DICT) await metaPut(DICT_CACHE_KEY, DICT);
      if (REL) await metaPut(REL_CACHE_KEY, REL);
    } catch (e) { /* 缓存失败不影响使用 */ }
    return true;
  })().catch((e) => { dictLoading = null; toast('内置词典加载失败：' + e.message); return false; });
  return dictLoading;
}
function dictLookup(word) {
  if (!DICT) return null;
  return DICT[String(word || '').toLowerCase()] || null;
}
function dictSize() { return DICT ? Object.keys(DICT).length : 0; }
/* 在线补全（Datamuse 近反义词，可选） */
async function onlineRelations(word) {
  const s = getSettings();
  if (!s.onlineEnrich) return null;
  try {
    const [syn, ant] = await Promise.all([
      fetch('https://api.datamuse.com/words?rel_syn=' + encodeURIComponent(word) + '&max=5').then((r) => r.json()).catch(() => []),
      fetch('https://api.datamuse.com/words?rel_ant=' + encodeURIComponent(word) + '&max=5').then((r) => r.json()).catch(() => [])
    ]);
    if (!Array.isArray(syn) && !Array.isArray(ant)) return null;
    return { syn: (syn || []).map((x) => x.word).filter((w) => w && /^[a-z]+$/.test(w)), ant: (ant || []).map((x) => x.word).filter((w) => w && /^[a-z]+$/.test(w)) };
  } catch (e) { return null; }
}

/* ================= 词典补全 ================= */
function enrichWithDict(card) {
  const e = dictLookup(card.word);
  if (!e) return;
  if (e.uk && !card.phoneticUK) card.phoneticUK = e.uk;
  if (e.us && !card.phoneticUS) card.phoneticUS = e.us;
  const dictDefs = (e.defs || []).map((d) => ({ pos: e.pos || '', def: d }));
  const userDefs = card.meanings || [];
  if (userDefs.length) {
    const seen = new Set(userDefs.map((m) => m.def.trim()));
    for (const d of dictDefs) if (!seen.has(d.def.trim())) userDefs.push(d);
  } else {
    card.meanings = dictDefs;
  }
}

/* ================= 搜索 ================= */
function searchCards(cards, q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return [];
  const isEn = /^[a-z][a-z' -]*$/.test(s);
  const ranked = cards.map((c) => {
    const w = c.word.toLowerCase();
    const meaning = (c.meanings || []).map((m) => m.def).join(' ').toLowerCase();
    let r = 99;
    if (w === s) r = 0;
    else if (w.startsWith(s)) r = 1;
    else if (w.includes(s)) r = 2;
    else if (meaning.includes(s)) r = 3;
    else if (isEn && s.length >= 4 && levenshtein(w, s) <= 2) r = 4;
    return { c, r };
  }).filter((x) => x.r < 99).sort((a, b) => a.r - b.r || a.c.word.localeCompare(b.c.word));
  return ranked.map((x) => x.c);
}
/* 内置词典搜索（词库外的词） */
function searchDict(q) {
  if (!DICT) return [];
  const s = (q || '').trim().toLowerCase();
  if (!s || s.length < 2) return [];
  const isEn = /^[a-z][a-z' -]*$/.test(s);
  const out = [];
  const keys = Object.keys(DICT);
  for (let i = 0; i < keys.length && out.length < 6; i++) {
    const k = keys[i];
    if (k === s) { out.unshift(k); continue; }
    if (isEn) {
      if (k.startsWith(s) || k.includes(s)) out.push(k);
    } else {
      const e = DICT[k];
      if (e && (e.defs || []).some((d) => d.includes(s))) out.push(k);
    }
  }
  return out.slice(0, 6);
}

/* ================= OCR ================= */
function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('图片读取失败')); fr.readAsDataURL(file);
  });
}
async function baiduToken() {
  const s = getSettings();
  if (!s.baiduApiKey || !s.baiduSecret) throw new Error('请先在「设置」里填写百度 OCR 的 API Key 和 Secret Key');
  const DAY = 24 * 3600 * 1000;
  if (s.baiduToken && s.baiduTokenAt && Date.now() - s.baiduTokenAt < 25 * DAY) return s.baiduToken;
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id='
    + encodeURIComponent(s.baiduApiKey) + '&client_secret=' + encodeURIComponent(s.baiduSecret);
  const res = await fetch(url);
  const j = await res.json();
  if (j.error || !j.access_token) throw new Error('获取百度 token 失败：' + (j.error_description || j.error || '未知错误'));
  const ns = getSettings(); ns.baiduToken = j.access_token; ns.baiduTokenAt = Date.now(); saveSettings(ns);
  return j.access_token;
}
async function baiduOcr(dataUrl) {
  const s = getSettings();
  const base64 = dataUrl.split(',')[1];
  if (s.baiduProxy) {
    try {
      const res = await fetch(s.baiduProxy, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const j = await res.json();
      if (j.error_code) throw new Error('OCR 识别失败：' + (j.error_msg || j.error_code));
      return (j.words_result || []).map((x) => x.words);
    } catch (e) {
      if (e && e.message && e.message.indexOf('OCR 识别失败') === 0) throw e;
      throw new Error('无法连接 OCR 代理（' + (e.message || '网络错误') + '）。请检查设置页「转发代理地址」已正确填写、手机可联网；或用直连模式填 API Key。');
    }
  }
  let token;
  try { token = await baiduToken(); }
  catch (e) {
    if (e && e.message && e.message.indexOf('请先在') === 0) throw e;
    throw new Error('获取百度 token 失败（' + (e.message || '网络或跨域限制') + '）。手机端请改用「转发代理地址」方式（设置页）。');
  }
  const body = 'image=' + encodeURIComponent(base64);
  const res = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=' + encodeURIComponent(token), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const j = await res.json();
  if (j.error_code) throw new Error('OCR 识别失败：' + (j.error_msg || j.error_code));
  return (j.words_result || []).map((x) => x.words);
}
async function localOcr() {
  throw new Error('本地识别组件未安装：请先在设置中下载 Tesseract 离线组件（或改用云端 OCR）');
}
async function runOcrEngine(dataUrl) {
  const s = getSettings();
  if (s.ocrEngine === 'local') return localOcr(dataUrl);
  return baiduOcr(dataUrl);
}
function parseLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = (raw || '').trim();
    if (!line) continue;
    const t = line.replace(/^[\s\d.、．:：\-–—*•●▪▫◦①-⑩⑴-⑽]+/, '');
    const m = t.match(/^([A-Za-z][A-Za-z'\-]*)\s*[:\-：]?\s*(.*)$/);
    if (!m) continue;
    const word = m[1].toLowerCase();
    const meaning = m[2].trim();
    if (word.length > 24) continue;
    if (/^[A-Z]{4,}$/.test(m[1])) continue;
    out.push({ word, meaning });
  }
  return out;
}

/* ================= 词条构造 ================= */
function newCard(word, meaning, source) {
  const c = {
    id: uid(), word, phoneticUK: '', phoneticUS: '',
    meanings: meaning ? [{ pos: '', def: meaning }] : [],
    relations: { synonyms: [], antonyms: [], similar: [] },
    source: source || { type: 'manual' },
    createdAt: new Date().toISOString(),
    review: SM2.newReview()
  };
  enrichWithDict(c);
  return c;
}
function meaningText(c) {
  const defs = (c.meanings || []).map((m) => (m.pos ? m.pos + ' ' : '') + m.def).filter(Boolean);
  return defs.length ? defs.join('；') : '（待补释义）';
}
function sourceText(c) {
  const s = c.source || {};
  if (s.type === 'image') return '图片导入';
  if (s.type === 'relation') return '关系词扩展（' + (s.baseWord || '') + '）';
  return '手动添加';
}
function hasPendingMeaning(c) { return !(c.meanings || []).length; }

/* ================= 关系词引擎 ================= */
function relationCandidates(word) {
  const w = word.toLowerCase();
  const out = { syn: [], ant: [], sim: [] };
  if (REL && REL[w]) {
    out.syn = (REL[w].syn || []).filter((x) => x && x !== w).slice(0, 5);
    out.ant = (REL[w].ant || []).filter((x) => x && x !== w).slice(0, 5);
  }
  if (DICT) {
    const cands = [];
    for (const k in DICT) {
      if (k === w) continue;
      if (Math.abs(k.length - w.length) > 1) continue;
      if (levenshtein(k, w) <= 2) cands.push(k);
    }
    cands.sort((a, b) => levenshtein(a, w) - levenshtein(b, w));
    out.sim = cands.slice(0, 5);
  }
  return out;
}
async function addRelationWords(baseWord, kind, words) {
  await loadDict();
  const cards = await dbGetAll();
  const byWord = new Map(cards.map((c) => [c.word, c]));
  let added = 0, dup = 0, pending = 0;
  const toPut = [];
  for (const raw of words) {
    const w = String(raw || '').trim().toLowerCase();
    if (!w || /^[a-z]{1}$/.test(w) || w.length > 24) continue;
    if (byWord.has(w)) { dup++; continue; }
    const c = newCard(w, '', { type: 'relation', baseWord: baseWord.toLowerCase(), kind });
    if (hasPendingMeaning(c)) pending++;
    toPut.push(c); byWord.set(w, true); added++;
  }
  if (toPut.length) await dbPut(toPut);
  return { added, dup, pending };
}

/* ================= 复习队列 ================= */
function buildQueue(cards, settings, opts) {
  const today = todayStr();
  opts = opts || {};
  let pool = cards;
  if (opts.onlyWrong) pool = cards.filter((c) => c.review.lapses > 0);
  else if (opts.onlyHard) pool = cards.filter((c) => c.review.lapses >= 2);
  const due = pool.filter((c) => c.review.repetitions > 0 && c.review.dueDate <= today);
  const news = pool.filter((c) => c.review.repetitions === 0);
  return shuffle(due).concat(shuffle(news).slice(0, opts.onlyWrong || opts.onlyHard ? 1000 : Math.max(0, settings.dailyNew)));
}

/* ================= 错词本 ================= */
function wrongCards(cards) { return cards.filter((c) => c.review.lapses > 0); }
function hardCards(cards) { return cards.filter((c) => c.review.lapses >= 2); }

/* ================= 打卡日历 ================= */
function doneDateSet(cards) {
  const set = new Set();
  cards.forEach((c) => (c.review.history || []).forEach((h) => set.add(h.date)));
  return set;
}
function calcStreak(cards) {
  const set = doneDateSet(cards);
  let streak = 0; const d = new Date();
  for (;;) {
    if (set.has(fmtDate(d))) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
function renderCalendarHtml(cards) {
  const set = doneDateSet(cards);
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // 周一起始
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  let html = '<div class="cal-head">' + y + ' 年 ' + (m + 1) + ' 月</div><div class="cal-grid">';
  html += ['一', '二', '三', '四', '五', '六', '日'].map((d) => '<span class="cal-dow">' + d + '</span>').join('');
  for (let i = 0; i < startDow; i++) html += '<span class="cal-empty"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const on = set.has(ds);
    html += '<span class="cal-day' + (on ? ' on' : '') + (ds === today ? ' today' : '') + '" title="' + ds + '">' + d + '</span>';
  }
  html += '</div>';
  return html;
}

/* ================= 视图渲染 ================= */
const views = ['today', 'import', 'library', 'review', 'stats', 'settings'];
function router() {
  const h = (location.hash.replace(/^#\/?/, '') || 'today');
  const name = views.indexOf(h) >= 0 ? h : 'today';
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === name));
  if (name === 'today') renderToday();
  if (name === 'library') renderLibrary();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

/* --- 今日 --- */
async function renderToday() {
  const cards = await dbGetAll();
  const today = todayStr();
  const due = cards.filter((c) => c.review.repetitions > 0 && c.review.dueDate <= today).length;
  const news = cards.filter((c) => c.review.repetitions === 0).length;
  const done = cards.filter((c) => (c.review.history || []).some((h) => h.date === today)).length;
  $('#today-num').textContent = due + Math.min(news, getSettings().dailyNew);
  $('#today-ring').style.setProperty('--p', cards.length ? Math.min(100, Math.round(((due + Math.min(news, getSettings().dailyNew)) / (due + news || 1)) * 100)) : 0);
  $('#today-sub').textContent = '到期 ' + due + ' 个 · 可学新词 ' + news + ' 个';
  $('#s-total').textContent = cards.length;
  $('#s-done').textContent = done;
  $('#s-new').textContent = news;
}

/* --- 导入 --- */
let pendingRows = []; // {word, meaning, checked}
function switchImportMode(mode) {
  const img = mode === 'img';
  $('#imp-panel-img').style.display = img ? '' : 'none';
  $('#imp-panel-manual').style.display = img ? 'none' : '';
  $('#imp-mode-img').classList.toggle('on', img);
  $('#imp-mode-manual').classList.toggle('on', !img);
}
function renderPendingRows() {
  const ul = $('#imp-result');
  ul.innerHTML = pendingRows.map((r, i) =>
    '<li class="correct-row"><input type="checkbox" data-i="' + i + '" ' + (r.checked ? 'checked' : '') + '>'
    + '<input type="text" class="cw" data-f="word" data-i="' + i + '" value="' + esc(r.word) + '">'
    + '<input type="text" class="cm" data-f="meaning" data-i="' + i + '" value="' + esc(r.meaning) + '" placeholder="释义">'
    + (r.meaning ? '' : '<span class="badge">' + (r.missing ? '词典未收录（可检查拼写）' : '待补释义') + '</span>')
    + '</li>').join('');
}
async function runOcrFiles(files) {
  if (!files || !files.length) return;
  const preview = $('#imp-preview');
  // 预加载内置词典（与 OCR 并行，互不阻塞；加载失败不阻断识别）
  const dictP = loadDict();
  const merged = new Map(); // word -> {word, meaning}
  let failCount = 0, lastError = '';
  for (let i = 0; i < files.length; i++) {
    try {
      const dataUrl = await readFileAsDataURL(files[i]);
      if (i === 0) { preview.src = dataUrl; preview.classList.add('show'); }
      toast('正在识别第 ' + (i + 1) + '/' + files.length + ' 张…', 1500);
      const lines = await runOcrEngine(dataUrl);
      for (const p of parseLines(lines)) {
        const w = p.word.toLowerCase();
        // 释义需含中文才保留（音标/乱码/纯英文视为无释义，交给词典补全）
        const meaning = /[\u4e00-\u9fa5]/.test(p.meaning) ? p.meaning : '';
        const hit = merged.get(w);
        if (!hit) merged.set(w, { word: w, meaning: meaning, checked: true });
        else if (!hit.meaning && meaning) hit.meaning = meaning;
      }
    } catch (e) {
      failCount++; lastError = e && e.message ? e.message : '识别失败';
    }
  }
  // 词典自动补释义：OCR 没识别出中文释义的词条，用内置词典填充
  const dictOk = await dictP;
  if (dictOk) {
    for (const r of merged.values()) {
      if (!r.meaning) {
        const e = dictLookup(r.word);
        if (e && e.defs && e.defs.length) r.meaning = e.defs[0];
        else r.missing = true; // 词典未收录（可能是识别截断/生僻词）
      }
    }
  }
  pendingRows = Array.from(merged.values());
  if (!pendingRows.length) { toast(lastError || '未识别到有效单词，请检查图片排版'); return; }
  $('#imp-result-card').style.display = '';
  renderPendingRows();
  let summary = '识别到 ' + pendingRows.length + ' 条，请校对后入库';
  if (dictOk) summary += '（空释义已用内置词典自动补全，可修改）';
  if (failCount) summary += '；' + failCount + ' 张图识别失败';
  $('#imp-summary').textContent = summary;
}
async function importChecked() {
  await loadDict();
  const cards = await dbGetAll();
  const byWord = new Map(cards.map((c) => [c.word, c]));
  let added = 0, dup = 0, updated = 0;
  const toPut = [];
  pendingRows.forEach((r) => {
    if (!r.checked) return;
    const w = r.word.trim().toLowerCase();
    if (!w) return;
    const exist = byWord.get(w);
    if (exist) {
      dup++;
      if (!(exist.meanings || []).length && r.meaning.trim()) {
        exist.meanings = [{ pos: '', def: r.meaning.trim() }]; toPut.push(exist); updated++;
      }
      return;
    }
    toPut.push(newCard(w, r.meaning.trim(), { type: 'image' }));
    byWord.set(w, true); added++;
  });
  if (toPut.length) await dbPut(toPut);
  pendingRows = []; renderPendingRows(); $('#imp-result-card').style.display = 'none';
  $('#imp-summary').textContent = '';
  toast('入库 ' + added + ' 个，跳过重复 ' + dup + ' 个' + (updated ? '，补全释义 ' + updated + ' 个' : ''));
}
async function addManual() {
  await loadDict();
  const w = $('#m-word').value.trim().toLowerCase();
  const meaning = $('#m-meaning').value.trim();
  if (!w) { toast('请填写单词'); return; }
  if (!/^[a-z][a-z' -]*$/.test(w)) { toast('单词格式不正确'); return; }
  const cards = await dbGetAll();
  if (cards.some((c) => c.word === w)) { toast('「' + w + '」已在词库中'); return; }
  const c = newCard(w, meaning, { type: 'manual' });
  await dbPut(c);
  $('#m-word').value = ''; $('#m-meaning').value = '';
  const e = dictLookup(w);
  toast('已加入词库：「' + w + '」' + (c.meanings.length ? '（自动补全音标与释义）' : '（释义待补，可稍后在详情页填写）'));
}
/* 词表粘贴导入 */
function parseListText(text) {
  return parseLines(String(text || '').split(/\r?\n/));
}
async function importListText() {
  await loadDict();
  const text = $('#list-text').value;
  const rows = parseListText(text);
  if (!rows.length) { toast('未解析到有效单词（每行一个单词，或「单词 释义」）'); return; }
  const cards = await dbGetAll();
  const byWord = new Map(cards.map((c) => [c.word, c]));
  let added = 0, dup = 0, pending = 0;
  const toPut = [];
  rows.forEach((r) => {
    if (byWord.has(r.word)) { dup++; return; }
    const c = newCard(r.word, r.meaning, { type: 'manual' });
    if (hasPendingMeaning(c)) pending++;
    toPut.push(c); byWord.set(r.word, true); added++;
  });
  if (toPut.length) await dbPut(toPut);
  $('#list-text').value = '';
  toast('词表入库 ' + added + ' 个，跳过重复 ' + dup + ' 个' + (pending ? '，待补释义 ' + pending + ' 个' : ''));
  renderLibrary();
}

/* --- 词库 --- */
async function renderLibrary() {
  await loadDict();
  const cards = await dbGetAll();
  const q = ($('#lib-search').value || '').trim();
  const filter = $('#lib-filter').value || 'all';
  const wrongOnly = filter === 'wrong';
  let pool = cards;
  if (filter === 'image') pool = cards.filter((c) => (c.source || {}).type === 'image');
  else if (filter === 'manual') pool = cards.filter((c) => (c.source || {}).type === 'manual');
  else if (filter === 'relation') pool = cards.filter((c) => (c.source || {}).type === 'relation');
  else if (wrongOnly) pool = wrongCards(cards);
  const list = q ? searchCards(pool, q) : pool.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('#lib-count').textContent = '共 ' + cards.length + ' 个单词' + (q ? '，命中 ' + list.length + ' 个' : (filter !== 'all' ? '，筛选 ' + list.length + ' 个' : ''));
  if (q) addHist(q);
  let html = list.length ? list.map((c) =>
    '<li class="list-item">'
    + '<span class="grow" style="cursor:pointer" data-act="detail" data-id="' + esc(c.id) + '">'
    + '<div class="w">' + esc(c.word)
    + (c.phoneticUK ? ' <span class="ph">' + esc(c.phoneticUK) + '</span>' : '')
    + (c.review.lapses >= 2 ? ' <span class="badge red">难词</span>' : (c.review.lapses > 0 ? ' <span class="badge amber">错词</span>' : ''))
    + '</div><div class="d">' + esc(meaningText(c)) + '</div></span>'
    + '<span class="meta">' + sourceText(c) + '</span>'
    + '<button class="btn gray small" data-act="speak" data-id="' + esc(c.id) + '">发音</button>'
    + '<button class="btn red small" data-act="del" data-id="' + esc(c.id) + '">删</button>'
    + '</li>').join('')
    : '<li class="list-item muted">' + (q ? '词库中没有匹配，可尝试在下方词典中一键加入' : (filter !== 'all' ? '该分类下暂无单词' : '词库还是空的，去「导入」加词吧')) + '</li>';
  /* 词典建议（词库外命中） */
  if (q) {
    const dictHits = searchDict(q).filter((k) => !cards.some((c) => c.word === k));
    if (dictHits.length) {
      html += '<li class="dict-hit"><div class="card-title">内置词典（可一键加入）</div>'
        + dictHits.map((k) => {
          const e = DICT && DICT[k] || {};
          return '<div class="dh-row"><div class="grow"><span class="w">' + esc(k) + '</span>'
            + (e.uk ? ' <span class="ph">' + esc(e.uk) + '</span>' : '')
            + '<div class="d">' + esc((e.defs || []).join('；').slice(0, 60) || '待补释义') + '</div></div>'
            + '<button class="btn green small" data-act="dict-add" data-w="' + esc(k) + '">加入</button></div>';
        }).join('') + '</li>';
    }
  }
  $('#lib-list').innerHTML = html;
}

/* --- 详情弹窗（含关系词） --- */
let detailCard = null;
function openDetail(card) {
  detailCard = card;
  const r = card.review || SM2.newReview();
  $('#modal-title').textContent = card.word;
  $('#modal-body').innerHTML =
    '<div style="text-align:center;margin-bottom:10px;">'
    + '<div style="font-size:26px;font-weight:700;color:#0b4d80;">' + esc(card.word) + '</div>'
    + '<div class="muted">' + (card.phoneticUK ? '英 ' + esc(card.phoneticUK) : '') + (card.phoneticUS ? '　美 ' + esc(card.phoneticUS) : '') + '</div>'
    + '<button class="btn ghost small" id="modal-speak">发音</button>'
    + '</div>'
    + '<div class="card-title">释义</div>'
    + '<div>' + esc(meaningText(card)) + '</div>'
    + (hasPendingMeaning(card) ? '<div class="muted mt">该词暂无释义，可在导入页手动补录</div>' : '')
    + '<div class="card-title">复习状态</div>'
    + '<div class="muted">连续答对 ' + r.repetitions + ' 次 · 间隔 ' + r.intervalDays + ' 天 · 难度系数 ' + r.easeFactor.toFixed(2) + '</div>'
    + '<div class="muted">下次复习：' + r.dueDate + '（遗忘 ' + r.lapses + ' 次）</div>'
    + '<div class="card-title">来源</div>'
    + '<div class="muted">' + sourceText(card) + ' · ' + (card.createdAt || '').slice(0, 10) + '</div>'
    + '<div class="card-title">关系词（近义 / 反义 / 形近，点击加入词库）</div>'
    + '<div id="rel-box"><div class="muted">正在检索…</div></div>'
    + '<div class="grade-row mt"><button class="btn gray small" id="modal-reset">重置复习进度</button>'
    + '<button class="btn red small" id="modal-del">删除</button></div>';
  $('#modal-mask').classList.add('show');
  $('#modal-speak').addEventListener('click', () => speak(card.word));
  $('#modal-reset').addEventListener('click', async () => {
    card.review = SM2.newReview(); await dbPut(card); toast('已重置为未学状态'); closeModal(); renderLibrary();
  });
  $('#modal-del').addEventListener('click', async () => {
    if (!confirm('确认删除「' + card.word + '」？')) return;
    await dbDel(card.id); toast('已删除'); closeModal(); renderLibrary();
  });
  renderRelations(card);
}
function renderRelations(card) {
  const box = $('#rel-box');
  if (!box) return;
  loadDict().then(() => {
  const local = relationCandidates(card.word);
  onlineRelations(card.word).then((online) => {
    const syn = local.syn.slice();
    const ant = local.ant.slice();
    if (online) {
      (online.syn || []).forEach((w) => { if (!syn.includes(w)) syn.push(w); });
      (online.ant || []).forEach((w) => { if (!ant.includes(w)) ant.push(w); });
    }
    dbGetAll().then((cards) => {
      const inLib = new Set(cards.map((c) => c.word));
      const kindHtml = (title, kind, words) => {
        if (!words.length) return '<div class="rel-kind"><b>' + title + '</b>：<span class="muted">暂无</span></div>';
        return '<div class="rel-kind"><b>' + title + '</b>：' + words.map((w) =>
          '<span class="chip' + (inLib.has(w) ? ' in' : '') + '" data-rel-kind="' + kind + '" data-rel-w="' + esc(w) + '" data-rel-base="' + esc(card.word) + '">'
          + esc(w) + (inLib.has(w) ? ' ✓' : ' +') + '</span>').join('') + '</div>';
      };
      box.innerHTML = kindHtml('近义词', 'synonym', syn)
        + kindHtml('反义词', 'antonym', ant)
        + kindHtml('形近词', 'similar', local.sim)
        + '<div class="muted" style="font-size:12px;margin-top:6px;">点「+」加入词库（自动去重、补释义）；形近词为本地编辑距离计算。在线补全可关（设置页）。</div>';
      $$('.chip:not(.in)', box).forEach((ch) => ch.addEventListener('click', async () => {
        const w = ch.dataset.relW, kind = ch.dataset.relKind, base = ch.dataset.relBase;
        const r = await addRelationWords(base, kind, [w]);
        toast(r.added ? '已加入：「' + w + '」' + (r.pending ? '（释义待补）' : '（已补释义）') : '已在词库中');
        renderRelations(detailCard);
        renderLibrary();
      }));
    });
  }).catch(() => {
    box.innerHTML = '<div class="muted">关系词检索失败</div>';
  });
  }).catch(() => { box.innerHTML = '<div class="muted">内置词典加载失败，无法检索关系词</div>'; });
}
function closeModal() { $('#modal-mask').classList.remove('show'); $('#modal-body').innerHTML = ''; detailCard = null; }

/* --- 复习 --- */
let session = null;
function startReview(opts) {
  session = null;
  $('#review-done').style.display = 'none';
  $('#review-stage').style.display = '';
  $('#review-done-title').textContent = '准备复习';
  dbGetAll().then((cards) => {
    const queue = buildQueue(cards, getSettings(), opts || {});
    if (!queue.length) {
      $('#review-stage').style.display = 'none';
      $('#review-done').style.display = '';
      $('#done-text').textContent = (opts && opts.onlyWrong) ? '错词本已清空，继续加油！' : '今日没有可复习的词，先去「导入」添加新词吧。';
      return;
    }
    session = { queue, idx: 0, mode: 'en2zh', done: 0, tag: (opts && opts.onlyWrong) ? '错词强化' : '' };
    $('#review-mode-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'en2zh'));
    renderCard();
  });
}
function currentCard() { return session && session.queue[session.idx]; }
function renderCard() {
  if (!session) return;
  if (session.idx >= session.queue.length) { finishReview(); return; }
  const c = currentCard(); const mode = session.mode;
  $('#review-progress').textContent = '第 ' + (session.idx + 1) + ' / ' + session.queue.length + ' 个 · 已复习 ' + session.done + (session.tag ? ' · ' + session.tag : '');
  $('#flip-inner').classList.remove('flipped');
  const front = $('#face-front'), back = $('#face-back');
  front.innerHTML = ''; back.innerHTML = '';
  const wordHtml = '<div class="w">' + esc(c.word) + '</div>' + (c.phoneticUK ? '<div class="muted" style="font-size:13px;">' + esc(c.phoneticUK) + '</div>' : '');
  const meaningHtml = '<div class="w" style="font-size:20px;">' + esc(meaningText(c)) + '</div><div class="d" style="font-size:14px;opacity:.8;">' + esc(c.word) + (c.phoneticUK ? ' · ' + esc(c.phoneticUK) : '') + '</div>';
  const speakBtn = '<button class="speak-btn" id="card-speak">发音</button>';
  if (mode === 'en2zh') {
    front.innerHTML = wordHtml + '<div class="hint">点击卡片翻面看释义</div>' + speakBtn;
    back.innerHTML = meaningHtml;
  } else if (mode === 'zh2en') {
    front.innerHTML = '<div class="w" style="font-size:20px;">' + esc(meaningText(c)) + '</div><div class="hint">点击卡片翻面看单词</div>';
    back.innerHTML = wordHtml + '<div class="d" style="font-size:14px;opacity:.8;">' + esc(meaningText(c)) + '</div>';
  } else {
    front.innerHTML = '<div class="w" style="font-size:24px;">听音拼写</div><div class="hint">点击下方播放键听发音，在输入框拼写</div>' + speakBtn + (c.phoneticUK ? '<div class="muted" style="font-size:13px;">' + esc(c.phoneticUK) + '</div>' : '');
    back.innerHTML = wordHtml + '<div class="d" style="font-size:14px;opacity:.8;">' + esc(meaningText(c)) + '</div>';
    $('#listen-box').style.display = '';
    $('#listen-input').value = '';
    $('#listen-answer').style.display = 'none';
    $('#grade-row').querySelectorAll('button').forEach((b) => b.disabled = true);
    $('#review-hint').style.display = 'none';
  }
  if (mode !== 'listen') {
    $('#listen-box').style.display = 'none';
    $('#grade-row').querySelectorAll('button').forEach((b) => b.disabled = false);
    $('#review-hint').style.display = session ? '' : 'none';
  }
  const sp = $('#card-speak'); if (sp) sp.addEventListener('click', (e) => { e.stopPropagation(); speak(c.word); });
}
function flipCard() { $('#flip-inner').classList.add('flipped'); $('#review-hint').style.display = 'none'; }
async function grade(q) {
  const c = currentCard(); if (!c) return;
  c.review = SM2.grade(c.review, q, todayStr());
  await dbPut(c);
  session.done++; session.idx++;
  renderCard();
}
function finishReview() {
  $('#review-stage').style.display = 'none';
  $('#review-done').style.display = '';
  $('#review-done-title').textContent = '完成！';
  $('#done-text').textContent = '本轮完成 ' + session.done + ' 个单词，明天按记忆曲线自动安排下次复习。';
  session = null;
}
function revealListen() {
  const c = currentCard(); if (!c) return;
  $('#flip-inner').classList.add('flipped');
  $('#listen-answer').style.display = '';
  $('#listen-answer').innerHTML = '<div class="w" style="font-size:20px;font-weight:700;color:#0b4d80;">' + esc(c.word) + '</div><div class="muted">' + esc(meaningText(c)) + '</div>';
  $('#grade-row').querySelectorAll('button').forEach((b) => b.disabled = false);
  $('#review-hint').style.display = 'none';
}

/* --- 统计 --- */
async function renderStats() {
  const cards = await dbGetAll();
  const today = todayStr();
  const total = cards.length;
  const done = cards.filter((c) => (c.review.history || []).some((h) => h.date === today)).length;
  const forget = total ? Math.round((wrongCards(cards).length / total) * 100) : 0;
  $('#st-total').textContent = total;
  $('#st-done').textContent = done;
  $('#st-forget').textContent = forget + '%';
  const nNew = cards.filter((c) => c.review.repetitions === 0).length;
  const nLearn = cards.filter((c) => c.review.repetitions >= 1 && c.review.repetitions <= 2).length;
  const nMast = cards.filter((c) => c.review.repetitions >= 3).length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  $('#bar-new').style.width = pct(nNew) + '%'; $('#val-new').textContent = nNew;
  $('#bar-learning').style.width = pct(nLearn) + '%'; $('#val-learning').textContent = nLearn;
  $('#bar-mastered').style.width = pct(nMast) + '%'; $('#val-mastered').textContent = nMast;
  const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const count = days.map((d) => cards.reduce((s, c) => s + (c.review.history || []).filter((h) => h.date === d).length, 0));
  const max = Math.max(1, ...count);
  $('#week-bars').innerHTML = days.map((d, i) =>
    '<div class="wb"><div class="col" style="height:' + Math.max(2, Math.round((count[i] / max) * 80)) + 'px;"></div>'
    + '<div class="dl">' + (count[i] || '') + '</div><div class="dl">' + d.slice(5) + '</div></div>').join('');
  /* 打卡日历 */
  $('#cal-box').innerHTML = renderCalendarHtml(cards);
  $('#cal-streak').textContent = '连续打卡 ' + calcStreak(cards) + ' 天';
  /* 错词本 */
  const wrong = wrongCards(cards), hard = hardCards(cards);
  $('#wrong-count').textContent = wrong.length;
  $('#wrong-list').innerHTML = wrong.length ? wrong.slice(0, 20).map((c) =>
    '<li class="list-item"><span class="grow" style="cursor:pointer" data-act="detail" data-id="' + esc(c.id) + '">'
    + '<div class="w">' + esc(c.word) + (hard.includes(c) ? ' <span class="badge red">难词</span>' : '') + '</div>'
    + '<div class="d">遗忘 ' + c.review.lapses + ' 次 · 下次 ' + c.review.dueDate + '</div></span>'
    + '<button class="btn gray small" data-act="speak" data-id="' + esc(c.id) + '">发音</button></li>').join('')
    : '<li class="list-item muted">暂无错词，继续保持！</li>';
}

/* --- 设置 --- */
function renderSettings() {
  const s = getSettings();
  $('#set-daily-new').value = String(s.dailyNew);
  $('#set-voice').value = s.voice;
  $('#set-ocr').value = s.ocrEngine;
  $('#set-baidu-key').value = s.baiduApiKey;
  $('#set-baidu-secret').value = s.baiduSecret;
  $('#set-baidu-proxy').value = s.baiduProxy || '';
  $('#set-online-enrich').value = s.onlineEnrich ? '1' : '0';
}
function saveOcr() {
  const s = getSettings();
  s.dailyNew = parseInt($('#set-daily-new').value, 10) || 30;
  s.voice = $('#set-voice').value;
  s.ocrEngine = $('#set-ocr').value;
  s.baiduApiKey = $('#set-baidu-key').value.trim();
  s.baiduSecret = $('#set-baidu-secret').value.trim();
  s.baiduProxy = $('#set-baidu-proxy').value.trim();
  s.onlineEnrich = $('#set-online-enrich').value === '1';
  saveSettings(s);
  toast('设置已保存');
}

/* --- 备份 --- */
async function exportData() {
  const cards = await dbGetAll();
  const data = { app: 'cike', version: 2, exportedAt: new Date().toISOString(), settings: getSettings(), cards };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '词刻-备份-' + todayStr().replace(/-/g, '') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('已导出 ' + cards.length + ' 个单词的备份');
}
async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.cards)) throw new Error('备份文件格式不正确');
    const byId = new Map(data.cards.map((c) => [c.id, c]));
    const mine = await dbGetAll();
    const merged = mine.map((c) => byId.get(c.id) || c).concat(data.cards.filter((c) => !mine.some((m) => m.id === c.id)));
    await dbPut(merged);
    if (data.settings) saveSettings(Object.assign({}, getSettings(), data.settings));
    toast('导入成功：合并 ' + data.cards.length + ' 个单词');
  } catch (e) {
    toast('导入失败：' + (e.message || '文件无法解析'));
  }
}

/* ================= 事件绑定 ================= */
/* 当前选中的待识别图片（支持多选） */
let currentFiles = [];
function bindFileInput(inputEl) {
  inputEl.addEventListener('change', (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    currentFiles = files;
    readFileAsDataURL(files[0]).then((dataUrl) => {
      const p = $('#imp-preview'); p.src = dataUrl; p.classList.add('show');
      if (files.length > 1) toast('已选 ' + files.length + ' 张图片，点击「开始识别」批量识别', 2000);
    }).catch(() => {});
  });
}
function bind() {
  window.addEventListener('hashchange', router);

  // 今日
  $('#btn-start-review').addEventListener('click', () => { location.hash = '#/review'; setTimeout(() => startReview(), 60); });
  $('#today-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { location.hash = '#/library'; setTimeout(() => { $('#lib-search').value = $('#today-search').value; renderLibrary(); }, 60); }
  });

  // 导入
  $('#imp-mode-img').addEventListener('click', () => switchImportMode('img'));
  $('#imp-mode-manual').addEventListener('click', () => switchImportMode('manual'));
  $('#btn-take-photo').addEventListener('click', () => $('#imp-file-cam').click());
  $('#btn-pick-album').addEventListener('click', () => $('#imp-file-album').click());
  bindFileInput($('#imp-file-cam'));
  bindFileInput($('#imp-file-album'));
  $('#btn-ocr').addEventListener('click', () => {
    if (!currentFiles.length) { toast('请先拍照或从相册选择单词图片'); return; }
    runOcrFiles(currentFiles).catch((e) => toast(e.message || '识别失败'));
  });
  $('#imp-result').addEventListener('change', (e) => {
    const el = e.target; const i = parseInt(el.dataset.i, 10);
    if (isNaN(i) || !pendingRows[i]) return;
    if (el.type === 'checkbox') pendingRows[i].checked = el.checked;
    else pendingRows[i][el.dataset.f] = el.value;
  });
  $('#btn-import-checked').addEventListener('click', importChecked);
  $('#btn-add-manual').addEventListener('click', addManual);
  $('#btn-list-import').addEventListener('click', importListText);

  // 词库
  $('#lib-search').addEventListener('input', renderLibrary);
  $('#lib-filter').addEventListener('change', renderLibrary);
  $('#lib-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'dict-add') {
      const w = btn.dataset.w;
      const cards = await dbGetAll();
      if (cards.some((c) => c.word === w)) { toast('「' + w + '」已在词库中'); return; }
      const c = newCard(w, '', { type: 'manual' });
      await dbPut(c);
      toast('已加入词库：「' + w + '」' + (c.meanings.length ? '（已补释义）' : '（释义待补）'));
      renderLibrary();
      return;
    }
    const cards = await dbGetAll();
    const c = cards.find((x) => x.id === id); if (!c) return;
    if (act === 'speak') speak(c.word);
    else if (act === 'del') {
      if (!confirm('确认删除「' + c.word + '」？')) return;
      await dbDel(id); toast('已删除'); renderLibrary();
    } else if (act === 'detail') openDetail(c);
  });

  // 统计页错词列表联动
  $('#wrong-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const cards = await dbGetAll();
    const c = cards.find((x) => x.id === btn.dataset.id); if (!c) return;
    if (btn.dataset.act === 'speak') speak(c.word);
    else openDetail(c);
  });

  // 错词强化复习
  $('#btn-wrong-review').addEventListener('click', () => { location.hash = '#/review'; setTimeout(() => startReview({ onlyWrong: true }), 60); });

  // 复习
  $('#review-mode-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (!session) { toast('先点「开始今日复习」'); return; }
    session.mode = b.dataset.mode;
    $$('button', $('#review-mode-seg')).forEach((x) => x.classList.toggle('on', x === b));
    renderCard();
  });
  $('#review-card').addEventListener('click', (e) => {
    if (e.target.closest('.speak-btn')) return;
    if (session && session.mode !== 'listen') flipCard();
  });
  $('#g-forget').addEventListener('click', () => session && grade(1));
  $('#g-fuzzy').addEventListener('click', () => session && grade(3));
  $('#g-know').addEventListener('click', () => session && grade(5));
  $('#btn-listen-play').addEventListener('click', () => { const c = currentCard(); if (c) { speak(c.word); $('#listen-input').focus(); } });
  $('#btn-listen-answer').addEventListener('click', revealListen);
  $('#listen-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') revealListen(); });
  $('#btn-review-start').addEventListener('click', () => { location.hash = '#/review'; setTimeout(startReview, 60); });
  $('#btn-review-home').addEventListener('click', () => { location.hash = '#/today'; });

  // 设置
  $('#btn-save-ocr').addEventListener('click', saveOcr);
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importData(f); e.target.value = ''; });
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('确认清空全部词库？此操作不可恢复（建议先导出备份）')) return;
    await dbClear(); toast('词库已清空');
    if (location.hash.indexOf('settings') >= 0) renderSettings();
    router();
  });

  // 弹窗
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') closeModal(); });
}

/* ================= 启动 ================= */
(async function init() {
  try { await openDB(); } catch (e) { toast('浏览器不支持 IndexedDB，请用系统浏览器（Chrome/Edge/Safari）打开'); }
  bind();
  router();
  loadDict();
  if ((location.protocol === 'https:' || location.hostname === 'localhost') && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
