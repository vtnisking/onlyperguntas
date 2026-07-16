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

async function getPreviousQuestions(store, question) {
  try {
    const fromId = question.from?.id;

    if (!question.item_id || !fromId) {
      return [];
    }

    const response = await axios.get(
      `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&item_id=${question.item_id}&limit=50`,
      {
        headers: {
          Authorization: `Bearer ${store.access_token}`
        }
      }
    );

    const all = response.data.questions || [];

    return all
      .filter(q => String(q.id) !== String(question.id))
      .filter(q => String(q.from?.id) === String(fromId))
      .sort((a, b) => new Date(b.date_created) - new Date(a.date_created))
      .map(q => ({
        id: q.id,
        text: q.text,
        status: q.status,
        date_created: q.date_created,
        answer: q.answer?.text || null
      }));

  } catch (error) {
    return [];
  }
}

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

const companyId = req.query.company_id;

const { data: stores, error } = await supabase
  .from("stores")
  .select("*")
  .eq("platform", "mercadolivre")
  .eq("company_id", companyId);

    if (error || !stores || stores.length === 0) {
      return res.status(400).json({
        error: "Nenhuma loja encontrada."
      });
    }

    let allQuestions = [];

    for (let store of stores) {
      try {
        let response;

        try {
          response = await axios.get(
            `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=UNANSWERED`,
            {
              headers: {
                Authorization: `Bearer ${store.access_token}`
              }
            }
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
              `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=UNANSWERED`,
              {
                headers: {
                  Authorization: `Bearer ${store.access_token}`
                }
              }
            );
          } else {
            throw tokenError;
          }
        }

        const questions = response.data.questions || [];

        for (const question of questions) {
          const productData = await getProductData(
            question.item_id,
            store.access_token
          );

          const customerData = await getCustomerData(
            question.from?.id,
            store.access_token
          );

          const previousQuestions = await getPreviousQuestions(
            store,
            question
          );

          allQuestions.push({
            ...question,
            store_name: store.name,
            store_id: store.id,
            product_title: productData.title,
            product_sku: productData.sku,
            product_thumbnail: productData.thumbnail,
            product_link: productData.permalink,
            product_quantity: productData.available_quantity,
            product_price: productData.price,
            client_name: customerData.name,
            client_nickname: customerData.nickname,
            previous_questions: previousQuestions
          });
        }

      } catch (storeError) {
        console.log(
          `Erro na loja ${store.name}`,
          storeError.response?.data || storeError.message
        );
      }
    }

    return res.status(200).json({
      total: allQuestions.length,
      questions: allQuestions
    });

  } catch (error) {
    return res.status(500).json({
      error: error.response?.data || error.message
    });
  }
}
