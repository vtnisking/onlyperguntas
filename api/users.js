import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        error: "company_id obrigatório",
      });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("users_app")
        .select("id, name, email, role, status, created_at")
        .eq("company_id", company_id)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({ error });
      }

      return res.status(200).json({
        success: true,
        users: data,
      });
    }

    return res.status(405).json({
      error: "Método não permitido",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
}
