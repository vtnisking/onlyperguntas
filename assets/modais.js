/* =====================================================================
   CHATI — MODAIS DE AVISO (fila)
   ---------------------------------------------------------------------
   Mostra os avisos um depois do outro, na ordem abaixo. Cada aviso tem:
     - ate:        último momento em que pode aparecer (horário de Brasília)
     - frequencia: "sempre" | "uma-vez" | "diaria"
     - obrigatorio: true = só fecha pelo botão "Fechar" (sem X, Esc ou clique fora)
   Para mudar datas ou frequência, edite a lista AVISOS.
   ===================================================================== */
(function () {
  const AVISOS = [
    {
      id: "inauguracao-2026-12-01",
      ate: "2026-12-01T23:59:59-03:00",
      frequencia: "sempre",
      obrigatorio: true,
      montar: () => montarInauguracao(),
    },
    {
      // mesma chave do modal anterior: quem já viu não vê de novo
      id: "novidades_2026-11-visual",
      chaveLegada: true,
      ate: "2026-11-05T23:59:59-03:00",
      frequencia: "uma-vez",
      montar: () => montarNovidades(),
    },
    {
      id: "chati-erp-lancamento",
      ate: null,
      frequencia: "diaria",
      montar: () => montarErp(),
    },
  ];

  const INAUGURACAO = new Date("2026-12-01T00:00:00-03:00");

  const reduzirMovimento =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- utilidades ---------------- */
  function usuarioAtual() {
    try {
      const u = JSON.parse(localStorage.getItem("chati_user") || "null");
      return (u && (u.id || u.email)) || "anon";
    } catch (e) {
      return "anon";
    }
  }

  function chave(aviso) {
    // "novidades_..." mantém o mesmo nome usado pelo primeiro modal
    return aviso.chaveLegada
      ? `chati_${aviso.id}_${usuarioAtual()}`
      : `chati_aviso_${aviso.id}_${usuarioAtual()}`;
  }

  function hojeBR() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  }

  function deveMostrar(aviso) {
    if (aviso.ate && Date.now() > Date.parse(aviso.ate)) return false;
    if (aviso.frequencia === "sempre") return true;
    try {
      const visto = localStorage.getItem(chave(aviso));
      if (aviso.frequencia === "uma-vez") return visto !== "1";
      if (aviso.frequencia === "diaria") return visto !== hojeBR();
    } catch (e) {
      return true;
    }
    return true;
  }

  function marcar(aviso) {
    if (aviso.frequencia === "sempre") return;
    try {
      localStorage.setItem(chave(aviso), aviso.frequencia === "diaria" ? hojeBR() : "1");
    } catch (e) {
      /* sem storage: aparece de novo, sem problema */
    }
  }

  function icone(id) {
    return `<svg class="ui-i"><use href="#${id}"/></svg>`;
  }

  const CURSOR = `<span class="wn-cursor"><svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 2-2 6z"/></svg><i></i></span>`;

  /* ---------------- casca do modal ---------------- */
  function abrirModal({ classe, stage, body, obrigatorio, aoAbrir }) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = `wn-overlay ${classe || ""}`;
      wrap.setAttribute("role", obrigatorio ? "alertdialog" : "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.innerHTML = `
        <div class="wn-modal">
          ${
            obrigatorio
              ? ""
              : `<button type="button" class="wn-close" aria-label="Fechar" data-wn-close>
                   <svg class="ui-i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
                 </button>`
          }
          <div class="wn-stage" aria-hidden="true">
            <div class="wn-glow wn-glow-1"></div>
            <div class="wn-glow wn-glow-2"></div>
            ${stage}
          </div>
          <div class="wn-body">${body}</div>
        </div>`;

      document.body.appendChild(wrap);
      document.body.classList.add("wn-open");

      let timers = [];
      let intervalos = [];
      const ctx = {
        wrap,
        later(fn, ms) {
          timers.push(setTimeout(fn, ms));
        },
        every(fn, ms) {
          intervalos.push(setInterval(fn, ms));
        },
      };

      function fechar() {
        timers.forEach(clearTimeout);
        intervalos.forEach(clearInterval);
        timers = [];
        intervalos = [];
        document.removeEventListener("keydown", onKey);
        wrap.classList.add("is-leaving");
        setTimeout(() => {
          wrap.remove();
          if (!document.querySelector(".wn-overlay")) document.body.classList.remove("wn-open");
          resolve();
        }, reduzirMovimento ? 0 : 280);
      }

      function onKey(e) {
        if (e.key === "Escape" && !obrigatorio) fechar();
      }

      wrap.querySelectorAll("[data-wn-close]").forEach((b) => b.addEventListener("click", fechar));
      if (!obrigatorio) {
        wrap.addEventListener("click", (e) => {
          if (e.target === wrap) fechar();
        });
      } else {
        // clique fora: só um "tremidinha" para indicar que precisa clicar em Fechar
        wrap.addEventListener("click", (e) => {
          if (e.target !== wrap) return;
          const m = wrap.querySelector(".wn-modal");
          m.classList.remove("wn-shake");
          void m.offsetWidth;
          m.classList.add("wn-shake");
        });
      }
      document.addEventListener("keydown", onKey);

      if (aoAbrir) aoAbrir(ctx);

      setTimeout(
        () =>
          wrap
            .querySelector(".wn-btn-primary")
            ?.focus({ preventScroll: true, focusVisible: false }),
        50,
      );
    });
  }

  /* =====================================================================
     1) INAUGURAÇÃO OFICIAL — 01/12/2026
     ===================================================================== */
  function montarInauguracao() {
    const confetes = Array.from({ length: 26 }, (_, i) => {
      const cores = ["#ff3355", "#ffd166", "#a78bfa", "#ffffff", "#ff8fab"];
      const left = (i * 37) % 100;
      const delay = ((i * 0.53) % 6).toFixed(2);
      const dur = (5 + ((i * 1.7) % 4)).toFixed(2);
      const size = 5 + (i % 4) * 2;
      return `<i style="left:${left}%;--c:${cores[i % cores.length]};--dl:${delay}s;--du:${dur}s;--s:${size}px;--r:${(i % 2 ? 1 : -1) * (180 + i * 20)}deg"></i>`;
    }).join("");

    const stage = `
      <div class="ia-confetti">${confetes}</div>
      <div class="ia-center">
        <div class="ia-rings"><span></span><span></span><span></span></div>
        <img class="ia-logo" src="/assets/logo-chati-white.png" alt="" />
        <div class="ia-date">
          <span class="ia-date-day">01</span>
          <span class="ia-date-sep"></span>
          <span class="ia-date-rest"><b>Dezembro</b><small>2026</small></span>
        </div>
        <div class="ia-count" id="iaCount">
          <div><strong data-u="d">--</strong><span>dias</span></div>
          <div><strong data-u="h">--</strong><span>horas</span></div>
          <div><strong data-u="m">--</strong><span>min</span></div>
          <div><strong data-u="s">--</strong><span>seg</span></div>
        </div>
      </div>
    `;

    const body = `
      <span class="wn-badge">${icone("i-calendar")} Save the date</span>
      <h2>Inauguração oficial do Chati</h2>
      <p class="ia-when">Terça-feira, 1º de dezembro de 2026</p>
      <p class="wn-lead">
        O Chati vai ser inaugurado oficialmente! Obrigado por fazer parte dessa história desde o
        começo. Marque na agenda: vem muita coisa boa por aí.
      </p>

      <ul class="wn-features">
        <li style="--d:0">
          <span class="wn-f-icon tone-red">${icone("i-zap")}</span>
          <span><strong>Lançamento oficial</strong><small>O Chati chega oficialmente ao mercado.</small></span>
        </li>
        <li style="--d:1">
          <span class="wn-f-icon tone-violet">${icone("i-message")}</span>
          <span><strong>Feito com quem usa</strong><small>Cada melhoria veio do dia a dia da sua equipe.</small></span>
        </li>
      </ul>

      <div class="wn-actions">
        <button type="button" class="wn-btn wn-btn-primary" data-wn-close>Fechar</button>
      </div>
    `;

    return abrirModal({
      classe: "is-inauguracao",
      stage,
      body,
      obrigatorio: true,
      aoAbrir(ctx) {
        const box = ctx.wrap.querySelector("#iaCount");
        const pad = (n) => String(n).padStart(2, "0");
        function tick() {
          let ms = INAUGURACAO.getTime() - Date.now();
          if (ms <= 0) {
            box.innerHTML = `<div class="ia-today">É hoje! 🎉</div>`;
            return false;
          }
          const d = Math.floor(ms / 86400000);
          ms -= d * 86400000;
          const h = Math.floor(ms / 3600000);
          ms -= h * 3600000;
          const m = Math.floor(ms / 60000);
          const s = Math.floor((ms - m * 60000) / 1000);
          const vals = { d, h: pad(h), m: pad(m), s: pad(s) };
          box.querySelectorAll("[data-u]").forEach((el) => {
            const v = String(vals[el.dataset.u]);
            if (el.textContent !== v) {
              el.textContent = v;
              el.classList.remove("flip");
              void el.offsetWidth;
              el.classList.add("flip");
            }
          });
          return true;
        }
        if (tick()) ctx.every(tick, 1000);
      },
    });
  }

  /* =====================================================================
     2) NOVIDADES — atualização visual + modo claro/escuro
     ===================================================================== */
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

  function montarNovidades() {
    const escuro = document.body.classList.contains("dark");

    const stage = `
      <div class="wn-window ${escuro ? "is-dark" : ""}" data-win>
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
            <span class="wn-toggle">
              <span class="wn-toggle-knob">${icone("i-sun")}${icone("i-moon")}</span>
            </span>
          </div>
          <div class="wn-m-hero">
            <span class="wn-m-hero-icon"></span>
            <span class="wn-m-lines"><i style="width:55%"></i><i style="width:35%"></i></span>
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
        ${CURSOR}
      </div>
      <div class="wn-mode-label" data-label>${escuro ? "Modo escuro" : "Modo claro"}</div>
    `;

    const body = `
      <span class="wn-badge">${icone("i-zap")} Novidade</span>
      <h2>O Chati está de cara nova</h2>
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
        <button type="button" class="wn-btn wn-btn-ghost" data-try-theme>
          ${escuro ? icone("i-sun") : icone("i-moon")}
          <span>${escuro ? "Experimentar modo claro" : "Experimentar modo escuro"}</span>
        </button>
        <button type="button" class="wn-btn wn-btn-primary" data-wn-close>Começar a usar</button>
      </div>
    `;

    return abrirModal({
      stage,
      body,
      aoAbrir(ctx) {
        const win = ctx.wrap.querySelector("[data-win]");
        const cursor = win.querySelector(".wn-cursor");
        const label = ctx.wrap.querySelector("[data-label]");

        function ciclo() {
          cursor.classList.add("go");
          ctx.later(() => cursor.classList.add("click"), 900);
          ctx.later(() => {
            win.classList.toggle("is-dark");
            label.textContent = win.classList.contains("is-dark") ? "Modo escuro" : "Modo claro";
            label.classList.remove("pop");
            void label.offsetWidth;
            label.classList.add("pop");
          }, 1050);
          ctx.later(() => cursor.classList.remove("click"), 1300);
          ctx.later(() => cursor.classList.remove("go"), 1700);
          ctx.later(ciclo, 3400);
        }
        if (!reduzirMovimento) ctx.later(ciclo, 1200);

        const tryBtn = ctx.wrap.querySelector("[data-try-theme]");
        tryBtn.addEventListener("click", () => {
          if (typeof window.toggleTheme === "function") window.toggleTheme();
          const e = document.body.classList.contains("dark");
          tryBtn.innerHTML = `${e ? icone("i-sun") : icone("i-moon")}<span>${
            e ? "Voltar para o modo claro" : "Voltar para o modo escuro"
          }</span>`;
        });
      },
    });
  }

  /* =====================================================================
     3) CHATI ERP — navegação animada pelo sistema
     ===================================================================== */
  const ERP_MENU = [
    { nome: "Dashboard", cena: "dash", legenda: "Visão completa da operação em tempo real" },
    { nome: "Produtos", cena: "prod", legenda: "Cadastro de peças com fotos e pendências" },
    { nome: "Criar anúncios", cena: "ia", legenda: "Anúncios gerados com inteligência artificial" },
    { nome: "Fila de publicação", cena: "pub", legenda: "Publicação no Mercado Livre e na Shopee" },
  ];

  function montarErp() {
    const menu = ERP_MENU.map(
      (m, i) => `<span class="erp-nav ${i === 0 ? "is-active" : ""}" data-i="${i}"><b></b>${m.nome}</span>`,
    ).join("");

    const linhasProd = [
      ["Roda Traseira Titan 150", "ok"],
      ["Chicote Elite 125", "warn"],
      ["Kit Relação CG 160", "ok"],
      ["Farol Fan 160", "ok"],
    ]
      .map(
        ([n, s], i) => `
        <div class="erp-row" style="--d:${i}">
          <span class="erp-thumb"></span>
          <span class="erp-row-name">${n}</span>
          <span class="erp-tag ${s}">${s === "ok" ? "Pronto" : "Pendente"}</span>
        </div>`,
      )
      .join("");

    const linhasPub = [
      ["ML", "Roda Traseira Titan 150"],
      ["S", "Kit Relação CG 160"],
      ["ML", "Farol Fan 160"],
    ]
      .map(
        ([c, n], i) => `
        <div class="erp-pub" style="--d:${i}">
          <span class="erp-ch ${c === "S" ? "shopee" : "ml"}">${c}</span>
          <span class="erp-pub-main"><span>${n}</span><i><b></b></i></span>
          <span class="erp-ok">${icone("i-check")}</span>
        </div>`,
      )
      .join("");

    const stage = `
      <div class="erp-window" data-erp>
        <div class="erp-side">
          <img class="erp-logo" src="/assets/logo-chati-erp-white.png" alt="" />
          ${menu}
        </div>
        <div class="erp-main">
          <div class="erp-scene is-active" data-scene="dash">
            <div class="erp-h">Dashboard</div>
            <div class="erp-kpis">
              <div><small>Cadastrados hoje</small><strong data-count="128">0</strong></div>
              <div><small>Publicados</small><strong data-count="96">0</strong></div>
              <div><small>Vendas</small><strong data-count="41">0</strong></div>
            </div>
            <div class="erp-chart">${[38, 55, 46, 70, 62, 84, 95]
              .map((h, i) => `<i style="--h:${h}%;--d:${i}"></i>`)
              .join("")}</div>
          </div>

          <div class="erp-scene" data-scene="prod">
            <div class="erp-h">Produtos <span class="erp-btn">+ Nova peça</span></div>
            ${linhasProd}
          </div>

          <div class="erp-scene" data-scene="ia">
            <div class="erp-h">Criar anúncios</div>
            <div class="erp-ai">
              <div class="erp-ai-photo"><span></span><span></span><span></span></div>
              <div class="erp-ai-text">
                <span class="erp-ai-badge">${icone("i-zap")} IA escrevendo...</span>
                <i style="--w:92%;--d:0"></i>
                <i style="--w:78%;--d:1"></i>
                <i style="--w:86%;--d:2"></i>
                <i style="--w:60%;--d:3"></i>
              </div>
            </div>
            <div class="erp-progress"><b></b></div>
          </div>

          <div class="erp-scene" data-scene="pub">
            <div class="erp-h">Fila de publicação</div>
            ${linhasPub}
          </div>
        </div>
        ${CURSOR}
      </div>
      <div class="wn-mode-label" data-caption>${ERP_MENU[0].legenda}</div>
    `;

    const body = `
      <img class="erp-brand erp-brand-light" src="/assets/logo-chati-erp-dark.png" alt="Chati ERP" />
      <img class="erp-brand erp-brand-dark" src="/assets/logo-chati-erp-white.png" alt="" />
      <span class="wn-badge is-violet">${icone("i-zap")} Em breve</span>
      <h2>Conheça o Chati ERP</h2>
      <p class="wn-lead">
        O ERP que vai revolucionar a forma de vender online. Do cadastro da peça ao anúncio
        publicado, tudo em um só lugar e com inteligência artificial trabalhando por você.
      </p>
      <ul class="wn-features">
        <li style="--d:0">
          <span class="wn-f-icon tone-red">${icone("i-package")}</span>
          <span><strong>Cadastro com fotos</strong><small>Produtos organizados, com pendências apontadas na hora.</small></span>
        </li>
        <li style="--d:1">
          <span class="wn-f-icon tone-violet">${icone("i-zap")}</span>
          <span><strong>Anúncios com IA</strong><small>Títulos e descrições prontos em segundos.</small></span>
        </li>
        <li style="--d:2">
          <span class="wn-f-icon tone-green">${icone("i-send")}</span>
          <span><strong>Mercado Livre e Shopee</strong><small>Publicação e vendas acompanhadas em um só painel.</small></span>
        </li>
      </ul>
      <div class="wn-actions">
        <button type="button" class="wn-btn wn-btn-ghost" data-wn-close>Agora não</button>
        <a class="wn-btn wn-btn-primary" href="https://chatierp.com.br" target="_blank" rel="noopener" data-wn-close>
          Quero conhecer
        </a>
      </div>
    `;

    return abrirModal({
      classe: "is-erp",
      stage,
      body,
      aoAbrir(ctx) {
        const win = ctx.wrap.querySelector("[data-erp]");
        const cursor = win.querySelector(".wn-cursor");
        const caption = ctx.wrap.querySelector("[data-caption]");
        const navs = [...win.querySelectorAll(".erp-nav")];
        const scenes = [...win.querySelectorAll(".erp-scene")];
        let atual = 0;

        function contar(scene) {
          scene.querySelectorAll("[data-count]").forEach((el) => {
            const alvo = Number(el.dataset.count);
            const t0 = performance.now();
            const dur = 900;
            function passo(t) {
              const p = Math.min((t - t0) / dur, 1);
              el.textContent = Math.round(alvo * (1 - Math.pow(1 - p, 3)));
              if (p < 1 && document.body.contains(el)) requestAnimationFrame(passo);
            }
            requestAnimationFrame(passo);
          });
        }

        function mostrar(i) {
          atual = i;
          navs.forEach((n, k) => n.classList.toggle("is-active", k === i));
          scenes.forEach((s) => {
            const on = s.dataset.scene === ERP_MENU[i].cena;
            s.classList.remove("is-active");
            if (on) {
              void s.offsetWidth; // reinicia animações da cena
              s.classList.add("is-active");
              contar(s);
            }
          });
          caption.textContent = ERP_MENU[i].legenda;
          caption.classList.remove("pop");
          void caption.offsetWidth;
          caption.classList.add("pop");
        }

        function moverCursorPara(i) {
          const nav = navs[i];
          const wr = win.getBoundingClientRect();
          const nr = nav.getBoundingClientRect();
          // posição relativa sem escala/perspectiva exata: usa offsets do layout
          cursor.style.left = `${nav.offsetLeft + nav.offsetWidth * 0.55}px`;
          cursor.style.top = `${nav.offsetTop + nav.offsetHeight * 0.45}px`;
          return wr && nr;
        }

        contar(scenes[0]);

        function ciclo() {
          const prox = (atual + 1) % ERP_MENU.length;
          moverCursorPara(prox);
          ctx.later(() => cursor.classList.add("click"), 850);
          ctx.later(() => mostrar(prox), 950);
          ctx.later(() => cursor.classList.remove("click"), 1200);
          ctx.later(() => {
            cursor.style.left = "72%";
            cursor.style.top = "70%";
          }, 1500);
          ctx.later(ciclo, 3600);
        }

        if (!reduzirMovimento) ctx.later(ciclo, 1600);
      },
    });
  }

  /* ---------------- fila ---------------- */
  async function iniciar() {
    try {
      if (!localStorage.getItem("chati_user")) return;
    } catch (e) {
      return;
    }
    const fila = AVISOS.filter(deveMostrar);
    for (const aviso of fila) {
      await aviso.montar();
      marcar(aviso);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Para testar/abrir manualmente no console:
  window.chatiAvisos = {
    inauguracao: montarInauguracao,
    novidades: montarNovidades,
    erp: montarErp,
  };

  function agendar() {
    setTimeout(iniciar, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", agendar);
  } else {
    agendar();
  }
})();
