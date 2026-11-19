import { api } from "./api.js";
import { toast } from "./toast.js";

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR");
}
function fmtDay(iso) {
  const s = String(iso || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || "—";
  return m[3] + "/" + m[2] + "/" + m[1];
}
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + mo + "-" + day;
}
function assignableUsers(users) {
  return (users || []).filter((u) => u.role !== "admin");
}
function assignedNames(users) {
  const names = assignableUsers(users).map((u) => u.username);
  return names.length ? names.join(", ") : "—";
}
function picksSummary(names) {
  if (!names.length) return "Selecionar usuários";
  if (names.length === 1) return names[0];
  return names.length + " usuários";
}
function userPicksHtml(users, selectedIds) {
  const list = assignableUsers(users);
  const sel = new Set((selectedIds || []).map(String));
  if (!list.length) return '<p class="ad-empty">Nenhum usuário para atribuir.</p>';
  const names = list.filter((u) => sel.has(String(u.id))).map((u) => u.username);
  return '<div class="ad-picks">' +
    '<button type="button" class="ad-picks-btn" data-picks-toggle aria-expanded="false" aria-haspopup="true">' +
    '<span class="ad-picks-label">' + esc(picksSummary(names)) + "</span>" +
    '<span class="ad-user-caret" aria-hidden="true">▾</span></button>' +
    '<div class="ad-picks-drop pl-hidden" role="menu">' +
    list.map((u) =>
      '<label class="ad-check"><input type="checkbox" name="evUsers" value="' + esc(u.id) + '"' +
      (sel.has(String(u.id)) ? " checked" : "") + "> " + esc(u.username) + "</label>"
    ).join("") +
    "</div></div>";
}
function selectedUserIds(root) {
  return Array.from(root.querySelectorAll('input[name="evUsers"]:checked')).map((el) => el.value);
}
function closeAllPicks() {
  document.querySelectorAll(".ad-picks").forEach((wrap) => {
    const drop = wrap.querySelector(".ad-picks-drop");
    const btn = wrap.querySelector("[data-picks-toggle]");
    if (drop) drop.classList.add("pl-hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}
function bindUserPicks(root) {
  root.querySelectorAll(".ad-picks").forEach((wrap) => {
    const btn = wrap.querySelector("[data-picks-toggle]");
    const drop = wrap.querySelector(".ad-picks-drop");
    const label = wrap.querySelector(".ad-picks-label");
    if (!btn || !drop) return;
    function summary() {
      const names = Array.from(wrap.querySelectorAll('input[name="evUsers"]:checked'))
        .map((el) => {
          const lab = el.closest("label");
          return lab ? lab.textContent.replace(/^\s+|\s+$/g, "") : "";
        })
        .filter(Boolean);
      if (label) label.textContent = picksSummary(names);
    }
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const open = drop.classList.contains("pl-hidden");
      closeAllPicks();
      closeAllUserMenus();
      if (open) {
        drop.classList.remove("pl-hidden");
        btn.setAttribute("aria-expanded", "true");
      }
    });
    drop.addEventListener("click", (ev) => ev.stopPropagation());
    wrap.querySelectorAll('input[name="evUsers"]').forEach((inp) => {
      inp.addEventListener("change", summary);
    });
  });
}
function origin() {
  return window.location.origin;
}
function fullUrl(path) {
  return origin() + path;
}
function statusLabel(s) {
  if (s === "ao_vivo") return '<span class="ad-live">Ao vivo</span>';
  if (s === "encerrada") return "Encerrada";
  return "Pendente";
}

function userMenuHtml(user) {
  if (!user) return "";
  return '<div class="ad-user-menu" id="userMenu">' +
    '<button type="button" class="ad-user-btn" id="userMenuBtn" aria-expanded="false" aria-haspopup="true">' +
    '<span class="ad-user-name">' + esc(user.username) + "</span>" +
    '<span class="ad-user-caret" aria-hidden="true">▾</span></button>' +
    '<div class="ad-user-drop pl-hidden" id="userMenuDrop" role="menu">' +
    '<button type="button" class="ad-user-item" id="btnLogout" role="menuitem">Sair</button>' +
    "</div></div>";
}

export function navHtml(user, title, sub) {
  const adminLink = user && user.role === "admin"
    ? '<button type="button" class="pl-btn sec" data-go="/usuarios">Usuários</button>'
    : "";
  return '<header class="pl-header">' +
    "<div><span class=\"pl-eyebrow\">Six-red</span>" +
    "<h1 class=\"pl-title\">" + esc(title) + "</h1>" +
    "<p class=\"pl-sub\">" + esc(sub || "") + "</p></div>" +
    '<div class="pl-row-ctl ad-nav">' +
    (user ? '<button type="button" class="pl-btn sec" data-go="/">Eventos</button>' : "") +
    adminLink + userMenuHtml(user) +
    "</div></header>";
}

function closeAllUserMenus() {
  document.querySelectorAll(".ad-user-menu").forEach((menu) => {
    const drop = menu.querySelector(".ad-user-drop");
    const btn = menu.querySelector(".ad-user-btn");
    if (drop) drop.classList.add("pl-hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

if (!window.__tcUserMenuDoc) {
  window.__tcUserMenuDoc = true;
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t.closest && t.closest(".ad-user-menu"))) closeAllUserMenus();
    if (!(t.closest && t.closest(".ad-picks"))) closeAllPicks();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeAllUserMenus();
      closeAllPicks();
    }
  });
}

function bindUserMenu(root, onLogout) {
  const btn = root.querySelector("#userMenuBtn");
  const drop = root.querySelector("#userMenuDrop");
  const out = root.querySelector("#btnLogout");
  if (btn && drop) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const open = drop.classList.contains("pl-hidden");
      closeAllUserMenus();
      if (open) {
        drop.classList.remove("pl-hidden");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  }
  if (out) {
    out.addEventListener("click", async () => {
      try { await api.logout(); } catch { /* ignore */ }
      if (onLogout) onLogout();
      window.location.href = "/login";
    });
  }
}

async function bindNav(root, onLogout) {
  root.querySelectorAll("[data-go]").forEach((b) => {
    b.addEventListener("click", () => { window.location.href = b.getAttribute("data-go"); });
  });
  bindUserMenu(root, onLogout);
}

function copyBtn(path) {
  return '<button type="button" class="pl-btn sec" data-copy="' + esc(fullUrl(path)) + '">Copiar URL</button>';
}

function bindCopy(root) {
  root.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.getAttribute("data-copy"));
        toast("URL copiada.", { type: "success" });
      } catch {
        toast("Não foi possível copiar.", { type: "error" });
      }
    });
  });
}

