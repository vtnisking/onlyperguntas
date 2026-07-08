import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { subscription, user_email } = req.body;

    if (!subscription?.endpoint) {
      return res.status(400).json({ error: "Subscription inválida" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        endpoint: subscription.endpoint,
        subscription,
        user_email: user_email || "admin@centralizachat.com",
      },
      {
        onConflict: "endpoint",
      },
    );

    if (error) {
      return res.status(500).json({ error });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
}
