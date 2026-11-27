// Gera assets/tema-roxo.css (tema "Dark purple") a partir das cores do Chati.
// Rode depois de mexer nas cores do app.html ou do assets/chati-ui.css:
//   node scripts/gerar-tema-roxo.mjs
//
// Dark purple = tema escuro + destaque roxo + fundos em preto arroxeado (igual ao Chati ERP).
// Em vez de reescrever à mão as ~300 cores vermelhas, este script lê o CSS e gera só as
// declarações que têm cor, trocando vermelho → roxo e cinza-escuro → preto arroxeado.
// Os seletores ganham ":where(.dark.purple)", que não muda o peso (especificidade): como o
// arquivo é carregado por último, cada regra nova vale exatamente onde a original valia.
// Vermelho de erro/perigo/exclusão/atraso continua vermelho (ali a cor é informação).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMANTICO =
  /erro|error|danger|perigo|delet|exclu|remov|block|bloque|disconnect|desconect|cancel|slow|lento|urgent|unavailable|indispon|expir|logout|toast-error|is-error|fail|falh|warn|negativ|invalid|theme-sw/i;

function rgbParaHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslParaRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

/** Cor → versão roxa (ou null se não muda). Mesma regra do Chati ERP. */
export function corRoxa(r, g, b) {
  const [h, s, l] = rgbParaHsl(r, g, b);
  if ((h >= 340 || h <= 12) && s >= 0.45 && l > 0.06 && l < 0.97)
    return hslParaRgb(266, Math.min(s, 0.92), Math.min(0.93, l * 1.45 + 0.07)); // vermelho → roxo
  if (s < 0.22 && l >= 0.03 && l < 0.3) return hslParaRgb(268, Math.max(s, 0.24), l); // cinza-escuro → preto arroxeado
  return null;
}

const hex2 = (n) => n.toString(16).padStart(2, "0");
const COR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/g;

export function trocarCores(valor) {
  return valor.replace(COR, (m, hex, r, g, b, a) => {
    let rgb, alfa = a;
    if (hex) {
      const h = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
      rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      if (h.length === 8) alfa = h.slice(6);
    } else rgb = [r, g, b].map(Number);
    const novo = corRoxa(...rgb);
    if (!novo) return m;
    if (hex) return `#${novo.map(hex2).join("")}${hex.length === 8 ? alfa : ""}`;
    return alfa != null ? `rgba(${novo.join(", ")}, ${alfa})` : `rgb(${novo.join(", ")})`;
  });
}

function dividir(texto, sep) {
  const out = []; let prof = 0, aspas = null, ini = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === aspas && texto[i - 1] !== "\\") aspas = null; continue; }
    if (c === '"' || c === "'") aspas = c;
    else if (c === "(" || c === "[") prof++;
    else if (c === ")" || c === "]") prof--;
    else if (c === sep && prof === 0) { out.push(texto.slice(ini, i)); ini = i + 1; }
  }
  out.push(texto.slice(ini));
  return out.map((x) => x.trim()).filter(Boolean);
}

// Põe o tema no seletor sem mudar a especificidade
function prefixar(seletor) {
  const out = [];
  for (const s of dividir(seletor, ",")) {
    if (/:not\(\.dark\)/.test(s)) continue; // regra só do tema claro
    let m;
    if ((m = s.match(/^((?:html\s+)?body)\.dark(?![\w-])(.*)$/s))) out.push(`${m[1]}.dark:where(.purple)${m[2]}`);
    else if ((m = s.match(/^((?:html\s+)?body)(?![\w-])(.*)$/s))) out.push(`${m[1]}:where(.dark.purple)${m[2]}`);
    else if ((m = s.match(/^(:root|html)(?![\w-])\s*$/s))) out.push(`body:where(.dark.purple)`);
    else if ((m = s.match(/^(:root|html)(?![\w-])(.*)$/s))) out.push(`${m[1]} body:where(.dark.purple)${m[2].startsWith(" ") ? "" : " "}${m[2].trim()}`);
    else out.push(`:where(body.dark.purple) ${s}`);
  }
  return out.join(", ");
}

