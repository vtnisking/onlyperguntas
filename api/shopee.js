import { createClient } from "@supabase/supabase-js";
import { createOAuthState } from "../lib/oauth.js";
import {
  ShopeeError,
  shopeeConfig,
  buildAuthUrl,
  listarConversas,
  listarMensagens,
  marcarComoLida,
  enviarMensagem,
  separarConversaId,
} from "../lib/shopee.js";

class ApiError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getRequiredEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    throw new ApiError(
      `Variável de ambiente ${name} não configurada`,
      500,
    );
  }

  return value;
}

function getBearerToken(req) {
  const authorization =
    req.headers?.authorization ||
    req.headers?.Authorization;

  if (!authorization || typeof authorization !== "string") {
    throw new ApiError(
      "Token de autenticação não enviado",
      401,
    );
  }

  const [type, token] = authorization.trim().split(/\s+/);

  if (type?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError(
      "Formato de autenticação inválido",
      401,
    );
  }

  return token;
}

async function getAuthenticatedContext(req, supabase) {
  const accessToken = getBearerToken(req);

  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);

  if (userError || !userData?.user) {
    console.error(
      "Erro ao validar sessão da Shopee:",
      userError,
    );

    throw new ApiError(
      "Sessão inválida ou expirada",
      401,
    );
  }

  const authUser = userData.user;

  const { data: profile, error: profileError } = await supabase
    .from("users_app")
    .select(
      "id, auth_id, name, email, role, status, company_id",
    )
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao consultar users_app:",
      profileError,
    );

    throw new ApiError(
      "Erro ao consultar o usuário do sistema",
      500,
    );
  }

  if (!profile) {
    throw new ApiError(
      "Usuário não cadastrado no sistema",
      403,
    );
  }

  if (profile.status && profile.status !== "active") {
    throw new ApiError(
      "Este usuário está desativado",
      403,
    );
  }

  if (!profile.company_id) {
    throw new ApiError(
      "Empresa do usuário não encontrada",
      403,
    );
  }

  return {
    accessToken,
    authUser,
    profile,
    companyId: profile.company_id,
  };
}

async function getShopeeStores(supabase, companyId) {
  const { data: stores, error } = await supabase
    .from("stores")
    .select(
      [
        "id",
        "name",
        "platform",
        "seller_id",
        "company_id",
        "access_token",
        "refresh_token",
        "created_at",
        "connected_at",
      ].join(", "),
    )
    .eq("company_id", companyId)
    .eq("platform", "shopee")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "Erro ao carregar lojas Shopee:",
      error,
    );

    throw new ApiError(
      "Erro ao carregar as lojas da Shopee",
      500,
    );
  }

  return stores || [];
}

function assertMethod(req, res, method) {
  if (req.method === method) {
    return;
  }

  res.setHeader("Allow", method);
  throw new ApiError("Método não permitido", 405);
}

function getStringQuery(req, name) {
  const value = req.query?.[name];

  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return typeof value === "string" ? value.trim() : "";
}

function getJsonBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new ApiError("Corpo JSON inválido", 400);
    }
  }

  return {};
}

function lojaDaConversa(stores, valor) {
  const { storeId, conversationId } = separarConversaId(valor);
  const store = stores.find((s) => String(s.id) === storeId);
  if (!store) throw new ApiError("Esta conversa não pertence a uma loja Shopee sua", 404);
  return { store, conversationId };
}

async function handleConnect({ req, res, context }) {
  assertMethod(req, res, "GET");
  const cfg = shopeeConfig();
  const redirectPath = getStringQuery(req, "redirect") || "/app";
  const state = createOAuthState({
    provider: "shopee",
    companyId: context.companyId,
    profileId: context.profile.id,
    authId: context.authUser.id,
    redirectPath,
  });
  return res.status(200).json({
    success: true,
    provider: "shopee",
    environment: cfg.environment,
    authorization_url: buildAuthUrl(cfg, state),
  });
}

