// 網頁程式與辭典資料分開快取：
//  APP_CACHE  — 網頁程式、圖示、授權文件。程式有更新時把版號加 1。
//  DATA_CACHE — data/ 底下的辭典、索引與插圖（體積大，使用者可能已下載離線資料）。
//               只有「data 資料夾的內容有變」時才把版號加 1，否則更新程式不會讓使用者重新下載資料。
const APP_CACHE = "moedict-app-v22";
const DATA_CACHE = "moedict-data-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "about.html", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "license/reviseddict_10312.pdf", "license/minidict_10312.pdf", "license/conciseddict_10312.pdf", "license/idiomsdict_10409.pdf"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== APP_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 快取優先；辭典 JSON 與插圖第一次使用後即可離線查詢
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const cacheName = url.pathname.includes("/data/") ? DATA_CACHE : APP_CACHE;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && url.origin === location.origin) {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