export async function renderLogin(root) {
  root.innerHTML =
    '<header class="pl-header"><div><span class="pl-eyebrow">Six-red</span>' +
    '<h1 class="pl-title">Tacada Certa</h1>' +
    '<p class="pl-sub">Controle de eventos de sinuca</p></div></header>' +
    '<main class="ad-main ad-login"><div class="pl-card">' +
    "<h2>Entrar</h2>" +
    '<p class="pl-sub">Usuário inicial: admin / admin. No primeiro acesso será pedido para trocar a senha.</p>' +
    '<form id="loginForm">' +
    '<div class="pl-field"><label class="pl-label" for="loginUser">Usuário</label>' +
    '<input class="pl-input" id="loginUser" name="username" autocomplete="username" required></div>' +
    '<div class="pl-field"><label class="pl-label" for="loginPass">Senha</label>' +
    '<input class="pl-input" id="loginPass" name="password" type="password" autocomplete="current-password" required></div>' +
    '<button class="pl-btn" type="submit">Entrar</button>' +
    '<div class="ad-err" id="loginErr"></div>' +
    "</form></div></main>";
  $("loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("loginErr");
    err.textContent = "";
    try {
      const data = await api.login($("loginUser").value, $("loginPass").value);
      if (data.user && data.user.must_change_password) {
        window.location.href = "/";
        return;
      }
      const n = new URLSearchParams(window.location.search).get("next");
      window.location.href = n && n.charAt(0) === "/" ? n : "/";
    } catch (e) {
      err.textContent = e.message;
    }
  });
}

