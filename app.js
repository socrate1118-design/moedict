"use strict";
// 國語辭典查詢 — 離線 PWA。整合教育部四本辭典，一次搜尋、依詞目合併顯示。
// 辭典內容不做修改，僅調整顯示方式。

// 列欄位（見 tools/convert.py）：
//  rev  修訂本: 0名 1別名 2部首 3總筆畫 4部首外筆畫 5多音序 6注音 7變體類型 8變體注音 9拼音 10變體拼音 11相似詞 12相反詞 13釋義 14多音參見 15異體字
//  con  簡編本: 0名 1字詞號 2部首 3總筆畫 4部首外筆畫 5注音 6拼音 7變體類型 8變體注音 9變體拼音 10相似詞 11相反詞 12釋義 13多音參見
//  mini 小字典: 0字 1部首 2總筆畫 3部首外筆畫 4注音 5解釋
//  idi  成語典: 0編號 1成語 2注音 3拼音 4釋義 5典源名稱 6典源內容 7典源注解 8典源參考 9典故說明 10書證 11語義說明
//               12使用類別 13例句 14形音辨誤 15同 16異 17辨識例句 18近義 19反義 20參考詞語 21主條/非主條
const SRC = {
  idi:  { label: "成語典",            name: r => r[1], zy: r => r[2], py: r => r[3], def: r => r[4] },
  rev:  { label: "重編國語辭典修訂本", name: r => r[0], zy: r => r[6], py: r => r[9], def: r => r[13] },
  con:  { label: "國語辭典簡編本",     name: r => r[0], zy: r => r[5], py: r => r[6], def: r => r[12] },
  mini: { label: "國語小字典",         name: r => r[0], zy: r => r[4], py: () => "",  def: r => r[5] },
};
const ORDER = ["idi", "rev", "con", "mini"]; // 同一詞目時的顯示順序

const $ = id => document.getElementById(id);
const els = {
  chips: $("chips"), q: $("q"), form: $("searchForm"), results: $("results"), status: $("status"),
  more: $("more"), clear: $("clearBtn"), history: $("history"), zyPad: $("zyPad"), zyToggle: $("zyToggle"),
  fontBtn: $("fontBtn"), favBtn: $("favBtn"), favBar: $("favBar"), favCopy: $("favCopy"), favPrint: $("favPrint"),
  favClear: $("favClear"), radicalBar: $("radicalBar"), radical: $("radical"), strokes: $("strokes"),
};
const PAGE = 30;
const state = { filter: "all", groups: [], shown: 0, token: 0, fav: false };

// ---------- 小工具 ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const charLen = s => [...s].length;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 正規化 ----------
const stripZy = s => s.replace(/[ˊˇˋ˙\s　（）()]/g, "");
const stripPy = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s'’\-（）()]/g, "").replace(/v/g, "u");
const isZy = s => /^[ㄅ-ㄯㆠ-ㆿˊˇˋ˙\s　]+$/.test(s);
const isPy = s => /^[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s'’\-]+$/.test(s);

// ---------- 資料載入 ----------
async function getJSON(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`找不到 ${url}（HTTP ${res.status}）`);
      return await res.json();
    } catch (e) { err = e; await sleep(600 * (i + 1)); }
  }
  throw new Error(err.message === "Failed to fetch" ? `無法下載 ${url}，請確認網路連線` : err.message);
}

const IDX = {};      // src -> {n,z,p,c}
let GLYPH = {};      // 造字圖：檔名 -> data URL（文字中以 &檔名; 內嵌）
let ILL = { files: {}, byName: {} }; // 自製插圖：data/illus-index.json（詞目 -> 圖片）
const byName = {};   // src -> Map(name -> [row])
const charInfo = new Map(); // 單字 -> [部首, 總筆畫]
let manifest;
let indexReady;

