import { createClient } from "@supabase/supabase-js";
import {
  AuthError,
  getAuthenticatedContext,
} from "../lib/auth.js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { action } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: "action obrigatório",
      });
    }

    const {
      companyId,
      profile,
      authUser,
    } = await getAuthenticatedContext(req, supabase);

    if (action === "test") {
      const { data: stores, error: storesError } =
        await supabase
          .from("stores")
          .select("id, name, seller_id, platform")
          .eq("platform", "mercadolivre")
          .eq("company_id", companyId);

      if (storesError) {
        console.error(
          "Erro ao buscar lojas:",
          storesError,
        );

        return res.status(500).json({
          success: false,
          error: storesError.message,
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Autenticação segura funcionando",
        user: {
          auth_id: authUser.id,
          profile_id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role,
        },
        company_id: companyId,
        total_stores: stores?.length || 0,
        stores: stores || [],
      });
    }

    return res.status(404).json({
      success: false,
      error: "Ação não encontrada",
    });
  } catch (error) {
    console.error(
      "Erro em /api/post-sales:",
      error,
    );

    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro interno na API de pós-vendas",
    });
  }
}