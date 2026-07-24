import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function getRequiredEnvironment(name) {
  const value = process.env[name];

  if (!value) {
    throw new ApiError(
      `${name} não configurado`,
      500,
    );
  }

  return value;
}

function safeCompare(firstValue, secondValue) {
  const firstBuffer = Buffer.from(
    String(firstValue),
    "utf8",
  );

  const secondBuffer = Buffer.from(
    String(secondValue),
    "utf8",
  );

  if (firstBuffer.length !== secondBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer,
  );
}

function verifyOAuthState(state) {
  if (!state || typeof state !== "string") {
    throw new ApiError(
      "State OAuth não informado",
      400,
    );
  }

  const parts = state.split(".");

  if (parts.length !== 2) {
    throw new ApiError(
      "State OAuth inválido",
      400,
    );
  }

  const [encodedPayload, receivedSignature] =
    parts;

  const secret = getRequiredEnvironment(
    "OAUTH_STATE_SECRET",
  );

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (
    !safeCompare(
      receivedSignature,
      expectedSignature,
    )
  ) {
    throw new ApiError(
      "Assinatura OAuth inválida",
      403,
    );
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        "base64url",
      ).toString("utf8"),
    );
  } catch {
    throw new ApiError(
      "Conteúdo do state OAuth inválido",
      400,
    );
  }

  if (payload.provider !== "mercadolivre") {
    throw new ApiError(
      "Provedor OAuth inválido",
      400,
    );
  }

  if (!payload.expires_at) {
    throw new ApiError(
      "State OAuth sem data de validade",
      400,
    );
  }

  if (Date.now() > payload.expires_at) {
    throw new ApiError(
      "A autorização expirou. Inicie a conexão novamente.",
      400,
    );
  }

  if (
    !payload.company_id ||
    !payload.profile_id ||
    !payload.auth_id
  ) {
    throw new ApiError(
      "State OAuth incompleto",
      400,
    );
  }

  return payload;
}

function getApplicationUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }

  const forwardedHost =
    req.headers["x-forwarded-host"];

  const host =
    forwardedHost ||
    req.headers.host ||
    process.env.VERCEL_URL;

  if (!host) {
    throw new ApiError(
      "Não foi possível determinar a URL do sistema",
      500,
    );
  }

  const forwardedProtocol =
    req.headers["x-forwarded-proto"];

  const protocol =
    forwardedProtocol ||
    (host.includes("localhost")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

function getSafeRedirectPath(value) {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }

  return "/";
}

function buildReturnUrl(
  req,
  redirectPath,
  parameters = {},
) {
  const applicationUrl = getApplicationUrl(req);

  const safePath =
    getSafeRedirectPath(redirectPath);

  const destination = new URL(
    safePath,
    applicationUrl,
  );

  for (const [key, value] of Object.entries(
    parameters,
  )) {
    if (
      value !== undefined &&
      value !== null
    ) {
      destination.searchParams.set(
        key,
        String(value),
      );
    }
  }

  return destination.toString();
}

async function exchangeCodeForTokens(code) {
  const clientId = getRequiredEnvironment(
    "MELI_APP_ID",
  );

  const clientSecret = getRequiredEnvironment(
    "MELI_CLIENT_SECRET",
  );

  const redirectUri = getRequiredEnvironment(
    "MELI_REDIRECT_URI",
  );

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(
    "https://api.mercadolibre.com/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    },
  );

  const responseText = await response.text();

  let data = null;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error(
      "Erro ao trocar code por token:",
      response.status,
      responseText,
    );

    throw new ApiError(
      data?.message ||
        data?.error_description ||
        data?.error ||
        "O Mercado Livre recusou a autorização",
      400,
    );
  }

  if (
    !data?.access_token ||
    !data?.refresh_token
  ) {
    throw new ApiError(
      "O Mercado Livre não retornou os tokens esperados",
      502,
    );
  }

  return data;
}

