import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  stmts,
  uid,
  now,
  hashPassword,
  verifyPassword,
  publicUser,
  defaultMatchState,
  parseState
} from "./db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const PORT = Number(process.env.PORT) || 8010;
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const FATAL_BIND = 2;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

const sseClients = new Map();
const loginHits = new Map();

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        req.destroy();
        reject(new Error("body"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("json"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  String(raw).split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, token, maxAge) {
  const parts = [
    "tc=" + encodeURIComponent(token),
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=" + maxAge
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

function auth(req) {
  stmts.purgeSessions.run(now());
  const token = parseCookies(req).tc;
  if (!token) return null;
  const row = stmts.sessionUser.get(token, now());
  return row ? { token, user: publicUser(row), full: row } : null;
}

function requireUser(req, res) {
  const session = auth(req);
  if (!session) {
    error(res, 401, "Não autenticado.");
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireUser(req, res);
  if (!session) return null;
  if (session.user.role !== "admin") {
    error(res, 403, "Apenas administradores.");
    return null;
  }
  return session;
}

function trimStr(v, max) {
  return String(v == null ? "" : v).replace(/^\s+|\s+$/g, "").slice(0, max);
}

function validName(v, min, max) {
  const s = trimStr(v, max);
  return s.length >= min ? s : null;
}

function validFormat(v) {
  const n = Number(v);
  return [1, 3, 5, 7].includes(n) ? n : null;
}

function validUsername(v) {
  const s = trimStr(v, 32);
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(s)) return null;
  return s;
}

function validPassword(v) {
  const s = String(v == null ? "" : v);
  return s.length >= 4 && s.length <= 72 ? s : null;
}

function eventOf(idOrSlug) {
  return stmts.eventByIdOrSlug.get(idOrSlug, idOrSlug);
}

function matchBundle(match) {
  if (!match) return null;
  const event = stmts.eventById.get(match.event_id);
  const mesa = stmts.mesaById.get(match.mesa_id);
  const player1 = stmts.playerById.get(match.player1_id);
  const player2 = stmts.playerById.get(match.player2_id);
  const st = stmts.getState.get(match.id);
  let state = st ? parseState(st.state_json) : null;
  if (!state) state = defaultMatchState(mesa.name, match.melhor_de, player1.name, player2.name);
  state.names = [player1.name, player2.name];
  state.room = mesa.name;
  state.melhorDe = match.melhor_de;
  return {
    match,
    event,
    mesa,
    player1,
    player2,
    state,
    urls: {
      controle: "/p/" + match.slug,
      tv: "/p/" + match.slug + "/tv",
      tvMesa: "/m/" + mesa.slug + "/tv",
      log: "/p/" + match.slug + "/log",
      resultado: "/m/" + mesa.slug + "/resultado",
      mesa: "/m/" + mesa.slug,
      evento: "/e/" + event.slug
    }
  };
}

function mesaResultado(mesa) {
  const event = stmts.eventById.get(mesa.event_id);
  const matches = stmts.matchesByMesa.all(mesa.id).map((m) => {
    const b = matchBundle(m);
    const s = b.state;
    const winner =
      s.confrontoEncerrado
        ? s.wins[0] === s.wins[1]
          ? "empate"
          : s.wins[0] > s.wins[1]
            ? b.player1.name
            : b.player2.name
        : null;
    return {
      id: m.id,
      slug: m.slug,
      status: m.status,
      melhor_de: m.melhor_de,
      created_at: m.created_at,
      started_at: m.started_at,
      finished_at: m.finished_at,
      player1: b.player1.name,
      player2: b.player2.name,
      wins: s.wins,
      points: s.points,
      maxBreak: s.maxBreak,
      numeroPartidaAtual: s.numeroPartidaAtual,
      confrontoEncerrado: s.confrontoEncerrado,
      winner,
      urls: b.urls
    };
  });
  const current = stmts.liveOnMesa.get(mesa.id);
  return {
    mesa,
    event,
    current: current ? matchBundle(current) : null,
    matches,
    urls: {
      mesa: "/m/" + mesa.slug,
      resultado: "/m/" + mesa.slug + "/resultado",
      evento: "/e/" + event.slug,
      tv: "/m/" + mesa.slug + "/tv"
    }
  };
}

function pushState(slug, state) {
  const set = sseClients.get(slug);
  if (!set || !set.size) return;
  const payload = "data: " + JSON.stringify({ type: "state", state }) + "\n\n";
  for (const client of set) {
    try {
      client.write(payload);
    } catch {
      set.delete(client);
    }
  }
}

function addSse(slug, res) {
  if (!sseClients.has(slug)) sseClients.set(slug, new Set());
  sseClients.get(slug).add(res);
  res.on("close", () => {
    const set = sseClients.get(slug);
    if (set) {
      set.delete(res);
      if (!set.size) sseClients.delete(slug);
    }
  });
}

function logMatch(matchId, type, message, payload, actorId) {
  stmts.insertLog.run(
    matchId,
    now(),
    type,
    String(message || "").slice(0, 400),
    payload ? JSON.stringify(payload) : null,
    actorId || null
  );
}

function tooManyLogins(ip) {
  const t = now();
  const rec = loginHits.get(ip) || { n: 0, t };
  if (t - rec.t > 10 * 60 * 1000) {
    rec.n = 0;
    rec.t = t;
  }
  rec.n += 1;
  loginHits.set(ip, rec);
  return rec.n > 12;
}

function clientIp(req) {
  return String(req.socket.remoteAddress || "local");
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (method === "POST" && path === "/api/login") {
    if (tooManyLogins(clientIp(req))) return error(res, 429, "Muitas tentativas. Aguarde.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const username = validUsername(body && body.username);
    const password = String((body && body.password) || "");
    const row = username ? stmts.userByName.get(username) : null;
    if (!row || !verifyPassword(password, row.password_hash)) {
      return error(res, 401, "Usuário ou senha inválidos.");
    }
    const token = uid(24);
    stmts.insertSession.run(token, row.id, now(), now() + SESSION_MS);
    setCookie(res, token, SESSION_MS / 1000);
    return json(res, 200, { user: publicUser(row) });
  }

  if (method === "POST" && path === "/api/logout") {
    const session = auth(req);
    if (session) stmts.deleteSession.run(session.token);
    setCookie(res, "", 0);
    return json(res, 200, { ok: true });
  }

  if (method === "GET" && path === "/api/me") {
    const session = auth(req);
    return json(res, 200, { user: session ? session.user : null });
  }

  if (method === "GET" && path === "/api/stats") {
    if (!requireUser(req, res)) return;
    return json(res, 200, stmts.stats.get());
  }

  if (path === "/api/users" && method === "GET") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { users: stmts.users.all() });
  }

  if (path === "/api/users" && method === "POST") {
    if (!requireAdmin(req, res)) return;
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const username = validUsername(body && body.username);
    const password = validPassword(body && body.password);
    const role = body && body.role === "admin" ? "admin" : "user";
    if (!username) return error(res, 400, "Usuário inválido (3–32, letras, números, . _ -).");
    if (!password) return error(res, 400, "Senha deve ter ao menos 4 caracteres.");
    try {
      const id = uid(12);
      stmts.insertUser.run(id, username, hashPassword(password), role, now());
      return json(res, 201, { user: stmts.users.all().find((u) => u.id === id) });
    } catch {
      return error(res, 409, "Usuário já existe.");
    }
  }

  let m;

  m = /^\/api\/users\/([^/]+)$/.exec(path);
  if (m && method === "PATCH") {
    if (!requireAdmin(req, res)) return;
    const row = stmts.userById.get(m[1]);
    if (!row) return error(res, 404, "Usuário não encontrado.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const username = body.username != null ? validUsername(body.username) : null;
    if (body.username != null && !username) return error(res, 400, "Usuário inválido.");
    const role = body.role == null ? null : body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
    if (body.role != null && !role) return error(res, 400, "Papel inválido.");
    let hash = null;
    if (body.password) {
      const password = validPassword(body.password);
      if (!password) return error(res, 400, "Senha deve ter ao menos 4 caracteres.");
      hash = hashPassword(password);
    }
    if (row.role === "admin" && role === "user") {
      const admins = stmts.users.all().filter((u) => u.role === "admin");
      if (admins.length <= 1) return error(res, 400, "Não é possível remover o último admin.");
    }
    try {
      stmts.updateUser.run(username, role, hash, row.id);
    } catch {
      return error(res, 409, "Usuário já existe.");
    }
    return json(res, 200, { user: publicUser(stmts.userById.get(row.id)) });
  }

  if (m && method === "DELETE") {
    const session = requireAdmin(req, res);
    if (!session) return;
    const row = stmts.userById.get(m[1]);
    if (!row) return error(res, 404, "Usuário não encontrado.");
    if (row.id === session.user.id) return error(res, 400, "Não é possível excluir o próprio usuário.");
    if (row.role === "admin") {
      const admins = stmts.users.all().filter((u) => u.role === "admin");
      if (admins.length <= 1) return error(res, 400, "Não é possível remover o último admin.");
    }
    stmts.deleteUser.run(row.id);
    return json(res, 200, { ok: true });
  }

  if (path === "/api/eventos" && method === "GET") {
    if (!requireUser(req, res)) return;
    const events = stmts.events.all().map((ev) => ({
      ...ev,
      mesas: stmts.mesasByEvent.all(ev.id).length,
      jogadores: stmts.playersByEvent.all(ev.id).length,
      partidas: stmts.matchesByEvent.all(ev.id).length,
      url: "/e/" + ev.slug
    }));
    return json(res, 200, { events });
  }

  if (path === "/api/eventos" && method === "POST") {
    const session = requireUser(req, res);
    if (!session) return;
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = validName(body && body.name, 2, 80);
    const melhorDe = validFormat(body && body.melhor_de) || 3;
    const notes = trimStr(body && body.notes, 400);
    if (!name) return error(res, 400, "Informe o nome do evento.");
    const id = uid(12);
    const slug = uid(10);
    stmts.insertEvent.run(id, name, slug, melhorDe, "ativo", notes, session.user.id, now());
    return json(res, 201, { event: stmts.eventById.get(id) });
  }

  m = /^\/api\/eventos\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    const ev = eventOf(decodeURIComponent(m[1]));
    if (!ev) return error(res, 404, "Evento não encontrado.");
    return json(res, 200, {
      event: ev,
      mesas: stmts.mesasByEvent.all(ev.id),
      jogadores: stmts.playersByEvent.all(ev.id),
      partidas: stmts.matchesByEvent.all(ev.id).map((row) => matchBundle(row)),
      urls: { evento: "/e/" + ev.slug }
    });
  }

  if (m && method === "PATCH") {
    if (!requireUser(req, res)) return;
    const ev = eventOf(decodeURIComponent(m[1]));
    if (!ev) return error(res, 404, "Evento não encontrado.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = body.name != null ? validName(body.name, 2, 80) : null;
    if (body.name != null && !name) return error(res, 400, "Nome inválido.");
    const melhorDe = body.melhor_de != null ? validFormat(body.melhor_de) : null;
    if (body.melhor_de != null && !melhorDe) return error(res, 400, "Formato inválido.");
    const status = body.status == null ? null : body.status === "encerrado" ? "encerrado" : "ativo";
    const notes = body.notes != null ? trimStr(body.notes, 400) : null;
    stmts.updateEvent.run(name, melhorDe, status, notes, ev.id);
    return json(res, 200, { event: stmts.eventById.get(ev.id) });
  }

  if (m && method === "DELETE") {
    if (!requireAdmin(req, res)) return;
    const ev = eventOf(decodeURIComponent(m[1]));
    if (!ev) return error(res, 404, "Evento não encontrado.");
    stmts.deleteEvent.run(ev.id);
    return json(res, 200, { ok: true });
  }

  m = /^\/api\/eventos\/([^/]+)\/mesas$/.exec(path);
  if (m && method === "POST") {
    if (!requireUser(req, res)) return;
    const ev = eventOf(decodeURIComponent(m[1]));
    if (!ev) return error(res, 404, "Evento não encontrado.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = validName(body && body.name, 1, 40);
    if (!name) return error(res, 400, "Informe o nome da mesa.");
    try {
      const id = uid(12);
      const slug = uid(10);
      stmts.insertMesa.run(id, ev.id, name, slug, now());
      return json(res, 201, { mesa: stmts.mesaById.get(id) });
    } catch {
      return error(res, 409, "Já existe uma mesa com esse nome neste evento.");
    }
  }

  m = /^\/api\/eventos\/([^/]+)\/jogadores$/.exec(path);
  if (m && method === "POST") {
    if (!requireUser(req, res)) return;
    const ev = eventOf(decodeURIComponent(m[1]));
    if (!ev) return error(res, 404, "Evento não encontrado.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = validName(body && body.name, 2, 40);
    if (!name) return error(res, 400, "Informe o nome do jogador.");
    try {
      const id = uid(12);
      stmts.insertPlayer.run(id, ev.id, name, now());
      return json(res, 201, { player: stmts.playerById.get(id) });
    } catch {
      return error(res, 409, "Jogador já cadastrado neste evento.");
    }
  }

  m = /^\/api\/mesas\/([^/]+)$/.exec(path);
  if (m && (method === "GET" || method === "PATCH" || method === "DELETE")) {
    const key = decodeURIComponent(m[1]);
    const mesa = stmts.mesaById.get(key) || stmts.mesaBySlug.get(key);
    if (!mesa) return error(res, 404, "Mesa não encontrada.");
    if (method === "GET") return json(res, 200, mesaResultado(mesa));
    if (!requireUser(req, res)) return;
    if (method === "DELETE") {
      const live = stmts.liveOnMesa.get(mesa.id);
      if (live && live.status === "ao_vivo") return error(res, 400, "Há partida ao vivo nesta mesa.");
      stmts.deleteMesa.run(mesa.id);
      return json(res, 200, { ok: true });
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = validName(body && body.name, 1, 40);
    if (!name) return error(res, 400, "Informe o nome da mesa.");
    try {
      stmts.updateMesa.run(name, mesa.id);
    } catch {
      return error(res, 409, "Já existe uma mesa com esse nome neste evento.");
    }
    return json(res, 200, { mesa: stmts.mesaById.get(mesa.id) });
  }

  m = /^\/api\/mesas\/([^/]+)\/resultado$/.exec(path);
  if (m && method === "GET") {
    const key = decodeURIComponent(m[1]);
    const mesa = stmts.mesaById.get(key) || stmts.mesaBySlug.get(key);
    if (!mesa) return error(res, 404, "Mesa não encontrada.");
    return json(res, 200, mesaResultado(mesa));
  }

  m = /^\/api\/jogadores\/([^/]+)$/.exec(path);
  if (m && (method === "PATCH" || method === "DELETE")) {
    if (!requireUser(req, res)) return;
    const player = stmts.playerById.get(decodeURIComponent(m[1]));
    if (!player) return error(res, 404, "Jogador não encontrado.");
    if (method === "DELETE") {
      const used = db.prepare("SELECT id FROM matches WHERE player1_id = ? OR player2_id = ? LIMIT 1").get(player.id, player.id);
      if (used) return error(res, 400, "Jogador já participa de partidas.");
      stmts.deletePlayer.run(player.id);
      return json(res, 200, { ok: true });
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const name = validName(body && body.name, 2, 40);
    if (!name) return error(res, 400, "Informe o nome do jogador.");
    try {
      stmts.updatePlayer.run(name, player.id);
    } catch {
      return error(res, 409, "Jogador já cadastrado neste evento.");
    }
    return json(res, 200, { player: stmts.playerById.get(player.id) });
  }

  if (path === "/api/partidas" && method === "POST") {
    const session = requireUser(req, res);
    if (!session) return;
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const mesa = stmts.mesaById.get(body && body.mesa_id);
    if (!mesa) return error(res, 400, "Mesa inválida.");
    const p1 = stmts.playerById.get(body && body.player1_id);
    const p2 = stmts.playerById.get(body && body.player2_id);
    if (!p1 || !p2) return error(res, 400, "Jogadores inválidos.");
    if (p1.event_id !== mesa.event_id || p2.event_id !== mesa.event_id) {
      return error(res, 400, "Jogadores e mesa devem ser do mesmo evento.");
    }
    if (p1.id === p2.id) return error(res, 400, "Escolha dois jogadores diferentes.");
    const live = stmts.liveOnMesa.get(mesa.id);
    if (live) return error(res, 409, "Esta mesa já tem uma partida em andamento.");
    const ev = stmts.eventById.get(mesa.event_id);
    const melhorDe = validFormat(body && body.melhor_de) || ev.melhor_de || 3;
    const id = uid(12);
    const slug = uid(10);
    const t = now();
    stmts.insertMatch.run(id, mesa.event_id, mesa.id, p1.id, p2.id, slug, melhorDe, "pendente", session.user.id, t);
    const state = defaultMatchState(mesa.name, melhorDe, p1.name, p2.name);
    stmts.insertState.run(id, JSON.stringify(state), t);
    logMatch(id, "criada", "Partida criada: " + p1.name + " x " + p2.name + " na " + mesa.name, null, session.user.id);
    return json(res, 201, matchBundle(stmts.matchById.get(id)));
  }

  m = /^\/api\/partidas\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    const match = stmts.matchBySlug.get(decodeURIComponent(m[1])) || stmts.matchById.get(decodeURIComponent(m[1]));
    if (!match) return error(res, 404, "Partida não encontrada.");
    return json(res, 200, matchBundle(match));
  }

  m = /^\/api\/partidas\/([^/]+)\/state$/.exec(path);
  if (m && method === "PUT") {
    const session = requireUser(req, res);
    if (!session) return;
    const match = stmts.matchBySlug.get(decodeURIComponent(m[1]));
    if (!match) return error(res, 404, "Partida não encontrada.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    if (!body || typeof body !== "object") return error(res, 400, "Estado inválido.");
    const p1 = stmts.playerById.get(match.player1_id);
    const p2 = stmts.playerById.get(match.player2_id);
    const mesa = stmts.mesaById.get(match.mesa_id);
    body.names = [p1.name, p2.name];
    body.room = mesa.name;
    if (body.melhorDe) {
      const fmt = validFormat(body.melhorDe);
      if (fmt) {
        body.melhorDe = fmt;
        stmts.updateMatchFormat.run(fmt, match.id);
      }
    }
    body.updatedAt = now();
    stmts.putState.run(JSON.stringify(body), body.updatedAt, match.id);
    let status = match.status;
    let started = null;
    let finished = null;
    if (body.confrontoEncerrado) {
      status = "encerrada";
      finished = now();
    } else if (body.jogadaAtiva || body.inicioPartida > 0 || (body.points && (body.points[0] || body.points[1]))) {
      status = "ao_vivo";
      if (!match.started_at) started = now();
    }
    if (status !== match.status || started || finished) {
      stmts.updateMatchStatus.run(status, started, finished, match.id);
    }
    pushState(match.slug, body);
    return json(res, 200, { ok: true, updatedAt: body.updatedAt, status });
  }

  m = /^\/api\/partidas\/([^/]+)\/logs$/.exec(path);
  if (m && method === "GET") {
    const match = stmts.matchBySlug.get(decodeURIComponent(m[1])) || stmts.matchById.get(decodeURIComponent(m[1]));
    if (!match) return error(res, 404, "Partida não encontrada.");
    const bundle = matchBundle(match);
    const logs = stmts.logsByMatch.all(match.id).map((row) => ({
      id: row.id,
      ts: row.ts,
      type: row.type,
      message: row.message,
      payload: parseState(row.payload),
      actor_id: row.actor_id
    }));
    return json(res, 200, { match: bundle, logs });
  }

  if (m && method === "POST") {
    const session = requireUser(req, res);
    if (!session) return;
    const match = stmts.matchBySlug.get(decodeURIComponent(m[1]));
    if (!match) return error(res, 404, "Partida não encontrada.");
    let body;
    try {
      body = await readBody(req);
    } catch {
      return error(res, 400, "JSON inválido.");
    }
    const type = trimStr(body && body.type, 40) || "evento";
    const message = trimStr(body && body.message, 400);
    if (!message) return error(res, 400, "Informe a mensagem do log.");
    logMatch(match.id, type, message, body.payload || null, session.user.id);
    const payload = "data: " + JSON.stringify({ type: "log" }) + "\n\n";
    const set = sseClients.get(match.slug);
    if (set) {
      for (const client of set) {
        try { client.write(payload); } catch { set.delete(client); }
      }
    }
    return json(res, 201, { ok: true });
  }

  m = /^\/api\/partidas\/([^/]+)\/stream$/.exec(path);
  if (m && method === "GET") {
    const match = stmts.matchBySlug.get(decodeURIComponent(m[1]));
    if (!match) return error(res, 404, "Partida não encontrada.");
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 2000\n\n");
    const bundle = matchBundle(match);
    res.write("data: " + JSON.stringify({ type: "state", state: bundle.state }) + "\n\n");
    addSse(match.slug, res);
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
    }, 25000);
    res.on("close", () => clearInterval(ping));
    return;
  }

  return error(res, 404, "API não encontrada.");
}

function safeFile(dir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const abs = normalize(join(dir, rel));
  const relTo = relative(dir, abs);
  if (relTo.startsWith("..") || relTo.includes("..")) return null;
  return abs;
}

function sendFile(res, file) {
  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const buf = readFileSync(file);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": extname(file) === ".html" ? "no-store" : "public, max-age=3600" });
  res.end(buf);
}

function sendIndex(res) {
  const index = join(distDir, "index.html");
  if (!existsSync(index)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Interface ainda não gerada. Execute iniciar.bat");
    return;
  }
  sendFile(res, index);
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", "http://" + host);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      error(res, 405, "Método não permitido.");
      return;
    }
    if (existsSync(distDir)) {
      const file = safeFile(distDir, url.pathname);
      if (file && existsSync(file) && statSync(file).isFile()) {
        sendFile(res, file);
        return;
      }
    }
    sendIndex(res);
  } catch (err) {
    if (!res.headersSent) error(res, 500, "Erro interno.");
    else res.end();
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    process.stderr.write("Porta " + PORT + " em uso.\n");
    process.exit(FATAL_BIND);
  }
  process.stderr.write(String(err && err.message ? err.message : err) + "\n");
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write("Tacada Certa  http://localhost:" + PORT + "\n");
});

export { FATAL_BIND };