async function handleConversations({ req, res, stores, supabase }) {
  assertMethod(req, res, "GET");
  const unreadOnly = getStringQuery(req, "unread_only") === "true";
  const search = getStringQuery(req, "search").toLowerCase();

  if (!stores.length) {
    return res.status(200).json({
      success: true,
      conversations: [],
      summary: { today: 0, total: 0, pending: 0, unread: 0 },
      warnings: ["Nenhuma loja Shopee conectada."],
    });
  }

  const cfg = shopeeConfig();
  const warnings = [];
  const resultados = await Promise.all(
    stores.map((store) =>
      listarConversas(cfg, supabase, store, { tipo: unreadOnly ? "unread" : "all" }).catch((e) => {
        warnings.push(`${store.name}: ${e.message}`);
        return [];
      }),
    ),
  );

  let conversations = resultados
    .flat()
    .sort((a, b) => new Date(b.last_message.created_at || 0) - new Date(a.last_message.created_at || 0));

  if (search) {
    conversations = conversations.filter((c) =>
      `${c.customer.name} ${c.last_message.text}`.toLowerCase().includes(search),
    );
  }

  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const diaDe = (iso) =>
    iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "";
  conversations.forEach((c) => {
    c.is_today = diaDe(c.last_message.created_at) === hoje;
  });

  if (warnings.length && !conversations.length && warnings.length === stores.length) {
    throw new ApiError(warnings[0].split(": ").slice(1).join(": ") || "Erro ao carregar conversas", 502);
  }

  return res.status(200).json({
    success: true,
    conversations,
    summary: {
      today: conversations.filter((c) => c.is_today).length,
      total: conversations.length,
      pending: conversations.filter((c) => c.unread_count > 0).length,
      unread: conversations.reduce((n, c) => n + c.unread_count, 0),
    },
    warnings,
  });
}

async function handleMessages({ req, res, stores, supabase }) {
  assertMethod(req, res, "GET");
  const valor = getStringQuery(req, "conversation_id");
  if (!valor) throw new ApiError("conversation_id é obrigatório", 400);
  const { store, conversationId } = lojaDaConversa(stores, valor);
  const cfg = shopeeConfig();
  const messages = await listarMensagens(cfg, supabase, store, conversationId);
  const ultima = [...messages].reverse().find((m) => m.direction === "incoming");
  marcarComoLida(cfg, supabase, store, conversationId, ultima?.id);
  return res.status(200).json({ success: true, conversation_id: valor, messages, warnings: [] });
}

async function handleSendMessage({ req, res, stores, supabase }) {
  assertMethod(req, res, "POST");

  const body = getJsonBody(req);

  const conversationId = String(
    body.conversation_id || "",
  ).trim();

  const message = String(body.message || "").trim();

  if (!conversationId) {
    throw new ApiError(
      "conversation_id é obrigatório",
      400,
    );
  }

  if (!message) {
    throw new ApiError(
      "A mensagem não pode estar vazia",
      400,
    );
  }

  if (message.length > 1000) {
    throw new ApiError(
      "A mensagem ultrapassa o limite permitido",
      400,
    );
  }

  const { store, conversationId: idShopee } = lojaDaConversa(stores, conversationId);
  const result = await enviarMensagem(shopeeConfig(), supabase, store, idShopee, message);

  return res.status(200).json({
    success: true,
    conversation_id: conversationId,
    message_id: result?.message_id ? String(result.message_id) : null,
    data: result || null,
  });
}

async function handleTest({
  req,
  res,
  stores,
  context,
}) {
  assertMethod(req, res, "GET");

  return res.status(200).json({
    success: true,
    message: "API da Shopee autenticada e funcionando.",
    company_id: context.companyId,
    user: {
      id: context.profile.id,
      name: context.profile.name,
      email: context.profile.email,
      role: context.profile.role,
    },
    total_stores: stores.length,
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      platform: store.platform,
      seller_id: store.seller_id,
      connected_at:
        store.connected_at || store.created_at,
    })),
  });
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0",
  );

  try {
    const supabaseUrl =
      getRequiredEnvironment("SUPABASE_URL");

    const serviceRoleKey =
      getRequiredEnvironment("CHATI_SUPABASE_SECRET_KEY");

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const context = await getAuthenticatedContext(
      req,
      supabase,
    );

    const stores = await getShopeeStores(
      supabase,
      context.companyId,
    );

    const action = getStringQuery(req, "action");

    if (!action) {
      throw new ApiError("action é obrigatório", 400);
    }


    if (action === "connect") {
  return handleConnect({
    req,
    res,
    context,
  });
}


    if (action === "test") {
      return handleTest({
        req,
        res,
        stores,
        context,
      });
    }

    if (action === "conversations") {
      return handleConversations({
        req,
        res,
        stores,
        supabase,
      });
    }

    if (action === "messages") {
      return handleMessages({
        req,
        res,
        stores,
        supabase,
      });
    }

    if (action === "send_message") {
      return handleSendMessage({
        req,
        res,
        stores,
        supabase,
      });
    }

    throw new ApiError(
      "Ação da Shopee não encontrada",
      404,
    );
  } catch (error) {
    console.error("Erro em /api/shopee:", error);

    const statusCode =
      error instanceof ApiError || error instanceof ShopeeError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "Erro interno na API da Shopee",
      details:
        error instanceof ApiError || error instanceof ShopeeError
          ? error.details
          : null,
    });
  }
}
