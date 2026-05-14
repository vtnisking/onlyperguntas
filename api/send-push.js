import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  "mailto:admin@centralizachat.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("*");

    if (error) {
      return res.status(500).json({
        error,
      });
    }

    const payload = JSON.stringify({
      title: "Nova pergunta recebida",
      body: "Você recebeu uma nova pergunta no CentralizaChat.",
      url: "/",
    });

    const results = await Promise.allSettled(
      subscriptions.map((item) =>
        webpush.sendNotification(item.subscription, payload),
      ),
    );

    return res.status(200).json({
      success: true,
      total: subscriptions.length,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
