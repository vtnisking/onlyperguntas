import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const {
      question_id,
      company_id,
    } = req.body || {};

    if (!question_id || !company_id) {
      return res.status(400).json({
        success: false,
        error:
          "question_id e company_id são obrigatórios",
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

    const { error } = await supabase
      .from("hidden_questions")
      .upsert(
        {
          question_id: String(question_id),
          company_id: String(company_id),
        },
        {
          onConflict: "company_id,question_id",
        },
      );

    if (error) {
      console.error(
        "Erro ao remover pergunta:",
        error,
      );

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Pergunta removida das pendentes.",
    });

  } catch (error) {
    console.error(
      "Erro em /api/remove:",
      error,
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Erro interno",
    });
  }
}