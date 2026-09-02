import { createClient } from "@supabase/supabase-js";
import { createOAuthState } from "../lib/oauth.js";

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

async function fetchShopeeConversations({
  stores,
  period,
  unreadOnly,
  search,
}) {
  void period;
  void unreadOnly;
  void search;

  if (!stores.length) {
    return {
      conversations: [],
      summary: {
        today: 0,
        total: 0,
        pending: 0,
        unread: 0,
      },
      warnings: ["Nenhuma loja Shopee conectada."],
    };
  }

  throw new ApiError(
    "A conta Shopee está cadastrada, mas a consulta oficial de conversas ainda não foi implementada.",
    501,
  );
}

async function fetchShopeeMessages({
  stores,
  conversationId,
}) {
  void conversationId;

  if (!stores.length) {
    return {
      messages: [],
      warnings: ["Nenhuma loja Shopee conectada."],
    };
  }

  throw new ApiError(
    "A conta Shopee está cadastrada, mas a consulta oficial de mensagens ainda não foi implementada.",
    501,
  );
}

async function sendShopeeMessage({
  stores,
  conversationId,
  message,
}) {
  void conversationId;
  void message;

  if (!stores.length) {
    throw new ApiError(
      "Nenhuma loja Shopee conectada.",
      409,
    );
  }

  throw new ApiError(
    "A conta Shopee está cadastrada, mas o envio oficial de mensagens ainda não foi implementado.",
    501,
  );
}

async function handleConnect({
  req,
  res,
  context,
}) {
  assertMethod(req, res, "GET");

  const partnerId =
    getRequiredEnvironment(
      "SHOPEE_TEST_PARTNER_ID",
    );

  const redirectUri =
    getRequiredEnvironment(
      "SHOPEE_TEST_REDIRECT_URI",
    );

  const redirectPath =
    getStringQuery(req, "redirect") || "/app";

  const state = createOAuthState({
    provider: "shopee",
    companyId: context.companyId,
    profileId: context.profile.id,
    authId: context.authUser.id,
    redirectPath,
  });

  const authorizationUrl = new URL(
  "https://open.test-stable.shopee.com/auth",
);

  authorizationUrl.searchParams.set(
    "partner_id",
    partnerId,
  );

  authorizationUrl.searchParams.set(
    "auth_type",
    "seller",
  );

  authorizationUrl.searchParams.set(
    "redirect_uri",
    redirectUri,
  );

  authorizationUrl.searchParams.set(
    "response_type",
    "code",
  );

  authorizationUrl.searchParams.set(
    "state",
    state,
  );

  return res.status(200).json({
    success: true,
    provider: "shopee",
    authorization_url:
      authorizationUrl.toString(),
  });
}

async function handleConversations({ req, res, stores }) {
  assertMethod(req, res, "GET");

  const period = getStringQuery(req, "period") || "all";
  const unreadOnly =
    getStringQuery(req, "unread_only") === "true";
  const search = getStringQuery(req, "search");

  const result = await fetchShopeeConversations({
    stores,
    period,
    unreadOnly,
    search,
  });

  return res.status(200).json({
    success: true,
    conversations: result.conversations || [],
    summary: result.summary || {
      today: 0,
      total: 0,
      pending: 0,
      unread: 0,
    },
    warnings: result.warnings || [],
  });
}

async function handleMessages({ req, res, stores }) {
  assertMethod(req, res, "GET");

  const conversationId =
    getStringQuery(req, "conversation_id");

  if (!conversationId) {
    throw new ApiError(
      "conversation_id é obrigatório",
      400,
    );
  }

  const result = await fetchShopeeMessages({
    stores,
    conversationId,
  });

  return res.status(200).json({
    success: true,
    conversation_id: conversationId,
    messages: result.messages || [],
    warnings: result.warnings || [],
  });
}

async function handleSendMessage({ req, res, stores }) {
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

  if (message.length > 5000) {
    throw new ApiError(
      "A mensagem ultrapassa o limite permitido",
      400,
    );
  }

  const result = await sendShopeeMessage({
    stores,
    conversationId,
    message,
  });

  return res.status(200).json({
    success: true,
    conversation_id: conversationId,
    message_id: result?.message_id || null,
    data: result?.data || null,
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
      });
    }

    if (action === "messages") {
      return handleMessages({
        req,
        res,
        stores,
      });
    }

    if (action === "send_message") {
      return handleSendMessage({
        req,
        res,
        stores,
      });
    }

    throw new ApiError(
      "Ação da Shopee não encontrada",
      404,
    );
  } catch (error) {
    console.error("Erro em /api/shopee:", error);

    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "Erro interno na API da Shopee",
      details:
        error instanceof ApiError
          ? error.details
          : null,
    });
  }
}
