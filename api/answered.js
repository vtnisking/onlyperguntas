import axios from "axios";
import { createClient } from "@supabase/supabase-js";

async function refreshStoreToken(store, supabase) {
  const response = await axios.post(
    "https://api.mercadolibre.com/oauth/token",
    {
      grant_type: "refresh_token",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token: store.refresh_token,
    },
  );

  const newData = response.data;

  await supabase
    .from("stores")
    .update({
      access_token: newData.access_token,
      refresh_token: newData.refresh_token,
    })
    .eq("id", store.id);

  return {
    ...store,
    access_token: newData.access_token,
    refresh_token: newData.refresh_token,
  };
}

async function getProductData(itemId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const item = response.data;

    const sku =
      item.seller_custom_field ||
      item.attributes?.find((attr) => attr.id === "SELLER_SKU")?.value_name ||
      item.attributes?.find((attr) => attr.id === "SKU")?.value_name ||
      item.variations?.[0]?.seller_custom_field ||
      item.variations?.[0]?.attributes?.find((attr) => attr.id === "SELLER_SKU")
        ?.value_name ||
      null;

    return {
      title: item.title || itemId,
      sku,
      thumbnail: item.thumbnail || null,
      permalink: item.permalink || null,
      available_quantity: item.available_quantity || 0,
      price: item.price || null,
    };
  } catch (error) {
    return {
      title: itemId,
      sku: null,
      thumbnail: null,
    };
  }
}


async function getCustomerData(userId, accessToken) {
  try {
    if (!userId) {
      return {
        name: "Cliente",
        nickname: null,
      };
    }
    
    const response = await axios.get(
      `https://api.mercadolibre.com/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const user = response.data;

    return {
      name: user.first_name || "Cliente",
      nickname: user.nickname || null,
    };
  } catch (error) {
    return {
      name: "Cliente",
      nickname: null,
    };
  }
}

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
    const { data: stores, error } = await supabase
      .from("stores")
      .select("*")
      .eq("platform", "mercadolivre");

    if (error || !stores || stores.length === 0) {
      return res.status(400).json({
        error: "Nenhuma loja encontrada.",
      });
    }

    let allAnswered = [];

    for (let store of stores) {
      try {
        let response;

        try {
          response = await axios.get(
            `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=ANSWERED&limit=10&sort_fields=date_created&sort_types=DESC`,
            {
              headers: {
                Authorization: `Bearer ${store.access_token}`,
              },
            },
          );
        } catch (tokenError) {
          const errorData = tokenError.response?.data;

          if (
            errorData?.message === "invalid_token" ||
            errorData?.error === "bad_request" ||
            tokenError.response?.status === 401
          ) {
            store = await refreshStoreToken(store, supabase);

            response = await axios.get(
              `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=ANSWERED&limit=10`,
              {
                headers: {
                  Authorization: `Bearer ${store.access_token}`,
                },
              },
            );
          } else {
            throw tokenError;
          }
        }

        const questions = response.data.questions || [];

        const questionIds = questions.map((q) => String(q.id));

const { data: logs, error: logsError } = await supabase
  .from("answer_logs")
  .select(
    "question_id, store_id, user_id, user_name, user_email, created_at",
  )
  .eq("store_id", store.id)
  .in("question_id", questionIds)
  .order("created_at", { ascending: false });

if (logsError) {
  console.error(
    `Erro ao buscar answer_logs da loja ${store.name}:`,
    logsError,
  );
}

const logsMap = {};

(logs || []).forEach((log) => {
  const questionId = String(log.question_id);

  if (!logsMap[questionId]) {
    logsMap[questionId] = log;
  }
});

const enrichedQuestions = await Promise.all(
  questions.map(async (question) => {
    const customerData = await getCustomerData(
      question.from?.id,
      store.access_token,
    );

const productData = await getProductData(question.item_id, store.access_token);
    
    const log = logsMap[String(question.id)];

    return {
      ...question,
      store_name: store.name,
      store_id: store.id,
      client_name: customerData.name,
      client_nickname: customerData.nickname,
      product_title: productData.title,
      product_sku: productData.sku,
      product_thumbnail: productData.thumbnail,
      product_link: productData.permalink,
      product_quantity: productData.available_quantity,
      product_price: productData.price,

      answer: {
        ...question.answer,
        user_name: log?.user_name || null,
        user_email: log?.user_email || null,
        date_created: log?.created_at || question.answer?.date_created,
      },
    };
  }),
);

allAnswered.push(...enrichedQuestions);

      } catch (storeError) {
        console.log(
          `Erro na loja ${store.name}`,
          storeError.response?.data || storeError.message,
        );
      }
    }

    allAnswered.sort((a, b) => {
      const dateA = new Date(a.answer?.date_created || a.date_created);
      const dateB = new Date(b.answer?.date_created || b.date_created);
      return dateB - dateA;
    });

    allAnswered = allAnswered.slice(0, 20);

    return res.status(200).json({
      total: allAnswered.length,
      questions: allAnswered,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.response?.data || error.message,
    });
  }
}
