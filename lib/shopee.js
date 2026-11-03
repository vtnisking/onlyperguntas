/**
 * Cliente da Shopee Open Platform (API v2).
 *
 * Assinatura (HMAC-SHA256 com a Partner Key):
 *   - APIs públicas / auth: partner_id + path + timestamp
 *   - APIs da loja:         partner_id + path + timestamp + access_token + shop_id
 *
 * Tokens: o access_token dura ~4h e o refresh_token é de uso único (cada
 * renovação devolve um novo, que precisa ser salvo na hora).
 *
 * Variáveis de ambiente (Vercel):
 *   SHOPEE_ENV               "production" ou "sandbox" (padrão: sandbox)
 *   SHOPEE_PARTNER_ID        Partner ID do app em produção (Live)
 *   SHOPEE_PARTNER_KEY       Partner Key do app em produção (Live)
 *   SHOPEE_TEST_PARTNER_ID   Partner ID de teste (sandbox)
 *   SHOPEE_TEST_PARTNER_KEY  Partner Key de teste (sandbox)
 *   SHOPEE_REDIRECT_URI      ex.: https://chatiapp.com.br/api/shopee-callback
 *                            (opcional: SHOPEE_TEST_REDIRECT_URI para o sandbox)
 *   SHOPEE_HOST              opcional, sobrescreve o endereço da API
 */
import crypto from "node:crypto";