export async function renderChangePassword(root, user) {
  const name = user && user.username ? user.username : "";
  root.innerHTML =
    '<header class="pl-header"><div><span class="pl-eyebrow">Six-red</span>' +
    '<h1 class="pl-title">Trocar senha</h1>' +
    '<p class="pl-sub">Primeiro acesso' + (name ? " · " + esc(name) : "") + ". Defina uma senha nova para continuar.</p></div>" +
    '<div class="pl-row-ctl ad-nav">' + userMenuHtml(user) + "</div></header>" +
    '<main class="ad-main ad-login"><div class="pl-card">' +
    "<h2>Nova senha</h2>" +
    '<form id="pwForm">' +
    '<div class="pl-field"><label class="pl-label" for="pwCurrent">Senha atual</label>' +
    '<input class="pl-input" id="pwCurrent" type="password" autocomplete="current-password" required></div>' +
    '<div class="pl-field"><label class="pl-label" for="pwNext">Nova senha</label>' +
    '<input class="pl-input" id="pwNext" type="password" autocomplete="new-password" minlength="4" required></div>' +
    '<div class="pl-field"><label class="pl-label" for="pwNext2">Confirmar nova senha</label>' +
    '<input class="pl-input" id="pwNext2" type="password" autocomplete="new-password" minlength="4" required></div>' +
    '<button class="pl-btn" type="submit">Salvar senha</button>' +
    '<div class="ad-err" id="pwErr"></div>' +
    "</form></div></main>";
  bindUserMenu(root);
  $("pwForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = $("pwErr");
    err.textContent = "";
    const current = $("pwCurrent").value;
    const next = $("pwNext").value;
    const next2 = $("pwNext2").value;
    if (next !== next2) {
      err.textContent = "A confirmação não confere.";
      return;
    }
    try {
      await api.changePassword(current, next);
      toast("Senha atualizada.", { type: "success" });
      const n = new URLSearchParams(window.location.search).get("next");
      window.location.href = n && n.charAt(0) === "/" ? n : "/";
    } catch (e) {
      err.textContent = e.message;
    }
  });
}

export async function renderPainel(root, user) {
  const [stats, list, usersData] = await Promise.all([api.stats(), api.eventos(), api.users()]);
  const users = usersData.users || [];
  root.innerHTML =
    navHtml(user, "Tacada Certa", "Eventos six-red · mesas · jogadores · partidas") +
    '<main class="ad-main">' +
    '<div class="ad-kpis">' +
    '<div class="ad-kpi"><span>Eventos</span><b>' + stats.events + "</b></div>" +
    '<div class="ad-kpi"><span>Mesas</span><b>' + stats.mesas + "</b></div>" +
    '<div class="ad-kpi"><span>Jogadores</span><b>' + stats.players + "</b></div>" +
    '<div class="ad-kpi"><span>Ao vivo</span><b>' + stats.live + "</b></div>" +
    "</div>" +
    '<div class="pl-card"><h2>Novo evento</h2>' +
    '<div class="ad-form">' +
    '<div class="pl-field"><label class="pl-label" for="evName">Nome</label>' +
    '<input class="pl-input" id="evName" maxlength="80" placeholder="Nome do evento"></div>' +
    '<div class="pl-field"><label class="pl-label" for="evDate">Data</label>' +
    '<input class="pl-input" id="evDate" type="date" value="' + todayIso() + '"></div>' +
    '<div class="pl-field"><label class="pl-label" for="evFmt">Formato padrão</label>' +
    '<select class="pl-select" id="evFmt"><option value="1">Melhor de 1</option>' +
    '<option value="3" selected>Melhor de 3</option><option value="5">Melhor de 5</option>' +
    '<option value="7">Melhor de 7</option></select></div>' +
    '<div class="pl-field"><span class="pl-label">Usuários atribuídos</span>' +
    userPicksHtml(users, user.role === "admin" ? [] : [user.id]) + "</div>" +
    '<button class="pl-btn" type="button" id="evCreate">Criar evento</button></div>' +
    '<div class="ad-err" id="evErr"></div></div>' +
    '<div class="pl-card"><h2>Eventos</h2>' +
    (list.events.length
      ? '<table class="pl-table"><thead><tr><th>Evento</th><th>Data</th><th>Usuários</th><th>Mesas</th><th>Jogadores</th><th>Partidas</th><th>URL</th></tr></thead><tbody>' +
        list.events.map((ev) =>
          "<tr><td><a href=\"/evento/" + esc(ev.id) + "\">" + esc(ev.name) + "</a></td>" +
          "<td>" + esc(fmtDay(ev.event_date)) + "</td>" +
          "<td>" + esc(assignedNames(ev.users)) + "</td>" +
          "<td>" + ev.mesas + "</td><td>" + ev.jogadores + "</td><td>" + ev.partidas + "</td>" +
          '<td class="ad-url"><a href="' + esc(ev.url) + '">' + esc(fullUrl(ev.url)) + "</a></td></tr>"
        ).join("") +
        "</tbody></table>"
      : '<p class="ad-empty">Nenhum evento cadastrado.</p>') +
    "</div></main>";
  await bindNav(root);
  bindUserPicks(root);
  $("evCreate").addEventListener("click", async () => {
    $("evErr").textContent = "";
    try {
      await api.createEvento({
        name: $("evName").value,
        event_date: $("evDate").value,
        melhor_de: Number($("evFmt").value),
        user_ids: selectedUserIds(root)
      });
      toast("Evento criado.", { type: "success" });
      await renderPainel(root, user);
    } catch (e) {
      $("evErr").textContent = e.message;
    }
  });
}

