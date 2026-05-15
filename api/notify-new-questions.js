import axios from "axios";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

webpush.setVapidDetails(
  "mailto:admin@centralizachat.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

async function getProductTitle(itemId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.data.title || "Nova pergunta recebida";
  } catch (error) {
    return "Nova pergunta recebida";
  }
}

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    const { data: stores } = await supabase
      .from("stores")
      .select("*")
      .eq("platform", "mercadolivre");

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("*");

    let sent = 0;

    for (const store of stores || []) {
      try {
        const response = await axios.get(
          `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=UNANSWERED`,
          {
            headers: {
              Authorization: `Bearer ${store.access_token}`,
            },
          },
        );

        const questions = response.data.questions || [];

        for (const question of questions) {
          const { data: alreadyNotified } = await supabase
            .from("notified_questions")
            .select("question_id")
            .eq("question_id", String(question.id))
            .maybeSingle();

          if (alreadyNotified) {
            continue;
          }

          const productTitle = await getProductTitle(
            question.item_id,
            store.access_token,
          );

const payload = JSON.stringify({
  title: productTitle,
  body: question.text || "Você recebeu uma nova pergunta.",
  url: "/",
});

          await Promise.allSettled(
            (subscriptions || []).map((item) =>
              webpush.sendNotification(item.subscription, payload),
            ),
          );

          await supabase.from("notified_questions").insert({
            question_id: String(question.id),
          });

          sent++;
        }
      } catch (storeError) {
        console.log(
          "Erro na loja:",
          store.name,
          storeError.response?.data || storeError.message,
        );
      }
    }

    return res.status(200).json({
      success: true,
      sent,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
}
