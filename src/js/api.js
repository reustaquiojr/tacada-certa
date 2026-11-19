async function req(method, url, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "Erro");
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req("GET", "/api/me"),
  login: (username, password) => req("POST", "/api/login", { username, password }),
  logout: () => req("POST", "/api/logout", {}),
  changePassword: (current, next) => req("POST", "/api/password", { current, next }),
  stats: () => req("GET", "/api/stats"),
  users: () => req("GET", "/api/users"),
  createUser: (body) => req("POST", "/api/users", body),
  patchUser: (id, body) => req("PATCH", "/api/users/" + encodeURIComponent(id), body),
  deleteUser: (id) => req("DELETE", "/api/users/" + encodeURIComponent(id)),
  eventos: () => req("GET", "/api/eventos"),
  createEvento: (body) => req("POST", "/api/eventos", body),
  evento: (id) => req("GET", "/api/eventos/" + encodeURIComponent(id)),
  patchEvento: (id, body) => req("PATCH", "/api/eventos/" + encodeURIComponent(id), body),
  deleteEvento: (id) => req("DELETE", "/api/eventos/" + encodeURIComponent(id)),
  createMesa: (eventId, body) => req("POST", "/api/eventos/" + encodeURIComponent(eventId) + "/mesas", body),
  patchMesa: (id, body) => req("PATCH", "/api/mesas/" + encodeURIComponent(id), body),
  deleteMesa: (id) => req("DELETE", "/api/mesas/" + encodeURIComponent(id)),
  mesa: (slug) => req("GET", "/api/mesas/" + encodeURIComponent(slug)),
  resultado: (slug) => req("GET", "/api/mesas/" + encodeURIComponent(slug) + "/resultado"),
  createJogador: (eventId, body) => req("POST", "/api/eventos/" + encodeURIComponent(eventId) + "/jogadores", body),
  patchJogador: (id, body) => req("PATCH", "/api/jogadores/" + encodeURIComponent(id), body),
  deleteJogador: (id) => req("DELETE", "/api/jogadores/" + encodeURIComponent(id)),
  createPartida: (body) => req("POST", "/api/partidas", body),
  partida: (slug) => req("GET", "/api/partidas/" + encodeURIComponent(slug)),
  putState: (slug, state) => req("PUT", "/api/partidas/" + encodeURIComponent(slug) + "/state", state),
  logs: (slug) => req("GET", "/api/partidas/" + encodeURIComponent(slug) + "/logs"),
  postLog: (slug, body) => req("POST", "/api/partidas/" + encodeURIComponent(slug) + "/logs", body)
};
