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

async function saveAnswerLog(supabase, store, body, text) {
  const { error } = await supabase.from("answer_logs").insert({
    question_id: body.question_id,
    store_id: body.store_id,
    store_name: store.name,
    company_id: store.company_id,
    user_id: body.user_id || null,
    user_name: body.user_name || null,
    user_email: body.user_email || null,
    answer_text: text,
  });

  if (error) {
    console.error("Erro ao registrar resposta em answer_logs:", error);
    throw new Error(`Resposta enviada, mas o histórico não foi salvo: ${error.message}`);
  }
}

async function saveAnswerLog(supabase, store, body, text) {
  const { error: logError } = await supabase
    .from("answer_logs")
    .insert({
      question_id: String(body.question_id),
      store_id: body.store_id,
      store_name: store.name,
      company_id: store.company_id,
      user_id: body.user_id || null,
      user_name: body.user_name || null,
      user_email: body.user_email || null,
      answer_text: text,
    });

  if (logError) {
    console.error("Erro ao salvar answer_log:", logError);
    throw new Error(
      `A resposta foi enviada, mas o histórico não foi salvo: ${logError.message}`,
    );
  }
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
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
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
await saveAnswerLog(supabase, store, req.body, text);
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
  company_id: store.company_id,
  user_id: req.body.user_id,
  user_name: req.body.user_name,
  user_email: req.body.user_email,
  answer_text: text,
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
