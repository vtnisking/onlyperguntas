import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey =
      process.env.CHATI_SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        success: false,
        error:
          "Variáveis do Supabase não configuradas.",
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const refreshToken = String(
      body.refresh_token || "",
    ).trim();

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: "refresh_token obrigatório.",
      });
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    const { data, error } =
      await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

    if (error || !data?.session) {
      return res.status(401).json({
        success: false,
        error:
          error?.message ||
          "Refresh token inválido ou expirado.",
      });
    }

    return res.status(200).json({
      success: true,
      session: {
        access_token:
          data.session.access_token,
        refresh_token:
          data.session.refresh_token,
        token_type:
          data.session.token_type,
        expires_in:
          data.session.expires_in,
        expires_at:
          data.session.expires_at,
      },
    });
  } catch (error) {
    console.error(
      "Erro ao renovar sessão:",
      error,
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Erro interno ao renovar sessão.",
    });
  }
}