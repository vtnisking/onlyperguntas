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
        return res.status(500).json({ error });
      }

      return res.status(200).json({
        success: true,
        users: data,
      });
    }

    // ==========================================
    // ESTATÍSTICAS
    // ==========================================

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
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
    day: Number(parts.find((part) => part.type === "day").value),
  };
}

function startOfBrazilDay(year, month, day) {
  return new Date(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-03:00`,
  );
}

function endOfBrazilDay(year, month, day) {
  return new Date(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59.999-03:00`,
  );
}

const brazilToday = brazilDateParts(now);

let startDate;
let endDate = endOfBrazilDay(
  brazilToday.year,
  brazilToday.month,
  brazilToday.day,
);

if (period === "day") {
  startDate = startOfBrazilDay(
    brazilToday.year,
    brazilToday.month,
    brazilToday.day,
  );
} else if (period === "7days") {
  startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  startDate.setHours(3, 0, 0, 0);
} else if (period === "30days") {
  startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 29);
  startDate.setHours(3, 0, 0, 0);
} else if (period === "month") {
  startDate = startOfBrazilDay(
    brazilToday.year,
    brazilToday.month,
    1,
  );
} else if (period === "year") {
  startDate = startOfBrazilDay(brazilToday.year, 1, 1);
} else if (period === "custom" && start && end) {
  startDate = new Date(`${start}T00:00:00-03:00`);
  endDate = new Date(`${end}T23:59:59.999-03:00`);
} else {
  startDate = startOfBrazilDay(
    brazilToday.year,
    brazilToday.month,
    brazilToday.day,
  );


      // Conta todos os registros da empresa sem filtro de data

      const { count: companyTotal, error: countError } = await supabase
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

      // Busca as respostas dentro do período

      const { data, error } = await supabase
        .from("answer_logs")
        .select("*")
        .eq("company_id", company_id)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          etapa: "consulta_com_data",
          error,
        });
      }

      const byUser = {};

      data.forEach((log) => {
        const user = log.user_name || log.user_email || "Sem usuário";

        byUser[user] = (byUser[user] || 0) + 1;
      });

      const { data: allUsers, error: usersError } = await supabase
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

      return res.status(200).json({
        success: true,

        period,

        server_now: now.toISOString(),

        start_date: startDate.toISOString(),

        end_date: endDate.toISOString(),

        company_total_without_date_filter: companyTotal,

        total: data.length,

        by_user: Object.fromEntries(
          (allUsers || []).map((user) => [
            user.name || user.email,
            byUser[user.name] || byUser[user.email] || 0,
          ]),
        ),

        logs: data,
      });
    }

    // ==========================================
    // CRIAR USUÁRIO
    // ==========================================

    if (action === "create-user") {
      if (req.method !== "POST") {
        return res.status(405).json({
          error: "Método não permitido",
        });
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

    // ==========================================
    // DELETAR USUÁRIO
    // ==========================================

    if (action === "delete-user") {
      if (req.method !== "POST") {
        return res.status(405).json({
          error: "Método não permitido",
        });
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

    // ==========================================
    // AÇÃO NÃO ENCONTRADA
    // ==========================================

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
