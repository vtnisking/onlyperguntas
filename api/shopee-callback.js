import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  OAuthStateError,
  verifyOAuthState,
} from "../lib/oauth.js";

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

function createShopeeSignature({
  partnerId,
  partnerKey,
  apiPath,
  timestamp,
}) {
  const baseString =
    `${partnerId}${apiPath}${timestamp}`;

  return crypto
    .createHmac("sha256", partnerKey)
    .update(baseString)
    .digest("hex");
}

async function exchangeCodeForTokens({
  code,
  shopId,
}) {
  const partnerId =
    getRequiredEnvironment(
      "SHOPEE_TEST_PARTNER_ID",
    );

  const partnerKey =
    getRequiredEnvironment(
      "SHOPEE_TEST_PARTNER_KEY",
    );

  const apiPath =
    "/api/v2/auth/token/get";

  const timestamp =
    Math.floor(Date.now() / 1000);

  const sign = createShopeeSignature({
    partnerId,
    partnerKey,
    apiPath,
    timestamp,
  });

  const url = new URL(
    `https://openplatform.sandbox.test-stable.shopee.sg${apiPath}`,
  );

  url.searchParams.set(
    "partner_id",
    partnerId,
  );

  url.searchParams.set(
    "timestamp",
    String(timestamp),
  );

  url.searchParams.set(
    "sign",
    sign,
  );

  const response = await fetch(
    url.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code,
        partner_id: Number(partnerId),
        shop_id: parseInt(shopId, 10),
      }),
    },
  );

  const responseText =
    await response.text();

  let data = null;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error(
      "Erro ao trocar code Shopee:",
      response.status,
      responseText,
    );

    throw new ApiError(
      data?.message ||
        data?.error ||
        "A Shopee recusou a autorização",
      400,
    );
  }

  if (
    !data?.access_token ||
    !data?.refresh_token
  ) {
    console.error(
      "Resposta inesperada da Shopee:",
      responseText,
    );

    throw new ApiError(
      "A Shopee não retornou os tokens esperados",
      502,
    );
  }

  return data;
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
      "Erro ao validar responsável pelo OAuth Shopee:",
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

async function saveShopeeStore({
  supabase,
  companyId,
  shopId,
  tokens,
}) {
  const sellerId = String(shopId);

  const storeData = {
    name: `[Shopee - ${sellerId}]`,
    platform: "shopee",
    seller_id: sellerId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    company_id: companyId,
    connected_at: new Date().toISOString(),
  };

  const {
    data: existingStore,
    error: searchError,
  } = await supabase
    .from("stores")
    .select("id")
    .eq("company_id", companyId)
    .eq("platform", "shopee")
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (searchError) {
    console.error(
      "Erro ao procurar loja Shopee existente:",
      searchError,
    );

    throw new ApiError(
      "Erro ao verificar se a conta Shopee já está conectada",
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
        "id, name, platform, seller_id, company_id, connected_at",
      )
      .single();

    if (updateError) {
      console.error(
        "Erro ao atualizar loja Shopee:",
        updateError,
      );

      throw new ApiError(
        "Erro ao atualizar a conta da Shopee",
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
      "id, name, platform, seller_id, company_id, connected_at",
    )
    .single();

  if (insertError) {
    console.error(
      "Erro ao cadastrar loja Shopee:",
      insertError,
    );

    throw new ApiError(
      "Erro ao cadastrar a conta da Shopee",
      500,
    );
  }

  return {
    store: insertedStore,
    operation: "created",
  };
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

  const destination = new URL(
    getSafeRedirectPath(redirectPath),
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

export default async function handler(req, res) {
  let redirectPath = "/app";

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");

      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const code =
      typeof req.query.code === "string"
        ? req.query.code
        : null;

    const shopId =
      typeof req.query.shop_id === "string"
        ? req.query.shop_id
        : null;

    const state =
      typeof req.query.state === "string"
        ? req.query.state
        : null;

    if (!code) {
      throw new ApiError(
        "Código de autorização da Shopee não informado",
        400,
      );
    }

    if (!shopId) {
      throw new ApiError(
        "shop_id não informado pela Shopee",
        400,
      );
    }

    const statePayload =
      verifyOAuthState(
        state,
        "shopee",
      );

    redirectPath = getSafeRedirectPath(
      statePayload.redirect_path,
    );

    const supabaseUrl =
      getRequiredEnvironment("SUPABASE_URL");

    const serviceRoleKey =
      getRequiredEnvironment(
        "CHATI_SUPABASE_SECRET_KEY",
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
      await exchangeCodeForTokens({
        code,
        shopId,
      });

    const result =
      await saveShopeeStore({
        supabase,
        companyId:
          statePayload.company_id,
        shopId,
        tokens,
      });

    const returnUrl = buildReturnUrl(
      req,
      redirectPath,
      {
        integration: "shopee",
        integration_status: "success",
        store_id: result.store.id,
        shop_id: result.store.seller_id,
        operation: result.operation,
      },
    );

    return res.redirect(302, returnUrl);
  } catch (error) {
    console.error(
      "Erro em /api/shopee-callback:",
      error,
    );

    const message =
      error?.message ||
      "Erro ao concluir a integração com a Shopee";

    try {
      const returnUrl = buildReturnUrl(
        req,
        redirectPath,
        {
          integration: "shopee",
          integration_status: "error",
          integration_message: message,
        },
      );

      return res.redirect(302, returnUrl);
    } catch {
      const statusCode =
        error instanceof ApiError ||
        error instanceof OAuthStateError
          ? error.statusCode
          : 500;

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }
}