import { toast } from "./toast.js";
import { api } from "./api.js";

var MODE = "control";
var ROOM = "Mesa Principal";
var CHANNEL = null;
var MATCH_SLUG = "";
var MATCH_INFO = null;
var sse = null;
var persistTimer = null;
var bound = false;
var started = false;
var apiOk = false;
var histCache = [];
var mesaWatchTimer = null;
var mesaWatchSlug = "";
var tacadas = [];
var TACADA_TYPES = { pontos: 1, menos: 1, manual: 1, desfazer: 1 };
var lsOk = false;
var bcOk = false;
var errors = [];
var state = null;
var armedBtn = null;
var armTimer = null;
var armInterval = null;
var recordTimer = null;
var winnerTimer = null;
var histTimer = null;
var cursorTimer = null;
var tickTimer = null;
var lastSent = "";
var SCORE_VALUES = [1,2,3,4,5,6,7];
var PBTN_CLASS = ["p1","p2","p3","p4","p5","p6","p7"];
var PBTN_TEXT = ["#e53935","#fdd835","#43a047","#6d4c41","#1e88e5","#ec407a","#111111"];
var BALL_NAMES = ["","vermelha","amarela","verde","marrom","azul","rosa","preta"];
var STORE_KEY = "placar-sinuca-state-v1";
var HIST_KEY = "placar-sinuca-hist-v1";

