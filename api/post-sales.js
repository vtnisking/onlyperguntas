import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const { action, company_id: companyId } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: "action obrigatório",
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id obrigatório",
      });
    }

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
        message: "Supabase conectado com sucesso",
        total: stores?.length || 0,
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

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro interno na API de pós-vendas",
    });
  }
}