import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

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
      .gte("created_at", startDate.toISOString());

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    const total = data.length;

    const byUser = {};

    data.forEach((item) => {
      const user = item.user_email || "Sem usuário";

      if (!byUser[user]) {
        byUser[user] = 0;
      }

      byUser[user]++;
    });

    return res.status(200).json({
      success: true,
      period,
      total,
      by_user: byUser,
      logs: data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