export async function renderEvento(root, user, eventId) {
  const [data, usersData] = await Promise.all([api.evento(eventId), api.users()]);
  const ev = data.event;
  const mesaOpts = data.mesas.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name) + "</option>").join("");
  const playerOpts = data.jogadores.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>").join("");
  const assigned = (ev.users || []).map((u) => u.id);
  root.innerHTML =
    navHtml(user, ev.name, "Evento six-red · " + (ev.status === "ativo" ? "ativo" : "encerrado") + (ev.event_date ? " · " + fmtDay(ev.event_date) : "")) +
    '<main class="ad-main">' +
    '<div class="pl-card"><h2>Dados do evento</h2>' +
    '<div class="ad-form">' +
    '<div class="pl-field"><label class="pl-label" for="evName">Nome</label>' +
    '<input class="pl-input" id="evName" maxlength="80" value="' + esc(ev.name) + '"></div>' +
    '<div class="pl-field"><label class="pl-label" for="evDate">Data</label>' +
    '<input class="pl-input" id="evDate" type="date" value="' + esc(ev.event_date || "") + '"></div>' +
    '<div class="pl-field"><span class="pl-label">Usuários atribuídos</span>' +
    userPicksHtml(usersData.users || [], assigned) + "</div>" +
    '<button class="pl-btn" type="button" id="evSave">Salvar dados</button></div>' +
    '<div class="ad-err" id="evSaveErr"></div></div>' +
    '<div class="pl-card"><h2>URL do evento</h2>' +
    '<p class="ad-url"><a href="/e/' + esc(ev.slug) + '">' + esc(fullUrl("/e/" + ev.slug)) + "</a></p>" +
    '<div class="ad-links">' + copyBtn("/e/" + ev.slug) +
    (user.role === "admin" ? '<button type="button" class="pl-btn red" id="evDel">Excluir evento</button>' : "") +
    "</div></div>" +
    '<div class="ad-split">' +
    '<div class="pl-card"><h2>Mesas</h2>' +
    '<div class="ad-toolbar">' +
    '<input class="pl-input" id="mesaName" maxlength="40" placeholder="Mesa 1">' +
    '<button class="pl-btn" type="button" id="mesaAdd">Cadastrar mesa</button></div>' +
    '<div class="ad-err" id="mesaErr"></div>' +
    (data.mesas.length
      ? '<table class="pl-table"><thead><tr><th>Mesa</th><th>URL</th><th></th></tr></thead><tbody>' +
        data.mesas.map((mesa) =>
          "<tr><td><input class=\"pl-input\" data-edit-mesa=\"" + esc(mesa.id) + "\" maxlength=\"40\" value=\"" + esc(mesa.name) + "\"></td>" +
          '<td class="ad-url"><a href="/m/' + esc(mesa.slug) + '">' + esc(fullUrl("/m/" + mesa.slug)) + "</a>" +
          "<br><a href=\"/m/" + esc(mesa.slug) + "/resultado\">resultado</a></td>" +
          '<td class="ad-actions">' + copyBtn("/m/" + mesa.slug) + copyBtn("/m/" + mesa.slug + "/resultado") +
          '<button type="button" class="pl-btn sec" data-save-mesa="' + esc(mesa.id) + '">Salvar</button>' +
          '<button type="button" class="pl-btn sec" data-del-mesa="' + esc(mesa.id) + '">Excluir</button></td></tr>'
        ).join("") + "</tbody></table>"
      : '<p class="ad-empty">Cadastre as mesas do evento.</p>') +
    "</div>" +
    '<div class="pl-card"><h2>Jogadores</h2>' +
    '<div class="ad-toolbar">' +
    '<input class="pl-input" id="plName" maxlength="40" placeholder="Nome do atleta">' +
    '<button class="pl-btn" type="button" id="plAdd">Cadastrar jogador</button></div>' +
    '<div class="ad-err" id="plErr"></div>' +
    (data.jogadores.length
      ? '<table class="pl-table"><thead><tr><th>Jogador</th><th></th></tr></thead><tbody>' +
        data.jogadores.map((p) =>
          "<tr><td><input class=\"pl-input\" data-edit-pl=\"" + esc(p.id) + "\" maxlength=\"40\" value=\"" + esc(p.name) + "\"></td>" +
          '<td class="ad-actions"><button type="button" class="pl-btn sec" data-save-pl="' + esc(p.id) + '">Salvar</button>' +
          '<button type="button" class="pl-btn sec" data-del-pl="' + esc(p.id) + '">Excluir</button></td></tr>'
        ).join("") + "</tbody></table>"
      : '<p class="ad-empty">Cadastre os jogadores do evento.</p>') +
    "</div></div>" +
    '<div class="pl-card"><h2>Nova partida</h2>' +
    '<div class="ad-toolbar">' +
    '<div class="pl-field"><label class="pl-label" for="mtMesa">Mesa</label><select class="pl-select" id="mtMesa">' + mesaOpts + "</select></div>" +
    '<div class="pl-field"><label class="pl-label" for="mtP1">Jogador 1</label><select class="pl-select" id="mtP1">' + playerOpts + "</select></div>" +
    '<div class="pl-field"><label class="pl-label" for="mtP2">Jogador 2</label><select class="pl-select" id="mtP2">' + playerOpts + "</select></div>" +
    '<div class="pl-field"><label class="pl-label" for="mtFmt">Formato</label><select class="pl-select" id="mtFmt">' +
    [1, 3, 5, 7].map((n) => '<option value="' + n + '"' + (n === ev.melhor_de ? " selected" : "") + ">Melhor de " + n + "</option>").join("") +
    "</select></div>" +
    '<button class="pl-btn" type="button" id="mtCreate">Criar partida</button></div>' +
    '<div class="ad-err" id="mtErr"></div></div>' +
    '<div class="pl-card"><h2>Partidas</h2>' +
    (data.partidas.length
      ? '<table class="pl-table"><thead><tr><th>Confronto</th><th>Mesa</th><th>Status</th><th>Acesso</th></tr></thead><tbody>' +
        data.partidas.map((b) =>
          "<tr><td>" + esc(b.player1.name) + " x " + esc(b.player2.name) + "<br>" +
          esc(b.state.wins[0] + " x " + b.state.wins[1]) + "</td>" +
          "<td>" + esc(b.mesa.name) + "</td><td>" + statusLabel(b.match.status) + "</td>" +
          '<td class="ad-actions">' +
          '<a class="pl-btn" href="' + esc(b.urls.controle) + '">Controle</a>' +
          '<a class="pl-btn sec" href="' + esc(b.urls.tv) + '">TV</a>' +
          '<a class="pl-btn sec" href="' + esc(b.urls.log) + '">Log</a>' +
          '<a class="pl-btn sec" href="' + esc(b.urls.resultado) + '">Resultado</a>' +
          "</td></tr>"
        ).join("") + "</tbody></table>"
      : '<p class="ad-empty">Nenhuma partida neste evento.</p>') +
    "</div></main>";
  await bindNav(root);
  bindCopy(root);
  bindUserPicks(root);
  $("evSave").addEventListener("click", async () => {
    $("evSaveErr").textContent = "";
    try {
      await api.patchEvento(ev.id, {
        name: $("evName").value,
        event_date: $("evDate").value,
        user_ids: selectedUserIds(root)
      });
      toast("Evento atualizado.", { type: "success" });
      await renderEvento(root, user, eventId);
    } catch (e) { $("evSaveErr").textContent = e.message; }
  });
  $("mesaAdd").addEventListener("click", async () => {
    $("mesaErr").textContent = "";
    try {
      await api.createMesa(ev.id, { name: $("mesaName").value });
      await renderEvento(root, user, eventId);
    } catch (e) { $("mesaErr").textContent = e.message; }
  });
  $("plAdd").addEventListener("click", async () => {
    $("plErr").textContent = "";
    try {
      await api.createJogador(ev.id, { name: $("plName").value });
      await renderEvento(root, user, eventId);
    } catch (e) { $("plErr").textContent = e.message; }
  });
  $("mtCreate").addEventListener("click", async () => {
    $("mtErr").textContent = "";
    try {
      await api.createPartida({
        mesa_id: $("mtMesa").value,
        player1_id: $("mtP1").value,
        player2_id: $("mtP2").value,
        melhor_de: Number($("mtFmt").value)
      });
      toast("Partida criada.", { type: "success" });
      await renderEvento(root, user, eventId);
    } catch (e) { $("mtErr").textContent = e.message; }
  });
  root.querySelectorAll("[data-save-mesa]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-save-mesa");
      const input = root.querySelector('[data-edit-mesa="' + id + '"]');
      $("mesaErr").textContent = "";
      try {
        await api.patchMesa(id, { name: input ? input.value : "" });
        toast("Mesa atualizada.", { type: "success" });
        await renderEvento(root, user, eventId);
      } catch (e) { $("mesaErr").textContent = e.message; }
    });
  });
  root.querySelectorAll("[data-save-pl]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-save-pl");
      const input = root.querySelector('[data-edit-pl="' + id + '"]');
      $("plErr").textContent = "";
      try {
        await api.patchJogador(id, { name: input ? input.value : "" });
        toast("Jogador atualizado.", { type: "success" });
        await renderEvento(root, user, eventId);
      } catch (e) { $("plErr").textContent = e.message; }
    });
  });
  function bindEnterSave(attr, btnAttr) {
    root.querySelectorAll("[" + attr + "]").forEach((input) => {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        const btn = root.querySelector("[" + btnAttr + '="' + input.getAttribute(attr) + '"]');
        if (btn) btn.click();
      });
    });
  }
  bindEnterSave("data-edit-mesa", "data-save-mesa");
  bindEnterSave("data-edit-pl", "data-save-pl");
  root.querySelectorAll("[data-del-mesa]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!window.confirm("Excluir esta mesa e suas partidas?")) return;
      try {
        await api.deleteMesa(b.getAttribute("data-del-mesa"));
        await renderEvento(root, user, eventId);
      } catch (e) { toast(e.message, { type: "error" }); }
    });
  });
  root.querySelectorAll("[data-del-pl]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await api.deleteJogador(b.getAttribute("data-del-pl"));
        await renderEvento(root, user, eventId);
      } catch (e) { toast(e.message, { type: "error" }); }
    });
  });
  const del = $("evDel");
  if (del) {
    del.addEventListener("click", async () => {
      if (!window.confirm("Excluir o evento e todos os dados?")) return;
      try {
        await api.deleteEvento(ev.id);
        window.location.href = "/";
      } catch (e) { toast(e.message, { type: "error" }); }
    });
  }
}