function loadIndexes() {
  return indexReady ??= (async () => {
    els.status.textContent = "準備辭典索引中…";
    manifest = await getJSON("data/manifest.json");
    let done = 0;
    await Promise.all([
      ...ORDER.map(async s => {
        IDX[s] = await getJSON(`data/index-${s}.json`);
        els.status.textContent = `準備辭典索引中… ${++done}/${ORDER.length}`;
      }),
      getJSON("data/glyphs.json").then(g => { GLYPH = g; }).catch(() => {}),
      getJSON("data/illus-index.json", 1).then(p => { ILL = p; }).catch(() => {}),
    ]);
    for (const s of ORDER) {
      const m = new Map();
      IDX[s].n.forEach((n, i) => { const a = m.get(n); a ? a.push(i) : m.set(n, [i]); });
      byName[s] = m;
    }
    for (const s of ["rev", "con", "mini"]) {
      for (const [i, rad, st] of IDX[s].c) {
        const ch = IDX[s].n[i];
        if (!charInfo.has(ch)) charInfo.set(ch, [rad, st]);
      }
    }
    fillRadicals();
  })();
}

function fillRadicals() {
  const rad = [...new Set([...charInfo.values()].map(v => v[0]))];
  try { rad.sort(new Intl.Collator("zh-Hant-u-co-stroke").compare); } catch { rad.sort(); }
  for (const r of rad) els.radical.add(new Option(r, r));
  const st = [...new Set([...charInfo.values()].map(v => v[1]))].sort((a, b) => a - b);
  for (const s of st) els.strokes.add(new Option(s + " 畫", s));
}

// 列資料分檔，需要時才載入
const chunkCache = {};
function chunkOf(src, row) {
  const st = manifest[src].starts;
  let k = st.length - 1;
  while (st[k] > row) k--;
  return k;
}
function loadChunk(src, k) {
  const key = src + "-" + k;
  return chunkCache[key] ??= getJSON(`data/${key}.json`).catch(e => { delete chunkCache[key]; throw e; });
}
async function getRow(src, row) {
  const k = chunkOf(src, row);
  const part = await loadChunk(src, k);
  return part[row - manifest[src].starts[k]];
}
async function getRows(src, rows) { return Promise.all(rows.map(r => getRow(src, r))); }

// ---------- 搜尋 ----------
function rank(text, q) {
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  return text.includes(q) ? 2 : -1;
}

function inFilter(name, hasIdi) {
  const n = charLen(name);
  switch (state.filter) {
    case "single": return n === 1;
    case "word": return n >= 2;
    case "idiom": return hasIdi || n === 4;
    default: return true;
  }
}

// 以詞目合併各辭典的結果；group = {name, rank, rows: {src: [row...]}}
function search(qRaw) {
  const q = qRaw.trim();
  const groups = new Map();
  const add = (s, i, name, r) => {
    let g = groups.get(name);
    if (!g) groups.set(name, g = { name, rank: r, rows: {} });
    if (r < g.rank) g.rank = r;
    (g.rows[s] ??= []).push(i);
  };

  const rad = els.radical.value, stk = els.strokes.value;
  const radOk = name => {
    if (state.filter !== "single" || (!rad && !stk)) return true;
    const info = charInfo.get(name);
    return !!info && (!rad || info[0] === rad) && (!stk || String(info[1]) === stk);
  };

  if (!q) { // 只用部首／筆畫列出單字
    if (state.filter === "single" && (rad || stk)) {
      for (const s of ORDER) IDX[s].n.forEach((n, i) => { if (charLen(n) === 1 && radOk(n)) add(s, i, n, 0); });
    }
    return finish(groups);
  }

  let field = "n", needle = q;
  if (isZy(q)) { field = "z"; needle = stripZy(q); }
  else if (isPy(q)) { field = "p"; needle = stripPy(q); }
  if (!needle) return [];

  for (const s of ORDER) {
    const names = IDX[s].n, keys = IDX[s][field];
    for (let i = 0; i < keys.length; i++) {
      const r = rank(keys[i], needle);
      if (r >= 0 && radOk(names[i])) add(s, i, names[i], r);
    }
  }
  return finish(groups);
}

