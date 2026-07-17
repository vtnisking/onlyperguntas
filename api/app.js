import { createClient } from "@supabase/supabase-js";

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

    const { action, company_id } = req.query;

    if (!action) {
      return res.status(400).json({
        error: "action obrigatório",
      });
    }

    if (!company_id) {
      return res.status(400).json({
        error: "company_id obrigatório",
      });
    }

    // ==========================================
    // USUÁRIOS
    // ==========================================

    if (action === "users") {
      const { data, error } = await supabase
        .from("users_app")
        .select("id, name, email, role, status, created_at")
        .eq("company_id", company_id)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          error,
        });
      }

      return res.status(200).json({
        success: true,
        users: data || [],
      });
    }

    // ==========================================
    // ESTATÍSTICAS
    // ==========================================

    if (action === "stats") {
      const period = req.query.period || "day";
      const start = req.query.start;
      const end = req.query.end;
      const now = new Date();

      function brazilDateParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(date);

        return {
          year: Number(
            parts.find((part) => part.type === "year")?.value,
          ),
          month: Number(
            parts.find((part) => part.type === "month")?.value,
          ),
          day: Number(
            parts.find((part) => part.type === "day")?.value,
          ),
        };
      }

      function startOfBrazilDay(year, month, day) {
        return new Date(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
            2,
            "0",
          )}T00:00:00-03:00`,
        );
      }

      function endOfBrazilDay(year, month, day) {
        return new Date(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
            2,
            "0",
          )}T23:59:59.999-03:00`,
        );
      }

      const brazilToday = brazilDateParts(now);

      const todayStart = startOfBrazilDay(
        brazilToday.year,
        brazilToday.month,
        brazilToday.day,
      );

      let startDate;
      let endDate = endOfBrazilDay(
        brazilToday.year,
        brazilToday.month,
        brazilToday.day,
      );

      if (period === "day") {
        startDate = todayStart;
      } else if (period === "7days") {
        startDate = new Date(
          todayStart.getTime() - 6 * 24 * 60 * 60 * 1000,
        );
      } else if (period === "30days") {
        startDate = new Date(
          todayStart.getTime() - 29 * 24 * 60 * 60 * 1000,
        );
      } else if (period === "month") {
        startDate = startOfBrazilDay(
          brazilToday.year,
          brazilToday.month,
          1,
        );
      } else if (period === "year") {
        startDate = startOfBrazilDay(
          brazilToday.year,
          1,
          1,
        );
      } else if (period === "custom" && start && end) {
        startDate = new Date(`${start}T00:00:00-03:00`);
        endDate = new Date(`${end}T23:59:59.999-03:00`);
      } else {
        startDate = todayStart;
      }

      const {
        count: companyTotal,
        error: countError,
      } = await supabase
        .from("answer_logs")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("company_id", company_id);

      if (countError) {
        return res.status(500).json({
          success: false,
          etapa: "contagem_sem_data",
          error: countError,
        });
      }

      const { data: logs, error: logsError } = await supabase
        .from("answer_logs")
        .select("*")
        .eq("company_id", company_id)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString())
        .order("created_at", { ascending: false });

      if (logsError) {
        return res.status(500).json({
          success: false,
          etapa: "consulta_com_data",
          error: logsError,
        });
      }

      const byUser = {};

      (logs || []).forEach((log) => {
        const user =
          log.user_name ||
          log.user_email ||
          "Sem usuário";

        byUser[user] = (byUser[user] || 0) + 1;
      });

      const {
        data: allUsers,
        error: usersError,
      } = await supabase
        .from("users_app")
        .select("name, email")
        .eq("company_id", company_id);

      if (usersError) {
        return res.status(500).json({
          success: false,
          etapa: "usuarios",
          error: usersError,
        });
      }

      const rankingUsers = Object.fromEntries(
        (allUsers || []).map((user) => {
          const displayName = user.name || user.email;

          return [
            displayName,
            byUser[user.name] ||
              byUser[user.email] ||
              0,
          ];
        }),
      );

      return res.status(200).json({
        success: true,
        period,
        server_now: now.toISOString(),
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        company_total_without_date_filter: companyTotal || 0,
        total: (logs || []).length,
        by_user: rankingUsers,
        logs: logs || [],
      });
    }


// ==========================================
// RESPOSTAS RÁPIDAS
// ==========================================

if (action === "quick-replies") {

  if (req.method === "GET") {

    const { data, error } = await supabase
      .from("quick_replies")
      .select("*")
      .eq("company_id", company_id)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.status(200).json({
      success: true,
      replies: data || [],
    });
  }

  if (req.method === "POST") {

    const { reply_text } = req.body;

    if (!reply_text?.trim()) {
      return res.status(400).json({
        success: false,
        error: "reply_text obrigatório",
      });
    }

    const { data, error } = await supabase
      .from("quick_replies")
      .insert({
        company_id,
        reply_text: reply_text.trim(),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.status(200).json({
      success: true,
      reply: data,
    });
  }

  if (req.method === "PUT") {

    const { id, reply_text } = req.body;

    const { error } = await supabase
      .from("quick_replies")
      .update({
        reply_text,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", company_id);

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.json({
      success: true,
    });
  }

  if (req.method === "DELETE") {

    const { id } = req.body;

    const { error } = await supabase
      .from("quick_replies")
      .delete()
      .eq("id", id)
      .eq("company_id", company_id);

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.json({
      success: true,
    });
  }

  return res.status(405).json({
    success: false,
    error: "Método não permitido",
  });
}


    // ==========================================
    // CRIAR USUÁRIO
    // ==========================================

    if (action === "create-user") {
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          error: "Método não permitido",
        });
      }

      const { name, email, password, role } = req.body || {};

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          error: "Nome, e-mail e senha são obrigatórios",
        });
      }

      const { data, error } = await supabase
        .from("users_app")
        .insert({
          company_id,
          name,
          email,
          role: role || "employee",
          status: "active",
        })
        .select("id, name, email, role, status")
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error,
        });
      }

      return res.status(200).json({
        success: true,
        user: data,
      });
    }

    // ==========================================
    // DELETAR USUÁRIO
    // ==========================================

    if (action === "delete-user") {
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          error: "Método não permitido",
        });
      }

      const { user_id } = req.body || {};

      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: "user_id obrigatório",
        });
      }

      const { error } = await supabase
        .from("users_app")
        .delete()
        .eq("id", user_id)
        .eq("company_id", company_id);

      if (error) {
        return res.status(500).json({
          success: false,
          error,
        });
      }

      return res.status(200).json({
        success: true,
      });
    }

    // ==========================================
    // AÇÃO NÃO ENCONTRADA
    // ==========================================

    return res.status(404).json({
      success: false,
      error: "Ação não encontrada",
    });
  } catch (error) {
    console.error("Erro em /api/app:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno",
    });
  }
}