export async function renderUsuarios(root, user) {
  const data = await api.users();
  root.innerHTML =
    navHtml(user, "Usuários", "Administradores e operadores") +
    '<main class="ad-main"><div class="pl-card"><h2>Novo usuário</h2>' +
    '<div class="ad-toolbar">' +
    '<div class="pl-field"><label class="pl-label" for="uName">Usuário</label><input class="pl-input" id="uName" maxlength="32"></div>' +
    '<div class="pl-field"><label class="pl-label" for="uPass">Senha</label><input class="pl-input" id="uPass" type="password"></div>' +
    '<div class="pl-field"><label class="pl-label" for="uRole">Papel</label>' +
    '<select class="pl-select" id="uRole"><option value="user">Usuário comum</option><option value="admin">Admin</option></select></div>' +
    '<button class="pl-btn" type="button" id="uAdd">Cadastrar</button></div>' +
    '<div class="ad-err" id="uErr"></div></div>' +
    '<div class="pl-card"><h2>Cadastrados</h2>' +
    '<table class="pl-table"><thead><tr><th>Usuário</th><th>Papel</th><th></th></tr></thead><tbody>' +
    data.users.map((u) =>
      "<tr><td>" + esc(u.username) + "</td><td>" + (u.role === "admin" ? "admin" : "usuário") + "</td>" +
      '<td class="ad-actions">' +
      (u.id === user.id ? "" : '<button type="button" class="pl-btn sec" data-del-user="' + esc(u.id) + '">Excluir</button>') +
      "</td></tr>"
    ).join("") +
    "</tbody></table></div></main>";
  await bindNav(root);
  $("uAdd").addEventListener("click", async () => {
    $("uErr").textContent = "";
    try {
      await api.createUser({ username: $("uName").value, password: $("uPass").value, role: $("uRole").value });
      toast("Usuário criado.", { type: "success" });
      await renderUsuarios(root, user);
    } catch (e) { $("uErr").textContent = e.message; }
  });
  root.querySelectorAll("[data-del-user]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!window.confirm("Excluir este usuário?")) return;
      try {
        await api.deleteUser(b.getAttribute("data-del-user"));
        await renderUsuarios(root, user);
      } catch (e) { toast(e.message, { type: "error" }); }
    });
  });
}