function finish(groups) {
  const list = [...groups.values()].filter(g => inFilter(g.name, !!g.rows.idi));
  const first = g => Math.min(...ORDER.filter(s => g.rows[s]).map(s => g.rows[s][0] / 1e6 + ORDER.indexOf(s)));
  list.sort((a, b) => a.rank - b.rank || charLen(a.name) - charLen(b.name) || first(a) - first(b));
  return list;
}

// ---------- 顯示：釋義 ----------
// 文字中的「&檔名.gif;」是教育部的造字圖（Unicode 沒有的字），改以內嵌圖片顯示
const GLYPH_SPLIT = /(&[0-9A-Za-z_.\-]+\.(?:gif|jpg|png);)/;
const GLYPH_TOKEN = /^&([0-9A-Za-z_.\-]+\.(?:gif|jpg|png));$/;
// 輕聲「˙」畫在注音符號上方（字串中以「˙＋注音」出現時）
function neutralAppend(parent, text) {
  for (const seg of text.split(/(˙[\u3105-\u312F\u31A0-\u31BF]+)/)) {
    if (/^˙[\u3105-\u312F\u31A0-\u31BF]+$/.test(seg)) parent.appendChild(h("span", "neu", seg.slice(1)));
    else if (seg) parent.append(seg);
  }
}
function richAppend(parent, text) {
  for (const part of text.split(GLYPH_SPLIT)) {
    const m = part.match(GLYPH_TOKEN);
    if (!m) { if (part) neutralAppend(parent, part); continue; }
    const src = GLYPH[m[1].toLowerCase()];
    if (!src) { parent.append("〓"); continue; }
    const img = document.createElement("img");
    img.className = "glyph"; img.alt = "〓"; img.src = src;
    parent.appendChild(img);
  }
}
const noGlyph = s => s.replace(/&[0-9A-Za-z_.\-]+\.(?:gif|jpg|png);/g, "〓");
// 小字典釋義以「&&字注音&&」標記逐字注音，轉為直排注音顯示（內容不變）
function renderRuby(text) {
  const frag = document.createDocumentFragment();
  let any = false;
  text.split("&&").forEach((seg, i, arr) => {
    const m = i > 0 && i < arr.length ? seg.match(/^([^ㄅ-ㄯˊˇˋ˙]+)([ㄅ-ㄯㆠ-ㆿˊˇˋ˙]+)$/) : null;
    if (m) {
      any = true;
      const z = h("span", "z");
      richAppend(z, m[1]);
      // 聲調符號放在注音右側（輕聲「˙」放在上方），符合傳統直排標示
      const tm = m[2].match(/^(˙)?([^ˊˇˋ˙]*)([ˊˇˋ])?$/);
      const i2 = h("i");
      if (tm && tm[1]) i2.className = "neutral"; // 輕聲：圓點放在注音上方
      if (tm) {
        if (tm[1]) i2.appendChild(h("u", "t0", tm[1]));
        i2.appendChild(h("b", null, tm[2]));
        if (tm[3]) i2.appendChild(h("u", "t1", tm[3]));
      } else i2.appendChild(h("b", null, m[2]));
      z.appendChild(i2);
      frag.appendChild(z);
    } else richAppend(frag, seg);
  });
  return { frag, any };
}
const plainDef = t => noGlyph(t.split("&&").map((s, i, a) => (i > 0 && i < a.length ? s.replace(/[ㄅ-ㄯㆠ-ㆿˊˇˋ˙]+$/, "") : s)).join(""));

