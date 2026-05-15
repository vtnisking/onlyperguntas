import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    const { action, company_id } = req.query;

    if (!action) {
      return res.status(400).json({ error: "action obrigatório" });
    }

    if (!company_id) {
      return res.status(400).json({ error: "company_id obrigatório" });
    }

    if (action === "users") {
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

    return res.status(404).json({
      error: "Ação não encontrada",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