function resultadoTable(data) {
  if (!data.matches.length) return '<p class="ad-empty">Nenhuma partida nesta mesa.</p>';
  return '<table class="pl-table"><thead><tr><th>Confronto</th><th>Placar</th><th>Frames</th><th>Maior tacada</th><th>Status</th><th></th></tr></thead><tbody>' +
    data.matches.map((m) =>
      "<tr><td>" + esc(m.player1) + " x " + esc(m.player2) + "<br><span class=\"ad-url\">" + fmtDate(m.created_at) + "</span></td>" +
      "<td><b>" + m.wins[0] + " x " + m.wins[1] + "</b></td>" +
      "<td>" + m.points[0] + " x " + m.points[1] + "</td>" +
      "<td>" + m.maxBreak[0] + " / " + m.maxBreak[1] + "</td>" +
      "<td>" + statusLabel(m.status) + (m.winner ? "<br>" + esc(m.winner) : "") + "</td>" +
      '<td class="ad-actions"><a class="pl-btn sec" href="' + esc(m.urls.controle) + '">Controle</a>' +
      '<a class="pl-btn sec" href="' + esc(m.urls.tv) + '">TV</a>' +
      '<a class="pl-btn sec" href="' + esc(m.urls.log) + '">Log</a></td></tr>'
    ).join("") + "</tbody></table>";
}

