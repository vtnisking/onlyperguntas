/* =====================================================================
   CHATI — MODAL DE NOVIDADES (atualização visual + modo claro/escuro)
   Aparece uma vez por usuário (por navegador). Para mostrar uma nova
   novidade no futuro, basta trocar NOVIDADES_VERSAO.
   ===================================================================== */
(function () {
  const NOVIDADES_VERSAO = "2026-11-visual";

  function usuarioAtual() {
    try {
      const u = JSON.parse(localStorage.getItem("chati_user") || "null");
      return (u && (u.id || u.email)) || "anon";
    } catch (e) {
      return "anon";
    }
  }

  function chave() {
    return `chati_novidades_${NOVIDADES_VERSAO}_${usuarioAtual()}`;
  }

  function jaViu() {
    try {
      return localStorage.getItem(chave()) === "1";
    } catch (e) {
      return false;
    }
  }

  function marcarVisto() {
    try {
      localStorage.setItem(chave(), "1");
    } catch (e) {
      /* navegador sem storage: mostra de novo na próxima vez, sem problema */
    }
  }

  const reduzirMovimento =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function icone(id) {
    return `<svg class="ui-i"><use href="#${id}"/></svg>`;
  }

  function miniCard(largura, destaque) {
    return `
      <div class="wn-m-card ${destaque ? "is-hot" : ""}">
        <span class="wn-m-thumb"></span>
        <span class="wn-m-lines">
          <i style="width:${largura}%"></i>
          <i style="width:${Math.max(largura - 30, 25)}%"></i>
        </span>
        <span class="wn-m-pill"></span>
      </div>`;
  }

  function montar() {
    const temaAtualEscuro = document.body.classList.contains("dark");

    const wrap = document.createElement("div");
    wrap.className = "wn-overlay";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "wnTitle");
    wrap.innerHTML = `
      <div class="wn-modal">
        <button type="button" class="wn-close" aria-label="Fechar" data-wn-close>
          <svg class="ui-i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>

        <div class="wn-stage" aria-hidden="true">
          <div class="wn-glow wn-glow-1"></div>
          <div class="wn-glow wn-glow-2"></div>

          <div class="wn-window ${temaAtualEscuro ? "is-dark" : ""}" id="wnWindow">
            <div class="wn-m-side">
              <span class="wn-m-logo"></span>
              <span class="wn-m-nav is-active"></span>
              <span class="wn-m-nav"></span>
              <span class="wn-m-nav"></span>
              <span class="wn-m-nav short"></span>
            </div>
            <div class="wn-m-main">
              <div class="wn-m-top">
                <span class="wn-m-title"></span>
                <span class="wn-toggle" id="wnToggle">
                  <span class="wn-toggle-knob">
                    ${icone("i-sun")}
                    ${icone("i-moon")}
                  </span>
                </span>
              </div>
              <div class="wn-m-hero">
                <span class="wn-m-hero-icon"></span>
                <span class="wn-m-lines">
                  <i style="width:55%"></i>
                  <i style="width:35%"></i>
                </span>
              </div>
              <div class="wn-m-kpis">
                <span class="wn-m-kpi"><b class="red"></b></span>
                <span class="wn-m-kpi"><b class="green"></b></span>
                <span class="wn-m-kpi"><b class="blue"></b></span>
              </div>
              ${miniCard(78, true)}
              ${miniCard(64)}
              ${miniCard(70)}
            </div>
            <span class="wn-cursor" id="wnCursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 2-2 6z"/></svg><i></i></span>
          </div>

          <div class="wn-mode-label" id="wnModeLabel">${temaAtualEscuro ? "Modo escuro" : "Modo claro"}</div>
        </div>

        <div class="wn-body">
          <span class="wn-badge">${icone("i-zap")} Novidade</span>
          <h2 id="wnTitle">O Chati está de cara nova</h2>
          <p class="wn-lead">
            Atualizamos o visual do sistema para deixar seu atendimento mais rápido e agradável.
            Tudo continua no mesmo lugar, só que mais bonito.
          </p>

          <ul class="wn-features">
            <li style="--d:0">
              <span class="wn-f-icon tone-red">${icone("i-inbox")}</span>
              <span><strong>Visual renovado</strong><small>Menu, perguntas e cards mais limpos e fáceis de ler.</small></span>
            </li>
            <li style="--d:1">
              <span class="wn-f-icon tone-violet">${icone("i-moon")}</span>
              <span><strong>Modo claro e escuro</strong><small>Alterne quando quiser no botão do topo da tela.</small></span>
            </li>
            <li style="--d:2">
              <span class="wn-f-icon tone-green">${icone("icon-estatisticas")}</span>
              <span><strong>Estatísticas e Ajustes novos</strong><small>Gráficos, ranking da equipe e suas lojas organizadas.</small></span>
            </li>
          </ul>

          <div class="wn-actions">
            <button type="button" class="wn-btn wn-btn-ghost" id="wnTryTheme">
              ${temaAtualEscuro ? icone("i-sun") : icone("i-moon")}
              <span>${temaAtualEscuro ? "Experimentar modo claro" : "Experimentar modo escuro"}</span>
            </button>
            <button type="button" class="wn-btn wn-btn-primary" data-wn-close>
              Começar a usar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
    document.body.classList.add("wn-open");

    // ---------- animação da miniatura ----------
    const win = wrap.querySelector("#wnWindow");
    const cursor = wrap.querySelector("#wnCursor");
    const label = wrap.querySelector("#wnModeLabel");
    let timers = [];

    function later(fn, ms) {
      timers.push(setTimeout(fn, ms));
    }

    function ciclo() {
      // cursor vai até o botão, "clica", troca o tema e volta
      cursor.classList.add("go");
      later(() => cursor.classList.add("click"), 900);
      later(() => {
        win.classList.toggle("is-dark");
        label.textContent = win.classList.contains("is-dark") ? "Modo escuro" : "Modo claro";
        label.classList.remove("pop");
        void label.offsetWidth;
        label.classList.add("pop");
      }, 1050);
      later(() => cursor.classList.remove("click"), 1300);
      later(() => cursor.classList.remove("go"), 1700);
      later(ciclo, 3400);
    }

    if (!reduzirMovimento) {
      later(ciclo, 1200);
    }

    // ---------- ações ----------
    const tryBtn = wrap.querySelector("#wnTryTheme");
    tryBtn.addEventListener("click", () => {
      if (typeof window.toggleTheme === "function") window.toggleTheme();
      const escuro = document.body.classList.contains("dark");
      tryBtn.innerHTML = `${escuro ? icone("i-sun") : icone("i-moon")}<span>${
        escuro ? "Voltar para o modo claro" : "Voltar para o modo escuro"
      }</span>`;
    });

    function fechar() {
      marcarVisto();
      timers.forEach(clearTimeout);
      timers = [];
      wrap.classList.add("is-leaving");
      document.body.classList.remove("wn-open");
      setTimeout(() => wrap.remove(), reduzirMovimento ? 0 : 280);
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") fechar();
    }

    wrap.querySelectorAll("[data-wn-close]").forEach((b) => b.addEventListener("click", fechar));
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) fechar();
    });
    document.addEventListener("keydown", onKey);

    setTimeout(() => wrap.querySelector(".wn-btn-primary")?.focus({ preventScroll: true, focusVisible: false }), 50);
  }

  function iniciar() {
    // Só dentro do app, com usuário logado
    try {
      if (!localStorage.getItem("chati_user")) return;
    } catch (e) {
      return;
    }
    if (jaViu()) return;
    setTimeout(montar, 700);
  }

  // Permite abrir manualmente: window.mostrarNovidadesChati()
  window.mostrarNovidadesChati = montar;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