function defEl(src, text, cls = "def") {
  const p = h("p", cls);
  if (src === "mini" && text.includes("&&")) {
    const { frag, any } = renderRuby(text);
    p.appendChild(frag);
    if (any) p.classList.add("rubied");
  } else richAppend(p, text);
  return p;
}
// 注音：每個音節獨立一格，音節間距一致（避免無聲調的音節看起來和下一個音節黏在一起）
function zyEl(text) {
  const e = h("span", "zy");
  for (const syl of text.split(/[\s\u3000]+/).filter(Boolean)) {
    const neutral = syl.startsWith("˙");
    e.appendChild(h("span", neutral ? "syl neu" : "syl", neutral ? syl.slice(1) : syl));
  }
  return e;
}
function line(parent, label, text) {
  if (!text) return;
  const p = h("p", "meta", label);
  richAppend(p, text);
  parent.appendChild(p);
}

// 單一辭典的一個條目內容（區塊）
// 插圖：圖檔打包在 data/illus-N.bin，需要時才下載並切出單張圖
const packCache = {}, blobCache = {};
function loadPack(k) {
  return packCache[k] ??= fetch(`data/illus-${k}.bin`).then(res => {
    if (!res.ok) throw new Error(res.status);
    return res.arrayBuffer();
  }).catch(e => { delete packCache[k]; throw e; });
}
async function picURL(file) {
  if (blobCache[file]) return blobCache[file];
  const [k, off, len, mime] = ILL.files[file];
  const buf = await loadPack(k);
  return blobCache[file] = URL.createObjectURL(new Blob([buf.slice(off, off + len)], { type: mime }));
}
function addPics(parent, list) {
  const seen = new Set();
  for (const [file, title, credit] of list) {
    if (seen.has(file) || !ILL.files[file]) continue;
    seen.add(file);
    const fig = h("figure", "pic");
    const holder = h("div", "pich", "載入插圖中…");
    fig.appendChild(holder);
    fig.appendChild(h("figcaption", null, title + (credit ? "　" + credit : "")));
    parent.appendChild(fig);
    picURL(file).then(url => {
      const img = document.createElement("img");
      img.alt = title; img.src = url;
      holder.textContent = ""; holder.appendChild(img);
    }).catch(() => { holder.textContent = "插圖載入失敗（請連上網路後重試）"; });
  }
}
function openLightbox(url) {
  const box = h("div", "lightbox");
  const img = document.createElement("img");
  img.src = url;
  box.appendChild(img);
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
}

function entryBlock(src, r) {
  const d = SRC[src];
  const b = h("div", "entry");
  const head = h("p", "ehead");
  head.appendChild(zyEl(d.zy(r)));
  if (d.py(r)) head.appendChild(h("span", "py", d.py(r)));
  b.appendChild(head);
  if (src === "rev") {
    if (r[1]) line(b, "別名：", r[1]);
    if (r[15]) line(b, "", r[15]);
    if (charLen(r[0]) === 1 && r[2]) line(b, "", `部首：${r[2]}　總筆畫：${r[3]}　部首外筆畫：${r[4]}`);
    if (r[7]) line(b, "變體：", [r[8], r[10]].filter(Boolean).join("　"));
    b.appendChild(defEl(src, r[13]));
    line(b, "相似詞：", r[11]); line(b, "相反詞：", r[12]); line(b, "", r[14]);
  } else if (src === "con") {
    if (r[1].length === 4) line(b, "", `部首：${r[2]}　總筆畫：${r[3]}　部首外筆畫：${r[4]}`);
    if (r[7]) line(b, "變體：", [r[8], r[9]].filter(Boolean).join("　"));
    b.appendChild(defEl(src, r[12]));
    line(b, "相似詞：", r[10]); line(b, "相反詞：", r[11]); line(b, "", r[13]);
  } else if (src === "mini") {
    line(b, "", `部首：${r[1]}　總筆畫：${r[2]}　部首外筆畫：${r[3]}`);
    b.appendChild(defEl(src, r[5]));
  } else { // idi
    if (r[21]) line(b, "", r[21]);
    b.appendChild(defEl(src, r[4]));
    line(b, "近義成語：", r[18]); line(b, "反義成語：", r[19]);
    const fields = [
      ["典源", r[5] ? r[5] + "\n" + r[6] : r[6]], ["典源注解", r[7]], ["典源參考資料", r[8]], ["典故說明", r[9]],
      ["書證", r[10]], ["語義說明", r[11]], ["使用類別", r[12]], ["例句", r[13]],
      ["形音辨誤", r[14]], ["辨識：同", r[15]], ["辨識：異", r[16]], ["辨識例句", r[17]], ["參考詞語", r[20]],
    ].filter(f => f[1]);
    if (fields.length) {
      const det = h("details"); det.appendChild(h("summary", null, "典源、書證與用法"));
      const dl = h("dl");
      for (const [k, v] of fields) { dl.appendChild(h("dt", null, k)); const dd = h("dd"); richAppend(dd, v); dl.appendChild(dd); }
      det.appendChild(dl); b.appendChild(det);
    }
  }
  return b;
}

