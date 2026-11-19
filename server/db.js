import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "tacada-certa.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  melhor_de INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mesas (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mesa_id TEXT NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  player1_id TEXT NOT NULL REFERENCES players(id),
  player2_id TEXT NOT NULL REFERENCES players(id),
  slug TEXT NOT NULL UNIQUE,
  melhor_de INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'ao_vivo', 'encerrada')),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS match_state (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT,
  actor_id TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_logs_match ON match_logs(match_id, ts);
CREATE INDEX IF NOT EXISTS idx_matches_mesa ON matches(mesa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`);

export function uid(len = 10) {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function now() {
  return Date.now();
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 2) return false;
  const test = scryptSync(password, parts[0], 64);
  const buf = Buffer.from(parts[1], "hex");
  if (test.length !== buf.length) return false;
  return timingSafeEqual(test, buf);
}

const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
if (countUsers.get().n === 0) {
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(uid(12), "admin", hashPassword("admin"), "admin", now());
}

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, created_at: row.created_at };
}

export function defaultMatchState(mesaName, melhorDe, name1, name2) {
  return {
    room: mesaName,
    melhorDe,
    names: [name1, name2],
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
    updatedAt: now()
  };
}

export function parseState(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const stmts = {
  userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  users: db.prepare("SELECT id, username, role, created_at FROM users ORDER BY username"),
  insertUser: db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"),
  updateUser: db.prepare("UPDATE users SET username = COALESCE(?, username), role = COALESCE(?, role), password_hash = COALESCE(?, password_hash) WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  insertSession: db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
  sessionUser: db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  eventById: db.prepare("SELECT * FROM events WHERE id = ?"),
  eventBySlug: db.prepare("SELECT * FROM events WHERE slug = ?"),
  eventByIdOrSlug: db.prepare("SELECT * FROM events WHERE id = ? OR slug = ?"),
  events: db.prepare("SELECT * FROM events ORDER BY created_at DESC"),
  insertEvent: db.prepare(
    "INSERT INTO events (id, name, slug, melhor_de, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ),
  updateEvent: db.prepare(
    "UPDATE events SET name = COALESCE(?, name), melhor_de = COALESCE(?, melhor_de), status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?"
  ),
  deleteEvent: db.prepare("DELETE FROM events WHERE id = ?"),
  mesasByEvent: db.prepare("SELECT * FROM mesas WHERE event_id = ? ORDER BY name"),
  mesaById: db.prepare("SELECT * FROM mesas WHERE id = ?"),
  mesaBySlug: db.prepare("SELECT * FROM mesas WHERE slug = ?"),
  insertMesa: db.prepare("INSERT INTO mesas (id, event_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)"),
  updateMesa: db.prepare("UPDATE mesas SET name = COALESCE(?, name) WHERE id = ?"),
  deleteMesa: db.prepare("DELETE FROM mesas WHERE id = ?"),
  playersByEvent: db.prepare("SELECT * FROM players WHERE event_id = ? ORDER BY name"),
  playerById: db.prepare("SELECT * FROM players WHERE id = ?"),
  insertPlayer: db.prepare("INSERT INTO players (id, event_id, name, created_at) VALUES (?, ?, ?, ?)"),
  updatePlayer: db.prepare("UPDATE players SET name = COALESCE(?, name) WHERE id = ?"),
  deletePlayer: db.prepare("DELETE FROM players WHERE id = ?"),
  matchesByEvent: db.prepare("SELECT * FROM matches WHERE event_id = ? ORDER BY created_at DESC"),
  matchesByMesa: db.prepare("SELECT * FROM matches WHERE mesa_id = ? ORDER BY created_at DESC"),
  matchById: db.prepare("SELECT * FROM matches WHERE id = ?"),
  matchBySlug: db.prepare("SELECT * FROM matches WHERE slug = ?"),
  liveOnMesa: db.prepare("SELECT * FROM matches WHERE mesa_id = ? AND status IN ('pendente', 'ao_vivo') ORDER BY created_at DESC LIMIT 1"),
  insertMatch: db.prepare(
    `INSERT INTO matches (id, event_id, mesa_id, player1_id, player2_id, slug, melhor_de, status, created_by, created_at, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  ),
  updateMatchStatus: db.prepare("UPDATE matches SET status = ?, started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at) WHERE id = ?"),
  updateMatchFormat: db.prepare("UPDATE matches SET melhor_de = ? WHERE id = ?"),
  insertState: db.prepare("INSERT INTO match_state (match_id, state_json, updated_at) VALUES (?, ?, ?)"),
  getState: db.prepare("SELECT * FROM match_state WHERE match_id = ?"),
  putState: db.prepare("UPDATE match_state SET state_json = ?, updated_at = ? WHERE match_id = ?"),
  insertLog: db.prepare("INSERT INTO match_logs (match_id, ts, type, message, payload, actor_id) VALUES (?, ?, ?, ?, ?, ?)"),
  logsByMatch: db.prepare("SELECT * FROM match_logs WHERE match_id = ? ORDER BY ts DESC, id DESC LIMIT 500"),
  stats: db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM mesas) AS mesas,
      (SELECT COUNT(*) FROM players) AS players,
      (SELECT COUNT(*) FROM matches WHERE status = 'ao_vivo') AS live,
      (SELECT COUNT(*) FROM matches) AS matches`
  )
};

export { stmts };