export class ShopeeError extends Error {
  constructor(message, statusCode = 502, code = null, details = null) {
    super(message);
    this.name = "ShopeeError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const HOSTS = {
  production: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
};

function env(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function required(name) {
  const v = env(name);
  if (!v) throw new ShopeeError(`Variável de ambiente ${name} não configurada na Vercel`, 500, "config");
  return v;
}

export function shopeeConfig() {
  const environment = (env("SHOPEE_ENV") || "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(environment)) {
    throw new ShopeeError("SHOPEE_ENV deve ser sandbox ou production", 500, "config");
  }
  const prod = environment === "production";
  const partnerId = required(prod ? "SHOPEE_PARTNER_ID" : "SHOPEE_TEST_PARTNER_ID");
  const partnerKey = required(prod ? "SHOPEE_PARTNER_KEY" : "SHOPEE_TEST_PARTNER_KEY");
  const redirectUri = prod
    ? required("SHOPEE_REDIRECT_URI")
    : env("SHOPEE_TEST_REDIRECT_URI") || required("SHOPEE_REDIRECT_URI");
  const host = (env("SHOPEE_HOST") || HOSTS[environment]).replace(/\/+$/, "");
  if (!/^\d+$/.test(partnerId)) {
    throw new ShopeeError("O Partner ID da Shopee deve conter apenas números", 500, "config");
  }
  return { environment, partnerId, partnerKey, redirectUri, host };
}

export function sign(cfg, path, timestamp, accessToken = "", shopId = "") {
  const base = `${cfg.partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", cfg.partnerKey).update(base).digest("hex");
}

const now = () => Math.floor(Date.now() / 1000);

/** Link para o lojista autorizar o app (Shop Authorization). */
export function buildAuthUrl(cfg, state) {
  const path = "/api/v2/shop/auth_partner";
  const ts = now();
  const redirect = new URL(cfg.redirectUri);
  if (state) redirect.searchParams.set("state", state);
  const url = new URL(cfg.host + path);
  url.searchParams.set("partner_id", cfg.partnerId);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("sign", sign(cfg, path, ts));
  url.searchParams.set("redirect", redirect.toString());
  return url.toString();
}

async function call(cfg, method, path, { query = {}, body, accessToken, shopId } = {}) {
  const ts = now();
  const url = new URL(cfg.host + path);
  url.searchParams.set("partner_id", cfg.partnerId);
  url.searchParams.set("timestamp", String(ts));
  if (accessToken) {
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("shop_id", String(shopId));
    url.searchParams.set("sign", sign(cfg, path, ts, accessToken, shopId));
  } else {
    url.searchParams.set("sign", sign(cfg, path, ts));
  }
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new ShopeeError("Não foi possível falar com a Shopee agora. Tente de novo.", 504, "network");
  }

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!data) {
    console.error("[shopee] resposta inválida", path, resp.status, text.slice(0, 300));
    throw new ShopeeError("A Shopee respondeu de forma inesperada", 502, "bad_response");
  }
  if (data.error) {
    console.error("[shopee] erro", path, data.error, data.message, data.request_id);
    throw new ShopeeError(traduzirErro(data), resp.status >= 400 ? resp.status : 400, data.error, {
      request_id: data.request_id,
      message: data.message,
    });
  }
  return data;
}

function traduzirErro(data) {
  const e = String(data.error || "");
  const m = String(data.message || "");
  if (/sign/i.test(e) || /sign/i.test(m)) return "Assinatura recusada pela Shopee. Confira o Partner ID e a Partner Key na Vercel.";
  if (/invalid_acc|access_token|invalid_token/i.test(e + m)) return "O acesso à loja Shopee expirou. Conecte a loja de novo em Ajustes.";
  if (/permission|no_permission|not_allowed/i.test(e + m)) return "O app da Shopee não tem permissão para esta função. Ative a permissão no Open Platform.";
  if (/partner/i.test(e)) return "Partner ID não reconhecido pela Shopee. Confira o ambiente (sandbox ou produção).";
  return m || e || "A Shopee recusou a solicitação";
}

/* ---------------- Autorização e tokens ---------------- */

export async function getTokens(cfg, code, shopId) {
  const data = await call(cfg, "POST", "/api/v2/auth/token/get", {
    body: { code, shop_id: Number(shopId), partner_id: Number(cfg.partnerId) },
  });
  if (!data.access_token || !data.refresh_token) {
    throw new ShopeeError("A Shopee não retornou os tokens esperados", 502, "no_tokens");
  }
  return data;
}

export async function refreshTokens(cfg, refreshToken, shopId) {
  const data = await call(cfg, "POST", "/api/v2/auth/access_token/get", {
    body: { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(cfg.partnerId) },
  });
  if (!data.access_token || !data.refresh_token) {
    throw new ShopeeError("Não foi possível renovar o acesso à Shopee. Conecte a loja de novo.", 401, "refresh_failed");
  }
  return data;
}

const ERROS_DE_TOKEN = /invalid_acc|access_token|invalid_token|error_auth/i;

/**
 * Chama uma API da loja. Se o token tiver expirado, renova uma vez,
 * salva os novos tokens no Supabase e repete a chamada.
 */
export async function shopCall(cfg, supabase, store, method, path, opts = {}) {
  const shopId = String(store.seller_id);
  try {
    return await call(cfg, method, path, { ...opts, accessToken: store.access_token, shopId });
  } catch (err) {
    if (!(err instanceof ShopeeError) || !ERROS_DE_TOKEN.test(String(err.code) + String(err.details?.message || ""))) {
      throw err;
    }
    const novo = await refreshTokens(cfg, store.refresh_token, shopId);
    const { error } = await supabase
      .from("stores")
      .update({ access_token: novo.access_token, refresh_token: novo.refresh_token })
      .eq("id", store.id);
    if (error) console.error("[shopee] falha ao salvar tokens renovados", error);
    store.access_token = novo.access_token;
    store.refresh_token = novo.refresh_token;
    return call(cfg, method, path, { ...opts, accessToken: store.access_token, shopId });
  }
}

export async function getShopInfo(cfg, accessToken, shopId) {
  try {
    const data = await call(cfg, "GET", "/api/v2/shop/get_shop_info", { accessToken, shopId: String(shopId) });
    return data.shop_name ? data : data.response || data;
  } catch (e) {
    console.warn("[shopee] get_shop_info falhou", e.message);
    return null;
  }
}

/* ---------------- Chat (sellerchat) ---------------- */

const nanoParaIso = (v) => {
  const n = Number(v);
  if (!n) return null;
  // a Shopee usa nanossegundos em conversas e segundos em mensagens
  const ms = n > 1e15 ? n / 1e6 : n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
};

function textoDaMensagem(tipo, conteudo = {}) {
  if (conteudo.text) return conteudo.text;
  const rotulos = {
    image: "📷 Imagem",
    sticker: "Figurinha",
    video: "🎬 Vídeo",
    item: "🛍️ Produto",
    order: "📦 Pedido",
    voucher: "🎟️ Cupom",
    bundle_message: "Mensagem automática",
  };
  return rotulos[tipo] || (tipo ? `[${tipo}]` : "");
}

/** id único entre lojas: "<id da loja no Chati>:<conversation_id da Shopee>" */
export const conversaId = (store, conversationId) => `${store.id}:${conversationId}`;

export function separarConversaId(valor) {
  const s = String(valor || "");
  const i = s.indexOf(":");
  if (i < 1) throw new ShopeeError("Conversa inválida", 400, "bad_conversation");
  return { storeId: s.slice(0, i), conversationId: s.slice(i + 1) };
}

export async function listarConversas(cfg, supabase, store, { tipo = "all", tamanho = 60 } = {}) {
  const data = await shopCall(cfg, supabase, store, "GET", "/api/v2/sellerchat/get_conversation_list", {
    query: { direction: "latest", type: tipo, page_size: tamanho },
  });
  const lista = data.response?.conversations || [];
  return lista.map((c) => ({
    id: conversaId(store, c.conversation_id),
    conversation_id: String(c.conversation_id),
    store_id: store.id,
    store_name: store.name,
    to_id: c.to_id,
    customer: { name: c.to_name || "Cliente Shopee", username: c.to_name, avatar_url: c.to_avatar || "" },
    last_message: {
      text: textoDaMensagem(c.latest_message_type, c.latest_message_content),
      created_at: nanoParaIso(c.last_message_timestamp),
    },
    unread_count: Number(c.unread_count || 0),
    pinned: Boolean(c.pinned),
  }));
}

export async function listarMensagens(cfg, supabase, store, conversationId, { tamanho = 50 } = {}) {
  const data = await shopCall(cfg, supabase, store, "GET", "/api/v2/sellerchat/get_message", {
    query: { conversation_id: conversationId, page_size: tamanho },
  });
  const lista = data.response?.messages || [];
  const lojaId = String(store.seller_id);
  return lista
    .map((m) => ({
      id: String(m.message_id),
      text: textoDaMensagem(m.message_type, m.content),
      created_at: nanoParaIso(m.created_timestamp),
      direction: String(m.from_shop_id || "") === lojaId ? "outgoing" : "incoming",
      type: m.message_type,
      image_url: m.content?.url || null,
    }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function marcarComoLida(cfg, supabase, store, conversationId, ultimaMensagemId) {
  if (!ultimaMensagemId) return;
  try {
    await shopCall(cfg, supabase, store, "POST", "/api/v2/sellerchat/read_conversation", {
      body: { conversation_id: Number(conversationId), last_read_message_id: String(ultimaMensagemId) },
    });
  } catch (e) {
    console.warn("[shopee] read_conversation falhou", e.message);
  }
}

export async function enviarMensagem(cfg, supabase, store, conversationId, texto) {
  const conversa = await shopCall(cfg, supabase, store, "GET", "/api/v2/sellerchat/get_one_conversation", {
    query: { conversation_id: conversationId },
  });
  const toId = conversa.response?.to_id;
  if (!toId) throw new ShopeeError("Não encontramos o comprador desta conversa", 404, "no_buyer");
  const data = await shopCall(cfg, supabase, store, "POST", "/api/v2/sellerchat/send_message", {
    body: { to_id: Number(toId), message_type: "text", content: { text: texto } },
  });
  return data.response || {};
}