export async function renderMesa(root, user, slug) {
  const data = await api.mesa(slug);
  const cur = data.current;
  root.innerHTML =
    navHtml(user, data.mesa.name, data.event.name + " · six-red") +
    '<main class="ad-main">' +
    '<div class="pl-card"><h2>URLs desta mesa</h2>' +
    '<p class="ad-url">Mesa: <a href="' + esc(data.urls.mesa) + '">' + esc(fullUrl(data.urls.mesa)) + "</a></p>" +
    '<p class="ad-url">TV: <a href="' + esc(data.urls.tv) + '">' + esc(fullUrl(data.urls.tv)) + "</a></p>" +
    '<p class="ad-url">Resultado: <a href="' + esc(data.urls.resultado) + '">' + esc(fullUrl(data.urls.resultado)) + "</a></p>" +
    '<div class="ad-links">' + copyBtn(data.urls.mesa) + copyBtn(data.urls.tv) + copyBtn(data.urls.resultado) + "</div></div>" +
    (cur
      ? '<div class="pl-card"><h2>Partida atual</h2>' +
        "<p>" + esc(cur.player1.name) + " x " + esc(cur.player2.name) + " · " + statusLabel(cur.match.status) +
        " · " + cur.state.wins[0] + " x " + cur.state.wins[1] + "</p>" +
        '<div class="ad-links"><a class="pl-btn" href="' + esc(cur.urls.controle) + '">Controle</a>' +
        '<a class="pl-btn sec" href="' + esc(data.urls.tv) + '">TV</a>' +
        '<a class="pl-btn sec" href="' + esc(cur.urls.log) + '">Log</a></div></div>'
      : '<div class="pl-card"><p class="ad-empty">Nenhuma partida em andamento nesta mesa.</p></div>') +
    '<div class="pl-card"><h2>Resultado da mesa</h2>' + resultadoTable(data) + "</div></main>";
  await bindNav(root);
  bindCopy(root);
}