async function getMercadoLivreSeller(
  accessToken,
) {
  const response = await fetch(
    "https://api.mercadolibre.com/users/me",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const responseText = await response.text();

  let seller = null;

  try {
    seller = JSON.parse(responseText);
  } catch {
    seller = null;
  }

  if (!response.ok) {
    console.error(
      "Erro ao consultar vendedor:",
      response.status,
      responseText,
    );

    throw new ApiError(
      seller?.message ||
        seller?.error ||
        "Não foi possível consultar a conta do Mercado Livre",
      502,
    );
  }

  if (!seller?.id) {
    throw new ApiError(
      "O Mercado Livre não retornou o ID do vendedor",
      502,
    );
  }

  return seller;
}

function createStoreName(seller) {
  const nickname =
    seller.nickname ||
    seller.first_name ||
    String(seller.id);

  return `[Mercado Livre - ${nickname}]`;
}

async function validateStateOwner(
  supabase,
  statePayload,
) {
  const {
    data: profile,
    error,
  } = await supabase
    .from("users_app")
    .select(
      "id, auth_id, company_id, status",
    )
    .eq("id", statePayload.profile_id)
    .eq("auth_id", statePayload.auth_id)
    .eq(
      "company_id",
      statePayload.company_id,
    )
    .maybeSingle();

  if (error) {
    console.error(
      "Erro ao validar responsável pelo OAuth:",
      error,
    );

    throw new ApiError(
      "Erro ao validar o usuário que iniciou a integração",
      500,
    );
  }

  if (!profile) {
    throw new ApiError(
      "O usuário que iniciou a integração não foi encontrado",
      403,
    );
  }

  if (
    profile.status &&
    profile.status !== "active"
  ) {
    throw new ApiError(
      "O usuário que iniciou a integração está inativo",
      403,
    );
  }

  return profile;
}

async function saveStore({
  supabase,
  companyId,
  seller,
  tokens,
}) {
  const sellerId = String(seller.id);

  const storeData = {
    name: createStoreName(seller),
    platform: "mercadolivre",
    seller_id: sellerId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    company_id: companyId,
  };

  const {
    data: existingStore,
    error: searchError,
  } = await supabase
    .from("stores")
    .select("id")
    .eq("company_id", companyId)
    .eq("platform", "mercadolivre")
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (searchError) {
    console.error(
      "Erro ao procurar loja existente:",
      searchError,
    );

    throw new ApiError(
      "Erro ao verificar se a conta já está conectada",
      500,
    );
  }

  if (existingStore) {
    const {
      data: updatedStore,
      error: updateError,
    } = await supabase
      .from("stores")
      .update(storeData)
      .eq("id", existingStore.id)
      .select(
        "id, name, platform, seller_id, company_id",
      )
      .single();

    if (updateError) {
      console.error(
        "Erro ao atualizar loja:",
        updateError,
      );

      throw new ApiError(
        "Erro ao atualizar a conta do Mercado Livre",
        500,
      );
    }

    return {
      store: updatedStore,
      operation: "updated",
    };
  }

  const {
    data: insertedStore,
    error: insertError,
  } = await supabase
    .from("stores")
    .insert(storeData)
    .select(
      "id, name, platform, seller_id, company_id",
    )
    .single();

  if (insertError) {
    console.error(
      "Erro ao cadastrar loja:",
      insertError,
    );

    throw new ApiError(
      "Erro ao cadastrar a conta do Mercado Livre",
      500,
    );
  }

  return {
    store: insertedStore,
    operation: "created",
  };
}

export default async function handler(req, res) {
  let redirectPath = "/";

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");

      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const oauthError =
      typeof req.query.error === "string"
        ? req.query.error
        : null;

    const oauthErrorDescription =
      typeof req.query.error_description ===
      "string"
        ? req.query.error_description
        : null;

    if (oauthError) {
      throw new ApiError(
        oauthErrorDescription ||
          `Autorização recusada: ${oauthError}`,
        400,
      );
    }

    const code =
      typeof req.query.code === "string"
        ? req.query.code
        : null;

    const state =
      typeof req.query.state === "string"
        ? req.query.state
        : null;

    if (!code) {
      throw new ApiError(
        "Código de autorização não informado",
        400,
      );
    }

    const statePayload =
      verifyOAuthState(state);

    redirectPath = getSafeRedirectPath(
      statePayload.redirect_path,
    );

    const supabaseUrl =
      getRequiredEnvironment("SUPABASE_URL");

    const serviceRoleKey =
      getRequiredEnvironment(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

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

    await validateStateOwner(
      supabase,
      statePayload,
    );

    const tokens =
      await exchangeCodeForTokens(code);

    const seller =
      await getMercadoLivreSeller(
        tokens.access_token,
      );

    const result = await saveStore({
      supabase,
      companyId: statePayload.company_id,
      seller,
      tokens,
    });

    const returnUrl = buildReturnUrl(
      req,
      redirectPath,
      {
        integration: "mercadolivre",
        integration_status: "success",
        store_id: result.store.id,
        seller_id: result.store.seller_id,
        operation: result.operation,
      },
    );

    return res.redirect(302, returnUrl);
  } catch (error) {
    console.error(
      "Erro em /api/meli-callback:",
      error,
    );

    const message =
      error?.message ||
      "Erro ao concluir a integração com o Mercado Livre";

    try {
      const returnUrl = buildReturnUrl(
        req,
        redirectPath,
        {
          integration: "mercadolivre",
          integration_status: "error",
          integration_message: message,
        },
      );

      return res.redirect(302, returnUrl);
    } catch (redirectError) {
      console.error(
        "Erro ao montar URL de retorno:",
        redirectError,
      );

      const statusCode =
        error instanceof ApiError
          ? error.statusCode
          : 500;

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }
}