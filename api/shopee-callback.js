import { createClient } from "@supabase/supabase-js";
import { shopeeConfig, getTokens, getShopInfo } from "../lib/shopee.js";
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

async function exchangeCodeForTokens({ code, shopId }) {
  const cfg = shopeeConfig();
  const tokens = await getTokens(cfg, code, shopId);
  const info = await getShopInfo(cfg, tokens.access_token, shopId);
  return { ...tokens, shop_name: info?.shop_name || null };
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
    name: tokens.shop_name || `Shopee ${sellerId}`,
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
        typeof req.query.main_account_id === "string"
          ? "Você autorizou uma conta principal. Autorize uma loja (shop) específica para conectar ao Chati."
          : "shop_id não informado pela Shopee",
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