function headword(text) {
  const t = h("h2");
  for (const part of text.split(GLYPH_SPLIT)) {
    if (GLYPH_TOKEN.test(part)) { richAppend(t, part); continue; }
    for (const ch of part) {
      if (/[㐀-鿿豈-﫿\u{20000}-\u{3134f}]/u.test(ch)) { const b = h("span", "ch", ch); b.dataset.ch = ch; t.appendChild(b); }
      else t.append(ch);
    }
  }
  return t;
}

// 卡片：先顯示摘要（需要該詞目第一本辭典的第一列），展開時才載入其餘內容
async function buildCard(g) {
  const c = h("li", "card");
  c.dataset.name = g.name;
  const srcs = ORDER.filter(s => g.rows[s]);
  const s0 = srcs[0], r0 = await getRow(s0, g.rows[s0][0]);
  const t = headword(g.name);
  t.appendChild(zyEl(SRC[s0].zy(r0)));
  if (SRC[s0].py(r0)) t.appendChild(h("span", "py", SRC[s0].py(r0)));
  c.appendChild(t);
  const hasPic = !!ILL.byName[g.name];
  c.appendChild(h("p", "tags", srcs.map(s => SRC[s].label).join("　·　") + (hasPic ? "　·　附插圖" : "")));
  c.appendChild(defEl(s0, SRC[s0].def(r0), "def sum"));
  const body = h("div", "body");
  c.appendChild(body);
  c._g = g; c._srcs = srcs;
  const star = h("button", "star", favSet().has(g.name) ? "★" : "☆");
  star.dataset.name = g.name; star.setAttribute("aria-label", "收藏到生字本");
  c.appendChild(star);
  return c;
}

async function openCard(c) {
  const body = c.querySelector(".body");
  c.classList.add("open");
  if (c._built) return;
  c._built = true;
  const g = c._g;
  try {
    if (ILL.byName[g.name]) addPics(body, ILL.byName[g.name]);
    for (const s of c._srcs) {
      const rows = await getRows(s, g.rows[s]);
      const sec = h("section", "src");
      sec.appendChild(h("h3", null, SRC[s].label));
      rows.forEach(r => sec.appendChild(entryBlock(s, r)));
      body.appendChild(sec);
    }
  } catch (e) { c._built = false; body.textContent = "資料載入失敗：" + e.message; }
}

// ---------- 結果列表 ----------
async function renderMore() {
  const token = state.token;
  const next = Math.min(state.shown + PAGE, state.groups.length);
  const slice = state.groups.slice(state.shown, next);
  els.more.hidden = true;
  let cards;
  try { cards = await Promise.all(slice.map(buildCard)); }
  catch (e) { els.status.textContent = "資料載入失敗：" + e.message + "（請連上網路後重試）"; return; }
  if (token !== state.token) return;
  const frag = document.createDocumentFragment();
  cards.forEach(c => frag.appendChild(c));
  els.results.appendChild(frag);
  state.shown = next;
  if (state.groups.length <= 3) cards.forEach(openCard); // 結果很少時直接展開
  els.more.hidden = state.shown >= state.groups.length;
  els.status.textContent = state.fav
    ? (state.groups.length ? `生字本：${state.groups.length} 筆` : "生字本還是空的。查詢後點條目右上角的 ☆ 就能收藏。")
    : state.groups.length ? `共 ${state.groups.length} 筆（點選條目展開）` : "找不到符合的條目";
}

