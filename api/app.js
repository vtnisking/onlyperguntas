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

    if (action === "stats") {
      const period = req.query.period || "day";

      const now = new Date();
      let startDate = new Date();

      if (period === "day") {
        startDate.setHours(0, 0, 0, 0);
      }

      if (period === "month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      if (period === "year") {
        startDate = new Date(now.getFullYear(), 0, 1);
      }

      const { data, error } = await supabase
        .from("answer_logs")
        .select("*")
        .eq("company_id", company_id)
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({ error });
      }

      const byUser = {};

      data.forEach((log) => {
        const user = log.user_name || log.user_email || "Sem usuário";
        byUser[user] = (byUser[user] || 0) + 1;
      });

      return res.status(200).json({
        success: true,
        period,
        total: data.length,
        by_user: byUser,
        logs: data,
      });
    }

    if (action === "create-user") {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
      }

      const { name, email, password, role } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          error: "Nome, e-mail e senha são obrigatórios",
        });
      }

      const { data, error } = await supabase
        .from("users_app")
        .insert({
          company_id,
          name,
          email,
          password,
          role: role || "employee",
          status: "active",
        })
        .select("id, name, email, role, status")
        .single();

      if (error) {
        return res.status(500).json({ error });
      }

      return res.status(200).json({
        success: true,
        user: data,
      });
    }

    if (action === "delete-user") {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
      }

      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({
          error: "user_id obrigatório",
        });
      }

      const { error } = await supabase
        .from("users_app")
        .delete()
        .eq("id", user_id)
        .eq("company_id", company_id);

      if (error) {
        return res.status(500).json({ error });
      }

      return res.status(200).json({
        success: true,
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