function $(id) { return document.getElementById(id); }
function logErr(msg) {
errors.push(String(msg));
if (errors.length > 20) { errors.shift(); }
renderDiag();
}
function pad2(n) { n = Math.floor(n); return (n < 10 ? "0" : "") + n; }
function fmtTime(sec) {
sec = Math.max(0, Math.floor(sec));
var m = Math.floor(sec / 60);
var s = sec % 60;
return pad2(m) + ":" + pad2(s);
}
function nowMs() { return new Date().getTime(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) {
return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function defaultState() {
return {
room: ROOM,
melhorDe: 3,
names: ["Ricardo", "Marcos"],
points: [0, 0],
wins: [0, 0],
times: [0, 0],
maxBreak: [0, 0],
curBreak: [0, 0],
tempoTotalPartida: 0,
inicioPartida: 0,
inicioJogada: 0,
jogadorNaJogada: -1,
jogadaAtiva: false,
jogadaPausada: false,
partidaEncerrada: false,
confrontoEncerrado: false,
numeroPartidaAtual: 1,
recordFlag: null,
recordId: 0,
winnerId: 0,
lastScoreStack: [],
history: [],
updatedAt: nowMs()
};
}

function loadLocal() { return null; }
function loadHist() { return histCache || []; }
function saveHist(list) { histCache = list || []; }

function logMatch(type, message, payload) {
if (!MATCH_SLUG || MODE !== "control") { return; }
api.postLog(MATCH_SLUG, { type: type, message: message, payload: payload || null }).catch(function () {});
}

function fmtClock(ts) {
var d = new Date(ts);
return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}
function fmtDelta(n) {
n = Number(n) || 0;
if (n > 0) { return "+" + n; }
if (n < 0) { return "−" + Math.abs(n); }
return "0";
}
function deltaClass(n) {
n = Number(n) || 0;
if (n > 0) { return "tacada-plus"; }
if (n < 0) { return "tacada-minus"; }
return "tacada-zero";
}
function recordTacada(entry) {
if (!entry) { return; }
entry.ts = entry.ts || nowMs();
tacadas.unshift(entry);
if (tacadas.length > 300) { tacadas.length = 300; }
renderTacadas();
}
function tacadaFromLog(row) {
if (!row || !TACADA_TYPES[row.type]) { return null; }
var p = row.payload || {};
var names = state && state.names ? state.names : ["Jogador 1", "Jogador 2"];
var idx = typeof p.idx === "number" ? p.idx : -1;
var delta = p.delta != null ? p.delta : (p.val != null && row.type === "pontos" ? p.val : 0);
var player = idx >= 0 ? names[idx] : (p.player || "");
if (!player && row.message) {
var m = /^(.+?) [+\-−]/.exec(row.message);
if (m) { player = m[1]; }
}
if (!player && row.type === "desfazer") { player = "—"; }
if (row.type === "menos" && !delta) { delta = -1; }
var ball = p.ball || (row.type === "pontos" && p.val ? BALL_NAMES[p.val] : "") || "";
var points = Array.isArray(p.points) ? p.points : null;
return {
ts: row.ts,
player: player,
delta: delta,
ball: ball,
points: points,
type: row.type
};
}
function renderTacadas() {
var body = $("tacadaBody");
var count = $("tacadaCount");
if (count) {
count.textContent = tacadas.length
  ? tacadas.length + (tacadas.length === 1 ? " tacada registrada" : " tacadas registradas")
  : "Nenhuma tacada registrada";
}
if (!body) { return; }
if (!tacadas.length) {
body.innerHTML = '<tr><td colspan="5" class="pl-sub">As bolas lançadas e os ajustes de placar aparecem aqui, da mais recente para a mais antiga.</td></tr>';
return;
}
var html = "";
for (var i = 0; i < tacadas.length; i++) {
var t = tacadas[i];
var placar = Array.isArray(t.points) ? t.points[0] + " × " + t.points[1] : "—";
var ball = t.ball || (t.type === "manual" ? "manual" : (t.type === "desfazer" ? "desfazer" : "—"));
html += "<tr><td>" + esc(fmtClock(t.ts)) + "</td><td>" + esc(t.player || "—") + "</td><td class=\"" + deltaClass(t.delta) + "\">" + esc(fmtDelta(t.delta)) + "</td><td>" + esc(ball) + "</td><td>" + esc(placar) + "</td></tr>";
}
body.innerHTML = html;
}
async function loadTacadas() {
tacadas = [];
if (!MATCH_SLUG) { renderTacadas(); return; }
try {
var data = await api.logs(MATCH_SLUG);
var rows = data.logs || [];
var mapped = [];
for (var i = 0; i < rows.length; i++) {
var item = tacadaFromLog(rows[i]);
if (item) { mapped.push(item); }
}
tacadas = mapped;
renderTacadas();
} catch (e) { logErr("tacadas: " + e.message); renderTacadas(); }
}

function persistAndBroadcast() {
state.updatedAt = nowMs();
if (MODE === "control") { sendState(); }
}
function sendState() {
if (!MATCH_SLUG || MODE !== "control" || !state) { return; }
lastSent = JSON.stringify({ p: state.points, t: state.times, m: state.maxBreak, c: state.curBreak, s: state.jogadorNaJogada });
if (persistTimer) { clearTimeout(persistTimer); }
persistTimer = setTimeout(function () {
api.putState(MATCH_SLUG, state).then(function () {
apiOk = true; lsOk = true; bcOk = true;
}).catch(function (e) {
apiOk = false; bcOk = false;
logErr("sync: " + e.message);
});
}, 80);
}

function closeSse() {
if (sse) {
try { sse.close(); } catch (e) {}
sse = null;
}
}

function setupSync() {
closeSse();
if (!MATCH_SLUG) { return; }
if (MODE !== "tv") { apiOk = true; bcOk = true; lsOk = true; return; }
try {
sse = new EventSource("/api/partidas/" + encodeURIComponent(MATCH_SLUG) + "/stream");
sse.onmessage = function (ev) {
try {
var msg = JSON.parse(ev.data);
if (msg && msg.type === "state" && msg.state) {
state = msg.state;
renderAll();
}
} catch (e) { logErr("sse parse: " + e.message); }
};
sse.onerror = function () { apiOk = false; bcOk = false; };
sse.onopen = function () { apiOk = true; bcOk = true; lsOk = true; };
} catch (e) { logErr("sse: " + e.message); }
}

async function refreshHist() {
if (!MATCH_INFO || !MATCH_INFO.mesa) { histCache = []; return; }
try {
var data = await api.resultado(MATCH_INFO.mesa.slug);
histCache = (data.matches || []).map(function (r) {
return {
data: new Date(r.created_at).toLocaleString("pt-BR"),
nomes: r.player1 + " x " + r.player2,
placar: r.wins[0] + " x " + r.wins[1],
formato: "Melhor de " + r.melhor_de,
pontos: r.points[0] + " x " + r.points[1],
tempo: "",
maior: Math.max(r.maxBreak[0], r.maxBreak[1])
};
});
} catch (e) { logErr("histórico: " + e.message); }
}

function currentMaxScore() { return state.melhorDe; }
function totalMatchesWon() { return state.wins[0] + state.wins[1]; }

function isScoringAllowed(idx) {
return state.jogadorNaJogada === idx && !state.partidaEncerrada && !state.confrontoEncerrado && !state.jogadaPausada && state.jogadaAtiva;
}

function accrueCurrentTime() {
if (state.jogadaAtiva && !state.jogadaPausada && !state.partidaEncerrada && state.inicioJogada > 0 && state.jogadorNaJogada >= 0) {
var elapsed = (nowMs() - state.inicioJogada) / 1000;
state.times[state.jogadorNaJogada] += elapsed;
state.inicioJogada = nowMs();
}
}

function computeMatchTime() {
if (state.partidaEncerrada || state.jogadaPausada || state.inicioPartida <= 0) { return state.tempoTotalPartida; }
return state.tempoTotalPartida + (nowMs() - state.inicioPartida) / 1000;
}

function displayTimes(idx) {
var t = state.times[idx];
if (state.jogadorNaJogada === idx && state.jogadaAtiva && !state.jogadaPausada && !state.partidaEncerrada && state.inicioJogada > 0) {
t += (nowMs() - state.inicioJogada) / 1000;
}
return t;
}

function selectPlayer(idx) {
if (MODE !== "control") { return; }
try {
if (state.confrontoEncerrado || state.partidaEncerrada) { return; }
accrueCurrentTime();
if (state.jogadorNaJogada === idx && state.jogadaAtiva) { return; }
state.jogadorNaJogada = idx;
state.jogadaAtiva = true;
if (!state.jogadaPausada) {
state.inicioJogada = nowMs();
if (state.inicioPartida <= 0) { state.inicioPartida = nowMs(); }
}
logMatch("jogada", state.names[idx] + " na jogada");
} catch (e) { logErr("selecionar jogador: " + e.message); }
finally { persistAndBroadcast(); renderAll(); }
}

function addPoints(idx, val) {
if (!isScoringAllowed(idx)) { return; }
accrueCurrentTime();
var before = { p: state.points.slice(0), c: state.curBreak.slice(0), m: state.maxBreak.slice(0) };
state.lastScoreStack.push(before);
if (state.lastScoreStack.length > 50) { state.lastScoreStack.shift(); }
var other = idx === 0 ? 1 : 0;
state.points[idx] += val;
state.curBreak[idx] += val;
state.curBreak[other] = 0;
if (state.curBreak[idx] > state.maxBreak[idx]) {
var prevMax = state.maxBreak[idx];
state.maxBreak[idx] = state.curBreak[idx];
if (state.curBreak[idx] > 0 && state.curBreak[idx] > prevMax) {
state.recordFlag = { name: state.names[idx], pts: state.maxBreak[idx] };
state.recordId = nowMs();
}
}
logMatch("pontos", state.names[idx] + " +" + val + " (" + BALL_NAMES[val] + ") → " + state.points[idx], { idx: idx, val: val, delta: val, ball: BALL_NAMES[val], points: state.points.slice(0) });
recordTacada({ player: state.names[idx], delta: val, ball: BALL_NAMES[val], points: state.points.slice(0), type: "pontos" });
persistAndBroadcast();
renderAll();
}

function setManual() {
if (MODE !== "control") { return; }
var v = parseInt($("manualValue").value, 10);
if (isNaN(v) || v < 0) { toastErr("Informe um valor válido."); return; }
if (state.jogadorNaJogada < 0) { toastErr("Coloque um jogador na jogada primeiro."); return; }
if (!isScoringAllowed(state.jogadorNaJogada)) { toastErr("Pontuação bloqueada agora."); return; }
var idx = state.jogadorNaJogada;
accrueCurrentTime();
var prevPts = state.points[idx];
state.lastScoreStack.push({ p: state.points.slice(0), c: state.curBreak.slice(0), m: state.maxBreak.slice(0) });
state.points[idx] = v;
state.curBreak[idx] = v;
state.curBreak[idx === 0 ? 1 : 0] = 0;
if (v > state.maxBreak[idx]) { state.maxBreak[idx] = v; }
var delta = v - prevPts;
logMatch("manual", state.names[idx] + " placar definido para " + v, { idx: idx, val: v, delta: delta, ball: "manual", points: state.points.slice(0) });
recordTacada({ player: state.names[idx], delta: delta, ball: "manual", points: state.points.slice(0), type: "manual" });
persistAndBroadcast();
renderAll();
toastOk("Pontuação definida para " + v + ".");
}

function minusOne() {
if (MODE !== "control") { return; }
var idx = state.jogadorNaJogada;
if (idx < 0 || !isScoringAllowed(idx)) { return; }
accrueCurrentTime();
state.lastScoreStack.push({ p: state.points.slice(0), c: state.curBreak.slice(0), m: state.maxBreak.slice(0) });
var delta = 0;
if (state.points[idx] > 0) { state.points[idx] -= 1; delta = -1; }
state.curBreak[idx] = 0;
if (!delta) { persistAndBroadcast(); renderAll(); return; }
logMatch("menos", state.names[idx] + " −1 → " + state.points[idx], { idx: idx, delta: -1, ball: "ajuste", points: state.points.slice(0) });
recordTacada({ player: state.names[idx], delta: -1, ball: "ajuste", points: state.points.slice(0), type: "menos" });
persistAndBroadcast();
renderAll();
}

function undo() {
if (MODE !== "control") { return; }
var prev = state.lastScoreStack.pop();
if (!prev) { toastErr("Nada para desfazer."); return; }
var beforePts = state.points.slice(0);
state.points = prev.p;
state.curBreak = prev.c;
state.maxBreak = prev.m;
var d0 = state.points[0] - beforePts[0];
var d1 = state.points[1] - beforePts[1];
var idx = d0 !== 0 ? 0 : (d1 !== 0 ? 1 : (state.jogadorNaJogada >= 0 ? state.jogadorNaJogada : 0));
var delta = idx === 0 ? d0 : d1;
logMatch("desfazer", "Último lançamento desfeito", { idx: idx, delta: delta, ball: "desfazer", points: state.points.slice(0) });
recordTacada({ player: state.names[idx], delta: delta, ball: "desfazer", points: state.points.slice(0), type: "desfazer" });
persistAndBroadcast();
renderAll();
toastOk("Último lançamento desfeito.");
}

function togglePause() {
if (MODE !== "control") { return; }
if (state.partidaEncerrada || state.confrontoEncerrado) { return; }
if (!state.jogadaPausada) {
accrueCurrentTime();
state.tempoTotalPartida = computeMatchTime();
state.inicioPartida = 0;
state.jogadaPausada = true;
state.inicioJogada = 0;
} else {
state.jogadaPausada = false;
if (state.jogadorNaJogada >= 0) { state.inicioJogada = nowMs(); }
if (state.inicioPartida <= 0) { state.inicioPartida = nowMs(); }
}
logMatch(state.jogadaPausada ? "pausa" : "retomada", state.jogadaPausada ? "Jogada pausada" : "Jogada retomada");
persistAndBroadcast();
renderAll();
}

function endMatch() {
if (MODE !== "control") { return; }
if (state.partidaEncerrada) { return; }
accrueCurrentTime();
state.tempoTotalPartida = computeMatchTime();
state.inicioPartida = 0;
state.inicioJogada = 0;
state.jogadaAtiva = false;
state.jogadaPausada = false;
state.partidaEncerrada = true;
var winner = state.points[0] === state.points[1] ? -1 : (state.points[0] > state.points[1] ? 0 : 1);
if (winner >= 0) { state.wins[winner] += 1; }
var need = Math.floor(state.melhorDe / 2) + 1;
if (state.wins[0] >= need || state.wins[1] >= need) {
state.confrontoEncerrado = true;
state.winnerId = nowMs();
registerHistory();
logMatch("confronto", "Confronto encerrado " + state.wins[0] + " x " + state.wins[1]);
} else {
logMatch("frame", "Partida encerrada " + state.points[0] + " x " + state.points[1] + " · frames " + state.wins[0] + " x " + state.wins[1]);
}
persistAndBroadcast();
renderAll();
}

function iniciarProximaPartida() {
try {
if (state.confrontoEncerrado) { return; }
state.numeroPartidaAtual += 1;
state.points = [0, 0];
state.times = [0, 0];
state.curBreak = [0, 0];
state.maxBreak = [0, 0];
state.tempoTotalPartida = 0;
state.jogadorNaJogada = -1;
state.jogadaAtiva = false;
state.jogadaPausada = false;
state.inicioJogada = 0;
state.inicioPartida = 0;
state.partidaEncerrada = false;
state.lastScoreStack = [];
logMatch("proxima", "Iniciada partida " + state.numeroPartidaAtual);
} catch (e) { logErr("próxima partida: " + e.message); }
finally { persistAndBroadcast(); renderAll(); }
}
function startNextMatch() { iniciarProximaPartida(); }

function newGame() {
if (state.confrontoEncerrado) { toastErr("Confronto encerrado. Inicie um novo confronto com outros jogadores."); return; }
state.points = [0, 0];
state.times = [0, 0];
state.curBreak = [0, 0];
state.tempoTotalPartida = 0;
state.inicioPartida = 0;
state.inicioJogada = 0;
state.jogadorNaJogada = -1;
state.jogadaAtiva = false;
state.jogadaPausada = false;
state.partidaEncerrada = false;
state.lastScoreStack = [];
logMatch("novo_jogo", "Placar da partida zerado");
persistAndBroadcast();
renderAll();
toastOk("Jogo zerado.");
}

function newMatchConfronto() {
openNovoConfronto();
}

function playerOptionsHtml(players, selectedId) {
var html = '<option value="">Selecione o jogador</option>';
for (var i = 0; i < players.length; i++) {
var p = players[i];
html += '<option value="' + esc(p.id) + '"' + (p.id === selectedId ? " selected" : "") + ">" + esc(p.name) + "</option>";
}
return html;
}

function closeNovoConfronto() {
var dlg = $("dlgNovoConfronto");
if (dlg) { dlg.classList.add("pl-hidden"); }
}

async function openNovoConfronto() {
if (MODE !== "control") { return; }
if (!MATCH_INFO || !MATCH_INFO.event || !MATCH_INFO.mesa) {
toastErr("Não foi possível identificar a mesa.");
return;
}
var dlg = $("dlgNovoConfronto");
var err = $("ncErr");
var hint = $("ncHint");
if (err) { err.textContent = ""; }
if (hint) {
hint.textContent = state.confrontoEncerrado
  ? "Confronto encerrado nesta mesa. Escolha os jogadores do próximo confronto."
  : "O confronto atual será encerrado. Escolha os jogadores do próximo confronto.";
}
try {
var data = await api.evento(MATCH_INFO.event.id);
var players = data.jogadores || [];
if (players.length < 2) {
toastErr("Cadastre pelo menos dois jogadores neste evento.");
return;
}
$("ncP1").innerHTML = playerOptionsHtml(players, "");
$("ncP2").innerHTML = playerOptionsHtml(players, "");
$("ncFmt").value = String(state.melhorDe || MATCH_INFO.match.melhor_de || 3);
var ok = $("ncOk"); if (ok) { ok.disabled = false; }
if (dlg) { dlg.classList.remove("pl-hidden"); }
} catch (e) {
toastErr(e.message || "Não foi possível carregar os jogadores.");
}
}

async function confirmNovoConfronto() {
var err = $("ncErr");
if (err) { err.textContent = ""; }
var p1 = $("ncP1") ? $("ncP1").value : "";
var p2 = $("ncP2") ? $("ncP2").value : "";
var fmt = $("ncFmt") ? parseInt($("ncFmt").value, 10) : 3;
if (!p1 || !p2) {
if (err) { err.textContent = "Selecione os dois jogadores."; }
return;
}
if (p1 === p2) {
if (err) { err.textContent = "Escolha dois jogadores diferentes."; }
return;
}
var ok = $("ncOk");
if (ok) { ok.disabled = true; }
try {
if (!state.confrontoEncerrado) {
accrueCurrentTime();
state.partidaEncerrada = true;
state.confrontoEncerrado = true;
state.jogadaAtiva = false;
state.inicioJogada = 0;
state.inicioPartida = 0;
logMatch("confronto", "Confronto encerrado para abrir outro na mesa");
await api.putState(MATCH_SLUG, state);
}
var created = await api.createPartida({
mesa_id: MATCH_INFO.mesa.id,
player1_id: p1,
player2_id: p2,
melhor_de: fmt
});
closeNovoConfronto();
toastOk("Novo confronto iniciado.");
window.location.href = created.urls.controle;
} catch (e) {
if (err) { err.textContent = e.message || "Não foi possível criar o confronto."; }
if (ok) { ok.disabled = false; }
}
}

function registerHistory() {
var rec = {
data: new Date().toLocaleString("pt-BR"),
nomes: state.names[0] + " x " + state.names[1],
placar: state.wins[0] + " x " + state.wins[1],
formato: "Melhor de " + state.melhorDe,
pontos: state.points[0] + " x " + state.points[1],
tempo: fmtTime(state.tempoTotalPartida),
maior: Math.max(state.maxBreak[0], state.maxBreak[1])
};
state.history.unshift(rec);
if (state.history.length > 50) { state.history.length = 50; }
var global = loadHist();
global.unshift(rec);
if (global.length > 100) { global.length = 100; }
saveHist(global);
}

function applyConfig() {
if (MODE !== "control") { return; }
var f = parseInt($("cfgFormat").value, 10);
if ([1, 3, 5, 7].indexOf(f) < 0) { toastErr("Formato inválido."); return; }
state.melhorDe = f;
state.room = ROOM;
logMatch("config", "Formato alterado para melhor de " + f);
persistAndBroadcast();
renderAll();
toastOk("Configurações aplicadas.");
}

function clearOverlays() {
if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
if (winnerTimer) { clearTimeout(winnerTimer); winnerTimer = null; }
if (histTimer) { clearTimeout(histTimer); histTimer = null; }
var w = $("tvWinner"); if (w) { w.classList.add("tv-hidden"); }
var h = $("tvHistory"); if (h) { h.classList.add("tv-hidden"); }
}

function showRecord(flag) { return flag; }

function setLastClick(name, estado) {
var el = $("lastClick");
var d = new Date();
var hora = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
if (el) { el.textContent = "Último clique: " + name + " às " + hora + " · Estado: " + (estado || "executado"); }
}
var ACOES = {
encerrar: { id: "btnEndMatch", texto: "Encerrar Partida", armado: "Confirmar encerramento?", nome: "Encerrar Partida" },
novoJogo: { id: "btnNewGame", texto: "Novo Jogo", armado: "Confirmar novo jogo?", nome: "Novo Jogo" },
novoConfronto: { id: "btnNewMatch", texto: "Novo Confronto", armado: "Confirmar novo confronto?", nome: "Novo Confronto" },
desfazer: { id: "btnUndo", texto: "Desfazer", armado: "Desfazer", nome: "Desfazer" }
};
function statusMsg(texto) {
var el = $("ctlFooter");
if (el) { el.textContent = texto; }
}
function restaurarTodosBotoesAcao() {
var chaves = ["encerrar", "novoJogo", "novoConfronto"];
for (var i = 0; i < chaves.length; i++) {
var b = $(ACOES[chaves[i]].id);
if (b) { b.textContent = ACOES[chaves[i]].texto; b.classList.remove("armed"); }
}
}
function atualizarBotaoArmado(acao) {
restaurarTodosBotoesAcao();
var b = $(ACOES[acao].id);
if (b) { b.textContent = ACOES[acao].armado + " (toque de novo)"; b.classList.add("armed"); }
}
function flashBotao(acao) {
var b = $(ACOES[acao].id);
if (!b) { return; }
b.classList.remove("pl-btn-flash");
void b.offsetWidth;
b.classList.add("pl-btn-flash");
}
function encerrarPartida() {
try {
if (state.partidaEncerrada) {
statusMsg("Partida já está encerrada. Use Iniciar próxima partida.");
return;
}
endMatch();
} catch (e) { logErr("encerrar: " + e.message); }
finally { renderAll(); }
}
function novoJogo() {
try { newGame(); } catch (e) { logErr("novo jogo: " + e.message); }
finally { renderAll(); }
}
function novoConfronto() {
try { openNovoConfronto(); } catch (e) { logErr("novo confronto: " + e.message); }
}
function desfazer() {
if (state.lastScoreStack.length === 0) {
statusMsg("Nada para desfazer: não há lançamentos anteriores.");
toastErr("Nada para desfazer.");
return;
}
undo();
}
function executarAcao(acao) {
flashBotao(acao);
if (acao === "encerrar") { encerrarPartida(); }
else if (acao === "novoJogo") { novoJogo(); }
else if (acao === "novoConfronto") { novoConfronto(); }
else if (acao === "desfazer") { desfazer(); }
}
var confirmacaoPendente = { acao: null, timerId: null };
function tratarCliqueAcao(acao) {
try {
if (acao === "novoJogo" && state && state.confrontoEncerrado) {
toastErr("Confronto encerrado. Inicie um novo confronto com outros jogadores.");
return;
}
if (acao === "novoConfronto") {
setLastClick("Novo Confronto", "jogadores");
openNovoConfronto();
return;
}
if (acao === "desfazer") {
setLastClick("Desfazer", "executado");
executarAcao(acao);
return;
}
if (confirmacaoPendente.acao === acao) {
if (confirmacaoPendente.timerId) { clearTimeout(confirmacaoPendente.timerId); }
confirmacaoPendente.acao = null;
confirmacaoPendente.timerId = null;
restaurarTodosBotoesAcao();
setLastClick(ACOES[acao].nome, "executado");
executarAcao(acao);
return;
}
if (confirmacaoPendente.timerId) { clearTimeout(confirmacaoPendente.timerId); }
confirmacaoPendente.acao = acao;
atualizarBotaoArmado(acao);
setLastClick(ACOES[acao].nome, "armado");
confirmacaoPendente.timerId = setTimeout(function () {
confirmacaoPendente.acao = null;
confirmacaoPendente.timerId = null;
restaurarTodosBotoesAcao();
setLastClick(ACOES[acao].nome, "cancelado (tempo esgotado)");
}, 4000);
} catch (e) { logErr("ação " + acao + ": " + e.message); }
}

function confirmLabelEnd() { return "Confirmar encerramento?"; }
function confirmLabelNewGame() {
if (state.points[0] + state.points[1] > 0 && !state.partidaEncerrada) {
return "ATENÇÃO: partida em andamento. Toque para zerar";
}
return "Confirmar novo jogo? Zera o placar";
}
function confirmLabelNewMatch() {
if (totalMatchesWon() > 0 && !state.confrontoEncerrado) {
return "ATENÇÃO: confronto em andamento. Toque para zerar tudo";
}
return "Confirmar novo confronto? Zera tudo";
}

function toastOk(m) { try { toast(m, { type: "success" }); } catch (e) { logErr("toast: " + e.message); } }
function toastErr(m) { try { toast(m, { type: "error" }); } catch (e) { logErr("toast: " + e.message); } }

function renderButtons() {
var containers = [$("btns1"), $("btns2")];
for (var c = 0; c < 2; c++) {
var box = containers[c];
if (!box || box.childNodes.length > 0) { continue; }
for (var i = 0; i < 7; i++) {
(function (idx, val) {
var b = document.createElement("button");
b.type = "button";
b.className = "pl-pbtn " + PBTN_CLASS[val - 1];
b.textContent = "+" + val;
b.title = "Somar " + val + " ponto" + (val > 1 ? "s" : "") + " para " + state.names[idx];
b.setAttribute("aria-label", "Somar " + val + " pontos para " + state.names[idx]);
b.addEventListener("click", function (ev) {
if (ev && ev.stopPropagation) { ev.stopPropagation(); }
addPoints(idx, val);
});
box.appendChild(b);
})(c, SCORE_VALUES[i]);
}
}
}

function renderControl() {
if (!state) { return; }
var ids = ["1", "2"];
for (var i = 0; i < 2; i++) {
var n = i + 1;
var pl = $("pl" + n);
var nm = $("name" + n);
if (nm && document.activeElement !== nm && nm.value !== state.names[i]) { nm.value = state.names[i]; }
var sc = $("score" + n);
if (sc) { sc.textContent = state.points[i]; }
var w = $("wins" + n); if (w) { w.textContent = state.wins[i]; }
var t = $("time" + n); if (t) { t.textContent = fmtTime(displayTimes(i)); }
var mx = $("max" + n); if (mx) { mx.textContent = state.maxBreak[i]; }
var cu = $("cur" + n); if (cu) { cu.textContent = state.curBreak[i]; }
if (pl) {
pl.className = "pl-player" + (state.jogadorNaJogada === i && state.jogadaAtiva ? " hot" : "") + (state.jogadorNaJogada >= 0 && state.jogadorNaJogada !== i ? " dim" : "");
}
var allowed = isScoringAllowed(i);
var btns = $("btns" + n);
if (btns) {
var children = btns.childNodes;
for (var k = 0; k < children.length; k++) {
children[k].disabled = !allowed;
}
}
var minus = $("minus" + n);
if (minus) { minus.disabled = !allowed; }
}
var turn = $("badgeTurn");
if (turn) {
turn.textContent = state.jogadorNaJogada >= 0 ? "Na jogada: " + state.names[state.jogadorNaJogada] : "Ninguém na jogada";
}
var pause = $("badgePause");
if (pause) { pause.textContent = state.jogadaPausada ? "Jogada pausada" : "Jogada ativa"; }
var pauseBtn = $("btnPause");
if (pauseBtn) { pauseBtn.textContent = state.jogadaPausada ? "Retomar jogada" : "Pausar jogada"; }
var mb = $("badgeMatch");
if (mb) { mb.textContent = "Partida " + state.numeroPartidaAtual + " de " + state.melhorDe; }
var fmt = $("ctlFormatBadge"); if (fmt) { fmt.textContent = "Melhor de " + state.melhorDe; }
var rb = $("ctlRoomBadge"); if (rb) { rb.textContent = "Sala: " + state.room; }
var sub = $("ctlSubtitle"); if (sub) { sub.textContent = "Sala: " + state.room + " · Melhor de " + state.melhorDe; }
var sb = $("ctlSyncBadge");
if (sb) {
if (apiOk || bcOk) { sb.textContent = "Sincronizado"; sb.className = "pl-badge ok"; }
else { sb.textContent = "Sem sincronização"; sb.className = "pl-badge err"; }
}
var cfgFormat = $("cfgFormat");
if (cfgFormat && document.activeElement !== cfgFormat) { cfgFormat.value = String(state.melhorDe); }
var hc = $("histCount");
if (hc) {
var all = loadHist();
hc.textContent = all.length + (all.length === 1 ? " confronto registrado" : " confrontos registrados");
}
var nextBtn = $("btnNextMatch");
if (nextBtn) {
var showNext = state.partidaEncerrada && !state.confrontoEncerrado;
nextBtn.classList.toggle("pl-hidden", !showNext);
nextBtn.disabled = !!state.confrontoEncerrado;
}
var endBtn = $("btnEndMatch");
if (endBtn) { endBtn.classList.toggle("pl-hidden", state.confrontoEncerrado); endBtn.disabled = state.partidaEncerrada || state.confrontoEncerrado; }
var newGameBtn = $("btnNewGame");
if (newGameBtn) {
newGameBtn.disabled = !!state.confrontoEncerrado;
newGameBtn.classList.toggle("pl-hidden", state.confrontoEncerrado);
}
var newMatchBtn = $("btnNewMatch");
if (newMatchBtn) {
ACOES.novoConfronto.texto = state.confrontoEncerrado ? "Iniciar novo confronto" : "Novo Confronto";
if (!newMatchBtn.classList.contains("armed")) { newMatchBtn.textContent = ACOES.novoConfronto.texto; }
newMatchBtn.classList.toggle("act-red", !state.confrontoEncerrado);
newMatchBtn.classList.toggle("act-next", state.confrontoEncerrado);
}
var ftr = $("ctlFooter");
if (ftr && ftr.getAttribute("data-msg") !== "1") {
var msg;
if (state.confrontoEncerrado) { msg = "Confronto encerrado — inicie um novo confronto escolhendo os jogadores"; }
else if (state.partidaEncerrada) { msg = "Partida encerrada — clique em Iniciar próxima partida"; }
else if (state.jogadorNaJogada < 0 || !state.jogadaAtiva) { msg = "Clique no quadro de um jogador para iniciar o tempo"; }
else { msg = "Placar de Sinuca · Six-red · Dados sincronizados pelo servidor."; }
ftr.textContent = msg;
}
var undoBtn = $("btnUndo");
if (undoBtn) { undoBtn.disabled = state.lastScoreStack.length === 0 || !!state.confrontoEncerrado; }
renderHistTable();
renderDiag();
}

function renderHistTable() {
var body = $("histBody");
if (!body) { return; }
var all = loadHist();
var html = "";
if (all.length === 0) { html = '<tr><td colspan="5" class="pl-sub">Nenhum confronto encerrado ainda.</td></tr>'; }
for (var i = 0; i < all.length && i < 20; i++) {
var r = all[i];
html += "<tr><td>" + esc(r.data) + "</td><td>" + esc(r.nomes) + " " + esc(r.placar) + "</td><td>" + esc(r.formato) + "</td><td>" + esc(r.tempo) + "</td><td>" + esc(String(r.maior)) + "</td></tr>";
}
body.innerHTML = html;
}

function renderDiag() {
var box = $("diagBox");
if (!box || !state) { return; }
var counts = "J1 venceu " + state.wins[0] + ", J2 venceu " + state.wins[1] + ", partida atual " + state.numeroPartidaAtual + " de " + state.melhorDe;
var lines = [
"partidaEncerrada: " + (state.partidaEncerrada ? "sim" : "não") + " · confrontoEncerrado: " + (state.confrontoEncerrado ? "sim" : "não") + " · jogadorNaJogada: " + (state.jogadorNaJogada >= 0 ? state.names[state.jogadorNaJogada] : "nenhum") + " · jogadaPausada: " + (state.jogadaPausada ? "sim" : "não") + " · numeroPartidaAtual: " + state.numeroPartidaAtual,
"Modo ativo: " + MODE,
"Tela: " + window.innerWidth + " x " + window.innerHeight,
"Servidor: " + (apiOk || bcOk ? "sincronizado" : "indisponível"),
"Partida: " + (MATCH_SLUG || "—"),
"Partida encerrada: " + (state.partidaEncerrada ? "sim" : "não"),
"Confronto encerrado: " + (state.confrontoEncerrado ? "sim" : "não"),
"Tempo total da partida: " + fmtTime(computeMatchTime()),
"Tempo J1: " + fmtTime(displayTimes(0)) + " · Tempo J2: " + fmtTime(displayTimes(1)),
"Jogador na jogada: " + (state.jogadorNaJogada >= 0 ? state.names[state.jogadorNaJogada] : "nenhum"),
"Jogada pausada: " + (state.jogadaPausada ? "sim" : "não"),
"Contador: " + counts,
"Enviando para a TV: " + state.names[0] + " " + state.points[0] + " x " + state.points[1] + " " + state.names[1] + " · " + fmtTime(computeMatchTime()),
"Nomes sincronizados: J1=" + state.names[0] + " · J2=" + state.names[1]
];
box.innerHTML = lines.join("<br>");
var errBox = $("diagErrors");
if (errBox) {
errBox.innerHTML = errors.length ? "Erros: " + errors.map(esc).join(" | ") : "Nenhum erro capturado.";
}
}

function renderTv() {
if (!state) { return; }
var evName = MATCH_INFO && MATCH_INFO.event ? MATCH_INFO.event.name : "";
var mesaName = MATCH_INFO && MATCH_INFO.mesa ? MATCH_INFO.mesa.name : (state.room || "");
var evEl = $("tvEvent"); if (evEl) { evEl.textContent = evName || "Campeonato"; }
var mesaEl = $("tvMesaName"); if (mesaEl) { mesaEl.textContent = mesaName || "Mesa"; }
var top = $("tvTop");
if (top) {
top.innerHTML = "Melhor de " + state.melhorDe + " · Partida " + state.numeroPartidaAtual + " de " + state.melhorDe + " · Tempo: <span class=\"tv-time\" id=\"tvTime\">" + fmtTime(computeMatchTime()) + "</span>";
}
var tt = $("tvTime"); if (tt) { tt.textContent = fmtTime(computeMatchTime()); }
for (var i = 0; i < 2; i++) {
var n = i + 1;
var nm = $("tvNomeJ" + n); if (nm) { nm.textContent = (state.names[i] && state.names[i].length > 0) ? state.names[i] : ("JOGADOR " + n); }
var sc = $("tvScore" + n); if (sc) { sc.textContent = state.points[i]; }
var w = $("tvWins" + n); if (w) { w.textContent = state.wins[i]; }
var pt = $("tvPTime" + n); if (pt) { pt.textContent = fmtTime(displayTimes(i)); }
var mx = $("tvMax" + n); if (mx) { mx.textContent = state.maxBreak[i]; }
var pl = $("tvP" + n);
if (pl) {
var hot = state.jogadorNaJogada === i && state.jogadaAtiva && !state.partidaEncerrada && !state.jogadaPausada;
pl.className = "tv-player" + (hot ? " hot" : "") + (state.jogadorNaJogada >= 0 && state.jogadorNaJogada !== i ? " dim" : "");
}
}
var st = $("tvStatus");
if (st) {
var msg;
if (state.confrontoEncerrado) { msg = "Confronto encerrado"; }
else if (state.partidaEncerrada) { msg = "Partida encerrada — aguardando próxima"; }
else if (state.jogadaPausada) { msg = "JOGADA PAUSADA"; }
else if (state.jogadorNaJogada >= 0 && state.jogadaAtiva) { msg = "Vez de " + state.names[state.jogadorNaJogada]; }
else { msg = "Clique no quadro de um jogador para começar"; }
st.textContent = msg;
}
var win = $("tvWinner");
if (win) {
if (state.confrontoEncerrado) {
var wi = state.wins[0] > state.wins[1] ? 0 : 1;
var wName = state.names[wi] || (wi === 0 ? "JOGADOR 1" : "JOGADOR 2");
$("tvWinnerTitle").textContent = wName;
$("tvWinnerScore").textContent = state.wins[0] + " × " + state.wins[1];
win.classList.remove("tv-hidden");
} else {
win.classList.add("tv-hidden");
}
}

}

function renderAll() {
if (MODE === "control") { renderControl(); }
else { renderTv(); renderTvHistoryIfOpen(); }
}

function renderTvHistoryIfOpen() {
var h = $("tvHistory");
if (!h || h.classList.contains("tv-hidden")) { return; }
renderTvHistory();
}

function renderTvHistory() {
var h = $("tvHistory");
if (!h) { return; }
var all = loadHist().slice(0, 10);
var rows = "";
for (var i = 0; i < all.length; i++) {
var r = all[i];
rows += "<tr><td>" + esc(r.data) + "</td><td>" + esc(r.placar) + "</td><td>" + esc(r.formato) + "</td><td>" + esc(r.pontos) + "</td><td>" + esc(r.tempo) + "</td><td>" + esc(String(r.maior)) + "</td></tr>";
}
if (!rows) { rows = '<tr><td colspan="6">Nenhum confronto registrado.</td></tr>'; }
h.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:8px;">Últimos confrontos</div><table><thead><tr><th>Data</th><th>Placar</th><th>Formato</th><th>Pontos</th><th>Tempo</th><th>Maior</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function toggleTvHistory(force) {
var h = $("tvHistory");
if (!h) { return; }
var open = force === true ? true : (force === false ? false : h.classList.contains("tv-hidden"));
if (open) {
renderTvHistory();
h.classList.remove("tv-hidden");
if (histTimer) { clearTimeout(histTimer); }
histTimer = setTimeout(function () { h.classList.add("tv-hidden"); histTimer = null; }, 30000);
} else {
h.classList.add("tv-hidden");
if (histTimer) { clearTimeout(histTimer); histTimer = null; }
}
}

function requestFullscreen() {
var el = document.documentElement;
try {
var p = el.requestFullscreen ? el.requestFullscreen() : (el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null);
if (p && p.catch) {
p.catch(function () { showFsFallback(true); });
} else if (!p) { showFsFallback(true); }
} catch (e) { logErr("tela cheia: " + e.message); showFsFallback(true); }
}
function showFsFallback(show) {
var b = $("tvFsFallback");
if (!b) { return; }
if (show) { b.classList.remove("tv-hidden"); } else { b.classList.add("tv-hidden"); }
}
function requestWakeLock() {
try {
if (navigator.wakeLock && navigator.wakeLock.request) {
navigator.wakeLock.request("screen").catch(function (e) { logErr("wake lock: " + e.message); });
}
} catch (e) { logErr("wake lock: " + e.message); }
}

function bumpCursor() {
var root = $("viewTv");
if (!root) { return; }
root.classList.remove("hide-cursor");
if (cursorTimer) { clearTimeout(cursorTimer); }
cursorTimer = setTimeout(function () { root.classList.add("hide-cursor"); }, 3000);
}

function enterTv() {
MODE = "tv";
var c = $("viewControl"); if (c) { c.classList.add("tv-hidden"); }
var t = $("viewTv"); if (t) { t.classList.remove("tv-hidden"); }
var app = $("appRoot"); if (app) { app.style.background = "#0f1115"; }
renderTv();
requestFullscreen();
requestWakeLock();
bumpCursor();
}
function enterControl() {
MODE = "control";
var c = $("viewControl"); if (c) { c.classList.remove("tv-hidden"); }
var t = $("viewTv"); if (t) { t.classList.add("tv-hidden"); }
toggleTvHistory(false);
renderControl();
}

function detectMode() {
var q = "";
try { q = window.location.search || ""; } catch (e) { q = ""; }
if (/[?&]modo=tv(&|$)/.test(q) || /[?&]tv=1(&|$)/.test(q)) { return "tv"; }
if (window.innerWidth >= 1200) { return "tv"; }
return "control";
}

function bindControls() {
if (bound) { return; }
bound = true;
var b;
b = $("btnPainel"); if (b) { b.addEventListener("click", function () { window.location.href = "/"; }); }
b = $("btnLog"); if (b) { b.addEventListener("click", function () { if (MATCH_SLUG) { window.location.href = "/p/" + MATCH_SLUG + "/log"; } }); }
b = $("btnResultado"); if (b) { b.addEventListener("click", function () { if (MATCH_INFO && MATCH_INFO.urls) { window.location.href = MATCH_INFO.urls.resultado; } }); }
b = $("btnModeTv"); if (b) { b.addEventListener("click", function () { window.location.href = tvUrl(); }); }
b = $("btnOpenTv");
if (b) {
b.addEventListener("click", function () {
try { window.open(tvUrl(), "_blank"); }
catch (e) { logErr("abrir TV: " + e.message); }
});
}
b = $("ncCancel"); if (b) { b.addEventListener("click", function () { closeNovoConfronto(); }); }
b = $("ncOk"); if (b) { b.addEventListener("click", function () { confirmNovoConfronto(); }); }
var dlg = $("dlgNovoConfronto");
if (dlg) {
dlg.addEventListener("click", function (ev) { if (ev.target === dlg) { closeNovoConfronto(); } });
}
b = $("tvBtnFull"); if (b) { b.addEventListener("click", function () { requestFullscreen(); }); }
var p1 = $("pl1"); if (p1) { p1.addEventListener("click", function () { selectPlayer(0); }); }
var p2 = $("pl2"); if (p2) { p2.addEventListener("click", function () { selectPlayer(1); }); }
var tp1 = $("tvP1"); if (tp1) { tp1.addEventListener("click", function () { if (MODE === "tv") { return; } selectPlayer(0); }); }
var tp2 = $("tvP2"); if (tp2) { tp2.addEventListener("click", function () { if (MODE === "tv") { return; } selectPlayer(1); }); }
var mi1 = $("minus1"); if (mi1) { mi1.addEventListener("click", function (ev) { ev.stopPropagation(); if (state.jogadorNaJogada === 0) { minusOne(); } }); }
var mi2 = $("minus2"); if (mi2) { mi2.addEventListener("click", function (ev) { ev.stopPropagation(); if (state.jogadorNaJogada === 1) { minusOne(); } }); }
var nm1 = $("name1"); if (nm1) { nm1.readOnly = true; nm1.addEventListener("click", function (ev) { ev.stopPropagation(); }); }
var nm2 = $("name2"); if (nm2) { nm2.readOnly = true; nm2.addEventListener("click", function (ev) { ev.stopPropagation(); }); }
b = $("btnManual"); if (b) { b.addEventListener("click", function () { setManual(); }); }
b = $("btnPause"); if (b) { b.addEventListener("click", function () { togglePause(); }); }

b = $("btnApplyCfg"); if (b) { b.addEventListener("click", function () { applyConfig(); }); }
b = $("btnExportCsv"); if (b) { b.addEventListener("click", function () { exportCsv(); }); }
b = $("btnClearHist");
if (b) {
b.addEventListener("click", function () {
toastErr("O histórico fica gravado no servidor por mesa.");
});
}
try {
var mapaBotoes = { encerrar: "btnEndMatch", novoJogo: "btnNewGame", novoConfronto: "btnNewMatch", desfazer: "btnUndo" };
for (var acaoKey in mapaBotoes) {
(function (chave, id) {
try {
var btn = $(id);
if (btn) { btn.onclick = function () { tratarCliqueAcao(chave); }; }
else { logErr("botão ausente: " + id); }
} catch (e) { logErr("ligação " + id + ": " + e.message); }
})(acaoKey, mapaBotoes[acaoKey]);
}
} catch (e) { logErr("ligação de ações: " + e.message); }
b = $("btnNextMatch");
if (b) { b.addEventListener("click", function () { startNextMatch(); }); }
document.addEventListener("keydown", function (ev) {
if (MODE === "tv" && (ev.key === "Escape")) { toggleTvHistory(false); }
});
window.addEventListener("mousemove", function () { if (MODE === "tv") { bumpCursor(); } });
}

function exportCsv() {
var all = loadHist();
var lines = ["Data;Jogador 1;Jogador 2;Placar;Formato;Pontos;Tempo total;Maior tacada"];
for (var i = 0; i < all.length; i++) {
var r = all[i];
var nomes = String(r.nomes).split(" x ");
lines.push([r.data, nomes[0] || "", nomes[1] || "", r.placar, r.formato, r.pontos, r.tempo, r.maior].map(function (v) {
return '"' + String(v).replace(/"/g, '""') + '"';
}).join(";"));
}
var csv = "\uFEFF" + lines.join("\r\n");
try {
var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
var url = URL.createObjectURL(blob);
var a = document.createElement("a");
a.href = url;
a.download = "confrontos-sinuca.csv";
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
toastOk("CSV exportado.");
} catch (e) { logErr("exportar CSV: " + e.message); toastErr("Não foi possível exportar."); }
}

function startTicker() {
if (tickTimer) { clearInterval(tickTimer); }
tickTimer = setInterval(function () {
if (!state) { return; }
if (MODE === "control") {
renderControl();
sendState();
} else {
renderTv();
renderTvHistoryIfOpen();
}
}, 1000);
}

function applyMatchBundle(data) {
MATCH_INFO = data;
state = data.state;
ROOM = data.mesa.name;
state.room = ROOM;
state.names = [data.player1.name, data.player2.name];
state.melhorDe = data.match.melhor_de;
if (!state.history) { state.history = []; }
if (!state.lastScoreStack) { state.lastScoreStack = []; }
if (!state.maxBreak) { state.maxBreak = [0, 0]; }
if (!state.curBreak) { state.curBreak = [0, 0]; }
if (!state.times) { state.times = [0, 0]; }
if (!state.wins) { state.wins = [0, 0]; }
if (!state.points) { state.points = [0, 0]; }
}

async function init(modeWanted) {
MODE = modeWanted === "tv" ? "tv" : "control";
try {
var data = await api.partida(MATCH_SLUG);
applyMatchBundle(data);
} catch (e) {
logErr("estado inicial: " + e.message);
throw e;
}
try { await refreshHist(); } catch (e) { logErr("histórico: " + e.message); }
try { if (MODE !== "tv") { await loadTacadas(); } } catch (e) { logErr("tacadas: " + e.message); }
try { setupSync(); } catch (e) { logErr("sincronização: " + e.message); }
try { renderButtons(); } catch (e) { logErr("botões de pontos: " + e.message); }
try { bindControls(); } catch (e) { logErr("controles: " + e.message); }
try {
if (MODE === "tv") { enterTv(); } else { enterControl(); }
} catch (e) { logErr("modo: " + e.message); }
try { renderAll(); } catch (e) { logErr("render: " + e.message); }
try { startTicker(); } catch (e) { logErr("cronômetro: " + e.message); }
try {
var cfgRoom = $("cfgRoom");
if (cfgRoom) { cfgRoom.value = ROOM; cfgRoom.readOnly = true; }
var nm1 = $("name1"); if (nm1) { nm1.readOnly = true; }
var nm2 = $("name2"); if (nm2) { nm2.readOnly = true; }
var dbg = $("ctlFooter");
if (dbg) { dbg.textContent = "Placar de Sinuca · Six-red · " + ROOM + " · " + MATCH_INFO.player1.name + " x " + MATCH_INFO.player2.name; }
} catch (e) { logErr("rodapé: " + e.message); }
}

function tvUrl() {
if (MATCH_INFO && MATCH_INFO.urls && MATCH_INFO.urls.tvMesa) { return MATCH_INFO.urls.tvMesa; }
if (MATCH_SLUG) { return "/p/" + MATCH_SLUG + "/tv"; }
return "/";
}

async function syncMesaTv() {
if (!mesaWatchSlug) { return; }
var data = await api.mesa(mesaWatchSlug);
var live = data.current && data.current.match ? data.current.match.slug : "";
var latest = data.matches && data.matches[0] ? data.matches[0].slug : "";
var slug = live || MATCH_SLUG || latest;
if (!slug) {
MATCH_SLUG = "";
MATCH_INFO = { event: data.event, mesa: data.mesa, urls: data.urls };
state = defaultState();
state.room = data.mesa.name;
state.names = ["—", "—"];
MODE = "tv";
enterTv();
var st = $("tvStatus");
if (st) { st.textContent = "Aguardando confronto nesta mesa"; }
return;
}
if (slug !== MATCH_SLUG) { await startScoreboard(slug, "tv"); }
}

export async function startMesaTv(mesaSlug) {
stopMesaWatch();
mesaWatchSlug = mesaSlug;
await syncMesaTv();
mesaWatchTimer = setInterval(function () {
syncMesaTv().catch(function () {});
}, 2500);
}

export function stopMesaWatch() {
if (mesaWatchTimer) { clearInterval(mesaWatchTimer); mesaWatchTimer = null; }
mesaWatchSlug = "";
}

export async function startScoreboard(slug, modeWanted) {
stopScoreboard();
MATCH_SLUG = slug;
started = true;
errors = [];
await init(modeWanted);
}

export function stopScoreboard() {
started = false;
if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
closeSse();
if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
if (armTimer) { clearTimeout(armTimer); armTimer = null; }
if (armInterval) { clearInterval(armInterval); armInterval = null; }
if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
if (winnerTimer) { clearTimeout(winnerTimer); winnerTimer = null; }
if (histTimer) { clearTimeout(histTimer); histTimer = null; }
MATCH_SLUG = "";
MATCH_INFO = null;
state = null;
tacadas = [];
}