// ---------- 查詢紀錄 ----------
function remember(q) {
  q = q.trim();
  if (!q) return;
  const list = store.get("hist", []).filter(x => x !== q && typeof x === "string");
  list.unshift(q);
  store.set("hist", list.slice(0, 12));
}
function showHistory() {
  const list = store.get("hist", []).filter(x => typeof x === "string");
  els.history.textContent = "";
  els.history.hidden = !list.length || !!els.q.value.trim() || state.fav;
  if (els.history.hidden) return;
  els.history.appendChild(h("span", "lbl", "最近查詢"));
  for (const x of list.slice(0, 8)) {
    const b = h("button", null, x); b.dataset.q = x;
    els.history.appendChild(b);
  }
}

// ---------- 生字本 ----------
function favList() {
  // 舊版以「分頁|詞目|注音」儲存，轉成只用詞目
  const raw = store.get("fav", []);
  const names = raw.map(k => (k.includes("|") ? k.split("|")[1] : k));
  return [...new Set(names)];
}
const favSet = () => new Set(favList());
function toggleFav(name, btn) {
  const list = favList();
  const i = list.indexOf(name);
  if (i >= 0) list.splice(i, 1); else list.unshift(name);
  store.set("fav", list);
  btn.textContent = i >= 0 ? "☆" : "★";
  if (state.fav && i >= 0) btn.closest(".card").remove();
}
function favGroups() {
  const out = [];
  for (const name of favList()) {
    const g = { name, rank: 0, rows: {} };
    for (const s of ORDER) if (byName[s].has(name)) g.rows[s] = byName[s].get(name);
    if (Object.keys(g.rows).length) out.push(g);
  }
  return out;
}
async function favText() {
  const parts = [];
  for (const g of state.groups) {
    const s = ORDER.find(x => g.rows[x]);
    const r = await getRow(s, g.rows[s][0]);
    parts.push(`${noGlyph(g.name)}　${SRC[s].zy(r)}\n${plainDef(SRC[s].def(r))}`);
  }
  return parts.join("\n\n");
}

// ---------- 主流程 ----------
async function run() {
  const token = ++state.token;
  const q = els.q.value;
  syncHash();
  els.clear.hidden = !q;
  els.results.textContent = "";
  els.more.hidden = true;
  showHistory();
  els.favBar.hidden = !state.fav;
  els.favBtn.setAttribute("aria-pressed", String(state.fav));
  els.radicalBar.hidden = state.filter !== "single";
  try { await loadIndexes(); } catch (e) {
    els.status.textContent = "資料載入失敗：" + e.message + "（請連上網路後重試）"; indexReady = null; return;
  }
  if (token !== state.token) return;

  if (state.fav) {
    state.groups = favGroups().filter(g => inFilter(g.name, !!g.rows.idi));
  } else {
    const hasFilter = state.filter === "single" && (els.radical.value || els.strokes.value);
    if (!q.trim() && !hasFilter) {
      els.status.textContent = "輸入國字、詞語、成語、注音或拼音開始查詢";
      return;
    }
    state.groups = search(q);
  }
  state.shown = 0;
  await renderMore();
}

function setFilter(f) {
  state.filter = f;
  for (const b of els.chips.children) b.setAttribute("aria-selected", String(b.dataset.f === f));
  run();
}

function syncHash() {
  const p = new URLSearchParams();
  if (state.filter !== "all") p.set("f", state.filter);
  if (els.q.value) p.set("q", els.q.value);
  try { history.replaceState(null, "", "#" + p); } catch {}
}

