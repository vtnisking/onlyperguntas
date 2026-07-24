import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function getBearerToken(req) {
  const authorization = req.headers?.authorization;

  if (!authorization) {
    throw new ApiError(
      "Token de autenticação não enviado",
      401,
    );
  }

  const [type, token] = authorization
    .trim()
    .split(/\s+/);

  if (
    type?.toLowerCase() !== "bearer" ||
    !token
  ) {
    throw new ApiError(
      "Formato de autenticação inválido",
      401,
    );
  }

  return token;
}

async function getAuthenticatedContext(
  req,
  supabase,
) {
  const accessToken = getBearerToken(req);

  const {
    data: authData,
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  const authUser = authData?.user;

  if (authError || !authUser) {
    console.error(
      "Erro ao validar sessão:",
      authError,
    );

    throw new ApiError(
      "Sessão inválida ou expirada",
      401,
    );
  }

  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("users_app")
    .select(
      "id, auth_id, company_id, name, email, role, status",
    )
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao buscar perfil:",
      profileError,
    );

    throw new ApiError(
      "Erro ao localizar o perfil do usuário",
      500,
    );
  }

  if (!profile) {
    throw new ApiError(
      "Perfil do usuário não encontrado",
      403,
    );
  }

  if (!profile.company_id) {
    throw new ApiError(
      "Usuário não vinculado a uma empresa",
      403,
    );
  }

  if (
    profile.status &&
    profile.status !== "active"
  ) {
    throw new ApiError(
      "Usuário inativo",
      403,
    );
  }

  return {
    authUser,
    profile,
    companyId: profile.company_id,
  };
}

function createOAuthState({
  companyId,
  profileId,
  authId,
  redirectPath,
}) {
  const secret =
    process.env.OAUTH_STATE_SECRET;

  if (!secret) {
    throw new ApiError(
      "OAUTH_STATE_SECRET não configurado",
      500,
    );
  }

  const now = Date.now();

  const payload = {
    provider: "mercadolivre",
    company_id: companyId,
    profile_id: profileId,
    auth_id: authId,
    redirect_path: redirectPath,
    nonce: crypto
      .randomBytes(32)
      .toString("hex"),
    created_at: now,
    expires_at: now + 10 * 60 * 1000,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function getSafeRedirect(value) {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }

  return "/";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");

      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const meliAppId =
      process.env.MELI_APP_ID;

    const redirectUri =
      process.env.MELI_REDIRECT_URI;

    if (!supabaseUrl) {
      throw new ApiError(
        "SUPABASE_URL não configurado",
        500,
      );
    }

    if (!serviceRoleKey) {
      throw new ApiError(
        "SUPABASE_SERVICE_ROLE_KEY não configurado",
        500,
      );
    }

    if (!meliAppId) {
      throw new ApiError(
        "MELI_APP_ID não configurado",
        500,
      );
    }

    if (!redirectUri) {
      throw new ApiError(
        "MELI_REDIRECT_URI não configurado",
        500,
      );
    }

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

    const {
      companyId,
      profile,
      authUser,
    } = await getAuthenticatedContext(
      req,
      supabase,
    );

    const redirectPath = getSafeRedirect(
      req.query.redirect,
    );

    const state = createOAuthState({
      companyId,
      profileId: profile.id,
      authId: authUser.id,
      redirectPath,
    });

    const authorizationUrl = new URL(
      "https://auth.mercadolivre.com.br/authorization",
    );

    authorizationUrl.searchParams.set(
      "response_type",
      "code",
    );

    authorizationUrl.searchParams.set(
      "client_id",
      meliAppId,
    );

    authorizationUrl.searchParams.set(
      "redirect_uri",
      redirectUri,
    );

    authorizationUrl.searchParams.set(
      "state",
      state,
    );

    return res.status(200).json({
      success: true,
      provider: "mercadolivre",
      authorization_url:
        authorizationUrl.toString(),
    });
  } catch (error) {
    console.error(
      "Erro em /api/meli-connect:",
      error,
    );

    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "Erro ao iniciar conexão com o Mercado Livre",
    });
  }
}