export async function renderResultado(root, user, slug) {
  const data = await api.resultado(slug);
  root.innerHTML =
    navHtml(user, "Resultado · " + data.mesa.name, data.event.name) +
    '<main class="ad-main"><div class="pl-card">' +
    '<p class="ad-url">' + esc(fullUrl(data.urls.resultado)) + "</p>" +
    '<div class="ad-links">' + copyBtn(data.urls.resultado) +
    '<a class="pl-btn sec" href="' + esc(data.urls.mesa) + '">Ver mesa</a></div>' +
    resultadoTable(data) + "</div></main>";
  await bindNav(root);
  bindCopy(root);
}

export async function renderEventoPublico(root, user, slug) {
  const data = await api.evento(slug);
  root.innerHTML =
    navHtml(user, data.event.name, "Evento six-red") +
    '<main class="ad-main"><div class="pl-card"><h2>Mesas</h2>' +
    (data.mesas.length
      ? '<table class="pl-table"><thead><tr><th>Mesa</th><th>Acesso</th></tr></thead><tbody>' +
        data.mesas.map((mesa) =>
          "<tr><td>" + esc(mesa.name) + "</td><td class=\"ad-actions\">" +
          '<a class="pl-btn" href="/m/' + esc(mesa.slug) + '">Mesa</a>' +
          '<a class="pl-btn sec" href="/m/' + esc(mesa.slug) + '/resultado">Resultado</a></td></tr>'
        ).join("") + "</tbody></table>"
      : '<p class="ad-empty">Sem mesas.</p>') +
    "</div></main>";
  await bindNav(root);
}

export async function renderLog(root, user, slug) {
  const data = await api.logs(slug);
  const b = data.match;
  root.innerHTML =
    navHtml(user, "Log da partida", b.player1.name + " x " + b.player2.name + " · " + b.mesa.name) +
    '<main class="ad-main"><div class="pl-card">' +
    '<p class="ad-url">' + esc(fullUrl(b.urls.log)) + "</p>" +
    '<div class="ad-links">' + copyBtn(b.urls.log) +
    '<a class="pl-btn" href="' + esc(b.urls.controle) + '">Controle</a>' +
    '<a class="pl-btn sec" href="' + esc(b.urls.tv) + '">TV</a>' +
    '<a class="pl-btn sec" href="' + esc(b.urls.resultado) + '">Resultado</a></div>' +
    (data.logs.length
      ? '<ol class="ad-log">' + data.logs.map((row) =>
        "<li><time>" + fmtDate(row.ts) + "</time><b>" + esc(row.type) + "</b>" + esc(row.message) + "</li>"
      ).join("") + "</ol>"
      : '<p class="ad-empty">Nenhum evento registrado ainda.</p>') +
    "</div></main>";
  await bindNav(root);
  bindCopy(root);
}

export function showView(id) {
  ["viewPages", "viewLogin", "viewControl", "viewTv"].forEach((vid) => {
    const el = $(vid);
    if (!el) return;
    if (vid === "viewTv") {
      el.classList.toggle("tv-hidden", vid !== id);
      el.classList.toggle("pl-hidden", vid !== id);
      if (vid === id) el.classList.add("tv-empty");
    } else {
      el.classList.toggle("pl-hidden", vid !== id);
      el.classList.toggle("tv-hidden", vid !== id);
    }
  });
}

export function parseRoute(pathname) {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  let m;
  if (p === "/login") return { name: "login" };
  if (p === "/usuarios") return { name: "usuarios" };
  if ((m = /^\/evento\/([^/]+)$/.exec(p))) return { name: "evento", id: decodeURIComponent(m[1]) };
  if ((m = /^\/e\/([^/]+)$/.exec(p))) return { name: "eventoPublico", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/m\/([^/]+)\/tv$/.exec(p))) return { name: "mesaTv", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/m\/([^/]+)\/resultado$/.exec(p))) return { name: "resultado", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/m\/([^/]+)$/.exec(p))) return { name: "mesa", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/p\/([^/]+)\/tv$/.exec(p))) return { name: "tv", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/p\/([^/]+)\/log$/.exec(p))) return { name: "log", slug: decodeURIComponent(m[1]) };
  if ((m = /^\/p\/([^/]+)$/.exec(p))) return { name: "partida", slug: decodeURIComponent(m[1]) };
  return { name: "painel" };
}
