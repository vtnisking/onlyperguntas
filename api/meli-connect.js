import { createClient } from "@supabase/supabase-js";
import {
  AuthError,
  getAuthenticatedContext,
} from "../lib/auth.js";
import {
  createOAuthState,
  OAuthStateError,
} from "../lib/oauth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
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

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        success: false,
        error:
          "Variáveis do Supabase não configuradas",
      });
    }

    if (!meliAppId) {
      return res.status(500).json({
        success: false,
        error: "MELI_APP_ID não configurado",
      });
    }

    if (!redirectUri) {
      return res.status(500).json({
        success: false,
        error:
          "MELI_REDIRECT_URI não configurado",
      });
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

    const requestedRedirect =
      typeof req.query.redirect === "string"
        ? req.query.redirect
        : "/";

    const safeRedirect =
      requestedRedirect.startsWith("/") &&
      !requestedRedirect.startsWith("//")
        ? requestedRedirect
        : "/";

    const state = createOAuthState({
      provider: "mercadolivre",
      companyId,
      profileId: profile.id,
      authId: authUser.id,
      redirectPath: safeRedirect,
      expiresInMinutes: 10,
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

    if (
      error instanceof AuthError ||
      error instanceof OAuthStateError
    ) {
      return res
        .status(error.statusCode)
        .json({
          success: false,
          error: error.message,
        });
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro ao iniciar conexão com o Mercado Livre",
    });
  }
}