// ---------- 注音鍵盤 ----------
let timer;
const ZY_KEYS = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ".split("").concat(["ˊ", "ˇ", "ˋ", "˙", "⌫"]);
for (const k of ZY_KEYS) {
  const b = h("button", /[ˊˇˋ˙⌫]/.test(k) ? "tone" : null, k);
  b.type = "button"; b.dataset.k = k;
  els.zyPad.appendChild(b);
}
els.zyPad.addEventListener("click", e => {
  const k = e.target.closest("button")?.dataset.k;
  if (!k) return;
  state.fav = false;
  els.q.value = k === "⌫" ? els.q.value.slice(0, -1) : els.q.value + k;
  clearTimeout(timer); run();
});
els.zyToggle.addEventListener("click", () => {
  const open = els.zyPad.hidden;
  els.zyPad.hidden = !open;
  els.zyToggle.setAttribute("aria-expanded", String(open));
  store.set("zyOpen", open);
});

// ---------- 字體大小 ----------
const SIZES = [17, 20, 24];
let sizeIdx = Math.min(store.get("size", 0), SIZES.length - 1);
const applySize = () => document.documentElement.style.setProperty("--fs", SIZES[sizeIdx] + "px");
applySize();
els.fontBtn.addEventListener("click", () => { sizeIdx = (sizeIdx + 1) % SIZES.length; applySize(); store.set("size", sizeIdx); });

// ---------- 事件 ----------
els.chips.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && b.dataset.f !== state.filter) setFilter(b.dataset.f);
});
els.q.addEventListener("input", () => { state.fav = false; clearTimeout(timer); timer = setTimeout(run, 180); });
els.form.addEventListener("submit", e => { e.preventDefault(); els.q.blur(); remember(els.q.value); run(); });
els.clear.addEventListener("click", () => { els.q.value = ""; els.q.focus(); run(); });
els.radical.addEventListener("change", run);
els.strokes.addEventListener("change", run);
els.more.addEventListener("click", renderMore);
els.history.addEventListener("click", e => {
  const q = e.target.closest("button")?.dataset.q;
  if (q) { state.fav = false; els.q.value = q; run(); }
});
els.favBtn.addEventListener("click", () => { state.fav = !state.fav; run(); });
els.favPrint.addEventListener("click", async () => {
  // 列印前先展開全部條目，確保內容完整
  await Promise.all([...els.results.children].map(openCard));
  print();
});
els.favCopy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(await favText()); els.status.textContent = "已複製生字本內容，可貼到文件或通訊軟體"; }
  catch { els.status.textContent = "此裝置無法自動複製，請改用列印"; }
});
els.favClear.addEventListener("click", () => {
  if (!confirm("確定要清空生字本嗎？")) return;
  store.set("fav", []);
  run();
});
els.results.addEventListener("click", e => {
  const star = e.target.closest(".star");
  if (star) { toggleFav(star.dataset.name, star); return; }
  const pic = e.target.closest(".pich img");
  if (pic) { openLightbox(pic.src); return; }
  const ch = e.target.closest(".ch");
  const card = e.target.closest(".card");
  if (ch && card?.classList.contains("open")) { // 在展開的條目中點字 → 查該字
    scrollTo({ top: 0 });
    state.fav = false; els.q.value = ch.dataset.ch;
    setFilter("single");
    return;
  }
  if (!card || e.target.closest("summary,details")) return;
  if (card.classList.contains("open")) card.classList.remove("open");
  else { remember(els.q.value); openCard(card); }
});

{
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("q")) els.q.value = p.get("q");
  if (store.get("zyOpen", false)) { els.zyPad.hidden = false; els.zyToggle.setAttribute("aria-expanded", "true"); }
  const f = p.get("f");
  setFilter(["single", "word", "idiom"].includes(f) ? f : "all");
}

if ("serviceWorker" in navigator) {
  // 更新後第一次開啟：新版接手時自動重新整理一次，避免舊的插圖索引搭配新的圖片檔
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
