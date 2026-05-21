import axios from "axios";
import { createClient } from "@supabase/supabase-js";

async function refreshStoreToken(store, supabase) {
  const response = await axios.post("https://api.mercadolibre.com/oauth/token", {
    grant_type: "refresh_token",
    client_id: process.env.MELI_APP_ID,
    client_secret: process.env.MELI_CLIENT_SECRET,
    refresh_token: store.refresh_token
  });

  const newData = response.data;

  await supabase
    .from("stores")
    .update({
      access_token: newData.access_token,
      refresh_token: newData.refresh_token
    })
    .eq("id", store.id);

  return {
    ...store,
    access_token: newData.access_token,
    refresh_token: newData.refresh_token
  };
}

async function sendMercadoLivreAnswer(store, question_id, text) {
  return axios.post(
    "https://api.mercadolibre.com/answers",
    {
      question_id,
      text
    },
    {
      headers: {
        Authorization: `Bearer ${store.access_token}`,
        "Content-Type": "application/json"
      }
    }
  );
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Método não permitido"
      });
    }

    const { question_id, text, store_id } = req.body;

    if (!question_id || !text || !store_id) {
      return res.status(400).json({
        error: "question_id, text ou store_id ausentes"
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data: store, error } = await supabase
      .from("stores")
      .select("*")
      .eq("id", store_id)
      .single();

    if (error || !store) {
      return res.status(404).json({
        error: "Loja não encontrada"
      });
    }

    let response;

    try {
      response = await sendMercadoLivreAnswer(store, question_id, text);
      await supabase.from("answer_logs").insert({
        question_id,
        store_id,
        store_name: store.name,
        user_id: "admin",
        user_email: "admin@centralizachat.com",
        answer_text: text,
        user_name: req.body.user_name,
        company_id: store.company_id,
      });
    } catch (tokenError) {
      const errorData = tokenError.response?.data;

      if (
        errorData?.message === "invalid_token" ||
        errorData?.error === "bad_request" ||
        tokenError.response?.status === 401
      ) {
        const refreshedStore = await refreshStoreToken(store, supabase);
        response = await sendMercadoLivreAnswer(refreshedStore, question_id, text);
        await supabase.from("answer_logs").insert({
          question_id,
          store_id,
          store_name: store.name,
          user_id: "admin",
          user_email: "admin@centralizachat.com",
          answer_text: text,
          user_name: req.body.user_name,
          company_id: store.company_id,
        });
      } else {
        throw tokenError;
      }
    }

    return res.status(200).json({
      success: true,
      data: response.data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
}
