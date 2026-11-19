import { api } from "./api.js";
import {
  parseRoute,
  showView,
  renderLogin,
  renderPainel,
  renderEvento,
  renderUsuarios,
  renderMesa,
  renderResultado,
  renderEventoPublico,
  renderLog
} from "./pages.js";
import { startScoreboard, startMesaTv, stopScoreboard, stopMesaWatch } from "./app.js";

const PUBLIC = new Set(["login", "tv", "mesaTv", "resultado", "mesa", "eventoPublico", "log"]);

export async function boot() {
  const route = parseRoute(window.location.pathname);
  const pages = document.getElementById("viewPages");
  let user = null;
  try {
    const me = await api.me();
    user = me.user;
  } catch {
    user = null;
  }

  if (route.name === "login") {
    if (user) {
      const n = new URLSearchParams(window.location.search).get("next");
      window.location.replace(n && n.charAt(0) === "/" ? n : "/");
      return;
    }
    stopScoreboard();
    stopMesaWatch();
    showView("viewLogin");
    await renderLogin(document.getElementById("viewLogin"));
    return;
  }

  if (!user && !PUBLIC.has(route.name)) {
    window.location.replace("/login?next=" + encodeURIComponent(window.location.pathname));
    return;
  }

  if (route.name === "usuarios" && (!user || user.role !== "admin")) {
    window.location.replace("/");
    return;
  }

  if (route.name === "mesaTv") {
    showView("viewTv");
    await startMesaTv(route.slug);
    return;
  }

  if (route.name === "partida" || route.name === "tv") {
    if (route.name === "partida" && !user) {
      window.location.replace("/login");
      return;
    }
    stopMesaWatch();
    showView(route.name === "tv" ? "viewTv" : "viewControl");
    await startScoreboard(route.slug, route.name === "tv" ? "tv" : "control");
    return;
  }

  stopScoreboard();
  stopMesaWatch();
  showView(route.name === "login" ? "viewLogin" : "viewPages");
  try {
    if (route.name === "painel") await renderPainel(pages, user);
    else if (route.name === "evento") await renderEvento(pages, user, route.id);
    else if (route.name === "usuarios") await renderUsuarios(pages, user);
    else if (route.name === "mesa") await renderMesa(pages, user, route.slug);
    else if (route.name === "resultado") await renderResultado(pages, user, route.slug);
    else if (route.name === "eventoPublico") await renderEventoPublico(pages, user, route.slug);
    else if (route.name === "log") await renderLog(pages, user, route.slug);
  } catch (err) {
    pages.innerHTML = '<main class="ad-main"><div class="pl-card"><h2>Não foi possível abrir</h2>' +
      '<p class="ad-err">' + String(err.message || err) + "</p>" +
      '<a class="pl-btn" href="/">Voltar ao painel</a></div></main>';
  }
}