function regra(seletor, corpo) {
  if (SEMANTICO.test(seletor)) return "";
  const sel = prefixar(seletor);
  if (!sel) return "";
  const novas = [];
  for (const d of dividir(corpo, ";")) {
    const i = d.indexOf(":"); if (i < 0) continue;
    const prop = d.slice(0, i).trim(), valor = d.slice(i + 1).trim();
    if (prop === "--red") continue; // vermelho "de verdade" (erros) fica
    const novo = trocarCores(valor);
    if (novo !== valor) novas.push(`${prop}: ${novo}`);
  }
  return novas.length ? `${sel} { ${novas.join("; ")}; }\n` : "";
}

function percorrer(css) {
  let out = "", i = 0;
  while (i < css.length) {
    const abre = css.indexOf("{", i);
    if (abre < 0) break;
    let prelude = css.slice(i, abre).trim();
    while (/^@[\w-]+[^{]*?;/.test(prelude)) prelude = prelude.replace(/^@[\w-]+[^{]*?;\s*/, "");
    let prof = 1, j = abre + 1;
    while (j < css.length && prof) { if (css[j] === "{") prof++; else if (css[j] === "}") prof--; j++; }
    const corpo = css.slice(abre + 1, j - 1);
    if (/^@(media|supports|container|layer)\b/.test(prelude)) {
      const dentro = percorrer(corpo);
      if (dentro) out += `${prelude} {\n${dentro}}\n`;
    } else if (!prelude.startsWith("@")) out += regra(prelude, corpo);
    i = j;
  }
  return out;
}

// Paleta ajustada à mão (por último e com mais peso: vale para as variáveis)
const PALETA = `
/* ---------- Paleta Dark purple (igual ao Chati ERP) ---------- */
body.dark.purple {
  --bg: #0b0910;
  --surface: #141019;
  --surface2: #1b1622;
  --surface3: #241d2e;
  --border: #2a2235;
  --border2: #3b3049;
  --text: #ece8f4;
  --text2: #aea5be;
  --text3: #827994;
  --accent: #8b3dff;
  --accent2: #b794ff;
  --accent-soft: rgba(139, 61, 255, 0.16);
  --accent-ring: rgba(139, 61, 255, 0.32);
  --grad-red: linear-gradient(135deg, #a66bff 0%, #7a2cf0 100%);
  --grad-red-soft: linear-gradient(135deg, rgba(166, 107, 255, 0.2), rgba(122, 44, 240, 0.06));
  --glow-red: 0 10px 24px -10px rgba(139, 61, 255, 0.75);
  --glow-red-lg: 0 16px 36px -16px rgba(139, 61, 255, 0.6);
  --red: #ef4444;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(160, 110, 255, 0.03);
  --shadow-md: 0 1px 2px rgba(0, 0, 0, 0.55), 0 12px 32px -16px rgba(0, 0, 0, 0.75);
  --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), 0 12px 32px -20px rgba(0, 0, 0, 0.85);
  --card-shadow-hover: 0 1px 2px rgba(0, 0, 0, 0.55), 0 18px 40px -18px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(139, 61, 255, 0.08);
  background: radial-gradient(1200px 600px at 100% -10%, rgba(139, 61, 255, 0.08), transparent 60%), var(--bg);
  background-attachment: fixed;
}
body.dark.purple ::selection { background: rgba(139, 61, 255, 0.4); }
/* "Lento" e atrasos são aviso: continuam vermelhos */
body.dark.purple .rt-badge.is-slow { background: rgba(239, 68, 68, 0.14); color: #f87171; }
body.dark.purple .pd-time.is-slow { color: #f87171; }
body.dark.purple .pd-store-dot.is-slow,
body.dark.purple .rt-dot.is-slow { background: #f87171; }
`;

const app = fs.readFileSync(path.join(raiz, "app.html"), "utf8");
const estiloApp = [...app.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const ui = fs.readFileSync(path.join(raiz, "assets/chati-ui.css"), "utf8");
const css = `${estiloApp}\n${ui}`.replace(/\/\*[\s\S]*?\*\//g, "");

const saida = `/* GERADO por scripts/gerar-tema-roxo.mjs a partir do app.html e do chati-ui.css — não edite à mão.
   Rode de novo depois de mexer em cores: node scripts/gerar-tema-roxo.mjs */
${percorrer(css)}${PALETA}`;
fs.writeFileSync(path.join(raiz, "assets/tema-roxo.css"), saida);
console.log(`assets/tema-roxo.css gerado (${saida.split("\n").length} linhas).`);
