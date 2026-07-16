import axios from "axios";
import { createClient } from "@supabase/supabase-js";

async function refreshStoreToken(store, supabase) {
  const response = await axios.post(
    "https://api.mercadolibre.com/oauth/token",
    {
      grant_type: "refresh_token",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token: store.refresh_token
    }
  );

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

async function getProductData(itemId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const item = response.data;

    const sku =
      item.seller_custom_field ||
      item.attributes?.find(attr => attr.id === "SELLER_SKU")?.value_name ||
      item.attributes?.find(attr => attr.id === "SKU")?.value_name ||
      item.variations?.[0]?.seller_custom_field ||
      item.variations?.[0]?.attributes?.find(attr => attr.id === "SELLER_SKU")?.value_name ||
      null;

return {
  title: item.title || itemId,
  sku,
  thumbnail: item.thumbnail
  ? item.thumbnail.replace(/^http:\/\//i, "https://")
: null,
  permalink: item.permalink || null,
  available_quantity: item.available_quantity || 0,
  price: item.price || null
};

  } catch (error) {
    return {
      title: itemId,
      sku: null,
      thumbnail: null
    };
  }
}

async function getCustomerData(userId, accessToken) {
  try {
    if (!userId) {
      return {
        name: "Cliente",
        nickname: null
      };
    }

    const response = await axios.get(
      `https://api.mercadolibre.com/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const user = response.data;

    return {
      name: user.first_name || "Cliente",
      nickname: user.nickname || null
    };

  } catch (error) {
    return {
      name: "Cliente",
      nickname: null
    };
  }
}

async function getPreviousQuestions(
  store,
  question,
  supabase,
) {
  try {
    const fromId = question.from?.id;

    if (!question.item_id || !fromId) {
      return [];
    }

    const response = await axios.get(
      `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&item_id=${question.item_id}&limit=50`,
      {
        headers: {
          Authorization: `Bearer ${store.access_token}`,
        },
      },
    );

    const allQuestions = response.data.questions || [];

    const previousQuestions = allQuestions
      .filter(
        (previousQuestion) =>
          String(previousQuestion.id) !==
          String(question.id),
      )
      .filter(
        (previousQuestion) =>
          String(previousQuestion.from?.id) ===
          String(fromId),
      )
      .sort(
        (a, b) =>
          new Date(b.date_created) -
          new Date(a.date_created),
      );

    if (previousQuestions.length === 0) {
      return [];
    }

    const previousQuestionIds = previousQuestions.map(
      (previousQuestion) => String(previousQuestion.id),
    );

    const {
      data: previousLogs,
      error: previousLogsError,
    } = await supabase
      .from("answer_logs")
      .select(
        "question_id, user_name, user_email, created_at",
      )
      .eq("store_id", store.id)
      .in("question_id", previousQuestionIds)
      .order("created_at", { ascending: false });

    if (previousLogsError) {
      console.error(
        "Erro ao buscar responsáveis pelas perguntas anteriores:",
        previousLogsError,
      );
    }

    const previousLogsMap = {};

    (previousLogs || []).forEach((log) => {
      const questionId = String(log.question_id);

      if (!previousLogsMap[questionId]) {
        previousLogsMap[questionId] = log;
      }
    });

    return previousQuestions.map((previousQuestion) => {
      const previousLog =
        previousLogsMap[String(previousQuestion.id)];

      return {
        id: previousQuestion.id,
        text: previousQuestion.text,
        status: previousQuestion.status,
        date_created: previousQuestion.date_created,
        answer:
          previousQuestion.answer?.text || null,

        answer_date_created:
          previousLog?.created_at ||
          previousQuestion.answer?.date_created ||
          null,

        user_name:
          previousLog?.user_name || null,

        user_email:
          previousLog?.user_email || null,
      };
    });
  } catch (error) {
    console.error(
      "Erro ao carregar perguntas anteriores:",
      error.response?.data || error.message,
    );

    return [];
  }
}