import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { AuthError, getAuthenticatedContext } from "../lib/auth.js";
import {
  ReservationError,
  assertCanAct,
  clearReservation,
  getReservations,
  publicReservation,
  releaseQuestion,
  reserveQuestion,
} from "../lib/reservations.js";

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

  const { error: updateError } = await supabase
    .from("stores")
    .update({
      access_token: newData.access_token,
      refresh_token: newData.refresh_token,
    })
    .eq("id", store.id);

  if (updateError) {
    throw new Error(
      `Erro ao atualizar o token da loja: ${updateError.message}`,
    );
  }

  return {
    ...store,
    access_token: newData.access_token,
    refresh_token: newData.refresh_token,
  };
}

// Tempo médio de resposta (minutos) que o Mercado Livre calcula para
// cada conta: últimos 14 dias, atualizado 1x por dia.
async function fetchResponseTime(store, supabase) {
  const url = `https://api.mercadolibre.com/users/${store.seller_id}/questions/response_time`;
  const get = (token) =>
    axios.get(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 });

  let response;
  try {
    response = await get(store.access_token);
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status === 404) return { empty: true };
    const expired =
      status === 401 ||
      data?.message === "invalid_token" ||
      data?.error === "invalid_token";
    if (!expired) throw error;
    const fresh = await refreshStoreToken(store, supabase);
    try {
      response = await get(fresh.access_token);
    } catch (e) {
      if (e.response?.status === 404) return { empty: true };
      throw e;
    }
  }

  const d = response.data || {};
  const pick = (k) =>
    d[k]
      ? {
          minutes: d[k].response_time ?? null,
          sales_percent_increase: d[k].sales_percent_increase ?? null,
        }
      : null;

  return {
    total: d.total?.response_time ?? null,
    weekdays_working_hours: pick("weekdays_working_hours"),
    weekdays_extra_hours: pick("weekdays_extra_hours"),
    weekend: pick("weekend"),
  };
}

async function handleResponseTimes(res, supabase, companyId) {
  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, name, platform, seller_id, access_token, refresh_token")
    .eq("company_id", companyId)
    .eq("platform", "mercadolivre");

  if (error) {
    return res.status(500).json({ success: false, error: "Erro ao carregar as lojas" });
  }

  const mlStores = (stores || []).filter((s) => s.seller_id);

  const result = await Promise.all(
    mlStores.map(async (store) => {
      try {
        const times = await fetchResponseTime(store, supabase);
        return { store_id: store.id, store_name: store.name, ...times };
      } catch (e) {
        console.error(`Tempo de resposta (${store.name}):`, e.response?.data || e.message);
        return { store_id: store.id, store_name: store.name, error: true };
      }
    }),
  );

  res.setHeader("Cache-Control", "private, max-age=600");
  return res.status(200).json({ success: true, stores: result });
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
      item.variations?.[0]?.attributes?.find(
        (attr) => attr.id === "SELLER_SKU",
      )?.value_name ||
      null;

return {
  title: item.title || itemId,
  sku,
  thumbnail: item.thumbnail
    ? item.thumbnail.replace(/^http:\/\//i, "https://")
    : null,
  permalink: item.permalink || null,
  available_quantity: item.available_quantity || 0,
  price: item.price || null,
  status: item.status || null,
};

  } catch (error) {
    console.error(
      `Erro ao carregar produto ${itemId}:`,
      error.response?.data || error.message,
    );

        return {
        title: itemId,
        sku: null,
        thumbnail: null,
        permalink: null,
        available_quantity: 0,
        price: null,
        status: null,
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
    console.error(
      `Erro ao carregar cliente ${userId}:`,
      error.response?.data || error.message,
    );

    return {
      name: "Cliente",
      nickname: null,
    };
  }
}

async function getPreviousQuestions(store, question, supabase) {
  try {
    const buyerId = question.from?.id;

    if (!question.item_id || !buyerId) {
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
          String(previousQuestion.id) !== String(question.id),
      )
      .filter(
        (previousQuestion) =>
          String(previousQuestion.from?.id) === String(buyerId),
      )
      .sort(
        (a, b) =>
          new Date(b.date_created).getTime() -
          new Date(a.date_created).getTime(),
      );

    if (previousQuestions.length === 0) {
      return [];
    }

    const previousQuestionIds = previousQuestions.map((previousQuestion) =>
      String(previousQuestion.id),
    );

    const { data: previousLogs, error: previousLogsError } = await supabase
      .from("answer_logs")
      .select("question_id, user_name, user_email, created_at")
      .eq("store_id", store.id)
      .in("question_id", previousQuestionIds)
      .order("created_at", { ascending: false });

    if (previousLogsError) {
      console.error(
        `Erro ao buscar responsáveis das perguntas anteriores da loja ${store.name}:`,
        previousLogsError,
      );
    }

    const previousLogsMap = {};

    (previousLogs || []).forEach((log) => {
      const questionId = String(log.question_id);

      // A consulta já vem da resposta mais recente para a mais antiga.
      if (!previousLogsMap[questionId]) {
        previousLogsMap[questionId] = log;
      }
    });

    return previousQuestions.map((previousQuestion) => {
      const previousLog =
        previousLogsMap[String(previousQuestion.id)] || null;

      return {
        id: previousQuestion.id,
        text: previousQuestion.text,
        status: previousQuestion.status,
        date_created: previousQuestion.date_created,
        answer: previousQuestion.answer?.text || null,
        answer_date_created:
          previousLog?.created_at ||
          previousQuestion.answer?.date_created ||
          null,
        user_name: previousLog?.user_name || null,
        user_email: previousLog?.user_email || null,
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

async function getQuestionStatus(
  questionId,
  accessToken,
) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/questions/${questionId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error(
      `Erro ao validar pergunta ${questionId}:`,
      error.response?.data || error.message,
    );

    return null;
  }
}

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.CHATI_SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    // A empresa nunca é confiada a partir do navegador.
    // Ela é derivada exclusivamente do usuário autenticado.
    const { companyId, profile } = await getAuthenticatedContext(req, supabase);

    // ==========================================
    // TEMPO DE RESPOSTA DE CADA LOJA (Mercado Livre)
    // ==========================================
    if (req.method === "GET" && req.query.action === "response_times") {
      return await handleResponseTimes(res, supabase, companyId);
    }

 // ==========================================
// AÇÕES DE PERGUNTAS
// ==========================================
if (req.method === "POST") {
  const {
    action,
    question_id,
    buyer_id,
    store_id,
  } = req.body || {};

  // ========================================
  // RESERVAR / LIBERAR RESPOSTA
  // ========================================
  if (action === "reserve" || action === "unreserve") {
    if (!question_id) {
      return res.status(400).json({
        success: false,
        error: "question_id é obrigatório",
      });
    }

    if (action === "reserve") {
      const reservation = await reserveQuestion(
        supabase,
        companyId,
        question_id,
        profile,
      );
      return res.status(200).json({ success: true, reservation });
    }

    await releaseQuestion(supabase, companyId, question_id, profile);
    return res.status(200).json({ success: true, reservation: null });
  }

  // Nenhuma ação na pergunta se outra pessoa reservou
  await assertCanAct(supabase, companyId, question_id, profile);

  // ========================================
  // BLOQUEAR COMPRADOR
  // ========================================
  if (action === "block_buyer") {
    if (!buyer_id || !store_id) {
      return res.status(400).json({
        success: false,
        error:
          "buyer_id e store_id são obrigatórios",
      });
    }

    const {
      data: store,
      error: storeError,
    } = await supabase
      .from("stores")
      .select("*")
      .eq("id", store_id)
      .eq("company_id", companyId)
      .single();

    if (storeError || !store) {
      return res.status(404).json({
        success: false,
        error: "Loja não encontrada",
      });
    }

    let activeStore = store;

    try {
      await axios.post(
        `https://api.mercadolibre.com/users/${activeStore.seller_id}/questions_blacklist`,
        {
          user_id: Number(buyer_id),
        },
        {
          headers: {
            Authorization:
              `Bearer ${activeStore.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (blockError) {
      const errorData =
        blockError.response?.data;

      const status =
        blockError.response?.status;

      const tokenExpired =
        errorData?.message === "invalid_token" ||
        errorData?.error === "invalid_token" ||
        status === 401;

      if (!tokenExpired) {
        throw blockError;
      }

      activeStore =
        await refreshStoreToken(
          store,
          supabase,
        );

      await axios.post(
        `https://api.mercadolibre.com/users/${activeStore.seller_id}/questions_blacklist`,
        {
          user_id: Number(buyer_id),
        },
        {
          headers: {
            Authorization:
              `Bearer ${activeStore.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return res.status(200).json({
      success: true,
      message:
        "Comprador bloqueado para novas perguntas.",
    });
  }

  // ========================================
  // REMOVER DAS PENDENTES DO CHATI
  // ========================================
  if (!question_id) {
    return res.status(400).json({
      success: false,
      error:
        "question_id é obrigatório",
    });
  }

  const { error: hideError } =
    await supabase
      .from("hidden_questions")
      .upsert(
        {
          question_id:
            String(question_id),

          company_id:
            String(companyId),
        },
        {
          onConflict:
            "company_id,question_id",
        },
      );

  if (hideError) {
    console.error(
      "Erro ao remover pergunta:",
      hideError,
    );

    return res.status(500).json({
      success: false,
      error:
        hideError.message,
    });
  }

  await clearReservation(supabase, companyId, question_id);

  return res.status(200).json({
    success: true,
    message:
      "Pergunta removida das pendentes.",
  });
}

// ==========================================
// EXCLUIR PERGUNTA NO MERCADO LIVRE
// ==========================================
if (req.method === "DELETE") {
  const {
    question_id,
    store_id,
  } = req.body || {};

  if (
    !question_id ||
    !store_id
  ) {
    return res.status(400).json({
      success: false,
      error:
        "question_id e store_id são obrigatórios",
    });
  }

  await assertCanAct(supabase, companyId, question_id, profile);

  const {
    data: store,
    error: storeError,
  } = await supabase
    .from("stores")
    .select("*")
    .eq("id", store_id)
    .eq("company_id", companyId)
    .single();

  if (storeError || !store) {
    return res.status(404).json({
      success: false,
      error:
        "Loja não encontrada",
    });
  }

  let activeStore = store;

  try {
    await axios.delete(
      `https://api.mercadolibre.com/questions/${question_id}`,
      {
        headers: {
          Authorization:
            `Bearer ${activeStore.access_token}`,
        },
      },
    );

  } catch (deleteError) {
    const errorData =
      deleteError.response?.data;

    const status =
      deleteError.response?.status;

    const tokenExpired =
      errorData?.message === "invalid_token" ||
      errorData?.error === "invalid_token" ||
      status === 401;

    if (!tokenExpired) {
      throw deleteError;
    }

    activeStore =
      await refreshStoreToken(
        store,
        supabase,
      );

    await axios.delete(
      `https://api.mercadolibre.com/questions/${question_id}`,
      {
        headers: {
          Authorization:
            `Bearer ${activeStore.access_token}`,
        },
      },
    );
  }

  // Também evita que ela reapareça no Chati
  await supabase
    .from("hidden_questions")
    .upsert(
      {
        question_id:
          String(question_id),

        company_id:
          String(companyId),
      },
      {
        onConflict:
          "company_id,question_id",
      },
    );

  await clearReservation(supabase, companyId, question_id);

  return res.status(200).json({
    success: true,
    message:
      "Pergunta excluída com sucesso.",
  });
}


    // ==========================================
    // LISTAR PERGUNTAS
    // ==========================================
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }
const {
      data: company,
      error: companyError,
    } = await supabase
      .from("companies")
      .select("id, questions_since")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      return res.status(500).json({
        success: false,
        error: companyError.message,
      });
    }

    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Empresa não encontrada",
      });
    }

    const questionsSince = company.questions_since
      ? new Date(company.questions_since)
      : null;

    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("*")
      .eq("platform", "mercadolivre")
      .eq("company_id", companyId);

    if (storesError) {
      return res.status(500).json({
        success: false,
        error: storesError.message,
      });
    }

    if (!stores || stores.length === 0) {
      return res.status(200).json({
        success: true,
        total: 0,
        questions: [],
        stores: 0,
        message: "Nenhuma loja do Mercado Livre integrada nesta empresa.",
      });
    }

    const {
  data: hiddenQuestions,
  error: hiddenQuestionsError,
} = await supabase
  .from("hidden_questions")
  .select("question_id")
  .eq("company_id", String(companyId));

if (hiddenQuestionsError) {
  console.error(
    "Erro ao carregar perguntas removidas:",
    hiddenQuestionsError,
  );
}

const reservations = await getReservations(
  supabase,
  companyId,
);

const hiddenQuestionIds = new Set(
  (hiddenQuestions || []).map((item) =>
    String(item.question_id),
  ),
);

    const allQuestions = [];

    for (let store of stores) {
      try {
        let response;

        try {
          response = await axios.get(
            `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=UNANSWERED`,
            {
              headers: {
                Authorization: `Bearer ${store.access_token}`,
              },
            },
          );
        } catch (tokenError) {
          const errorData = tokenError.response?.data;
          const status = tokenError.response?.status;

          const tokenExpired =
            errorData?.message === "invalid_token" ||
            errorData?.error === "invalid_token" ||
            status === 401;

          if (!tokenExpired) {
            throw tokenError;
          }

          store = await refreshStoreToken(store, supabase);

          response = await axios.get(
            `https://api.mercadolibre.com/questions/search?seller_id=${store.seller_id}&status=UNANSWERED`,
            {
              headers: {
                Authorization: `Bearer ${store.access_token}`,
              },
            },
          );
        }

        const questions = response.data.questions || [];

for (const question of questions) {
  if (
    hiddenQuestionIds.has(
      String(question.id),
    )
  ) {
    continue;
  }

  // Se o Superadmin definiu um marco de início,
  // ignora perguntas criadas antes dele.
  if (
    questionsSince &&
    question.date_created &&
    new Date(question.date_created) < questionsSince
  ) {
    continue;
  }

  const [
    liveQuestion,
    productData,
    customerData,
    previousQuestions,
  ] = await Promise.all([
    getQuestionStatus(
      question.id,
      store.access_token,
    ),

    getProductData(
      question.item_id,
      store.access_token,
    ),

    getCustomerData(
      question.from?.id,
      store.access_token,
    ),

    getPreviousQuestions(
      store,
      question,
      supabase,
    ),
  ]);
        
            // Pergunta não existe mais no Mercado Livre
if (!liveQuestion) {
  continue;
}

// Não está mais realmente pendente
if (
  String(liveQuestion.status).toUpperCase() !==
  "UNANSWERED"
) {
  continue;
}

// Pergunta removida da publicação
if (
  liveQuestion.deleted_from_listing === true
) {
  continue;
}

// Pergunta bloqueada / retida
if (liveQuestion.hold === true) {
  continue;
}

const productStatus =
  productData.status;

const canAnswer =
  productStatus !== "closed" &&
  productStatus !== "paused";

const unavailableReason =
  productStatus === "closed"
    ? "O produto foi vendido ou o anúncio foi encerrado."
    : productStatus === "paused"
      ? "O anúncio está pausado e não permite resposta no momento."
      : null;

allQuestions.push({
  ...question,

  status: liveQuestion.status,
  hold: liveQuestion.hold === true,
  deleted_from_listing:
    liveQuestion.deleted_from_listing === true,

  store_name: store.name,
  store_id: store.id,

  product_title: productData.title,
  product_sku: productData.sku,
  product_thumbnail: productData.thumbnail,
  product_link: productData.permalink,
  product_quantity: productData.available_quantity,
  product_price: productData.price,

  product_status: productStatus,
  can_answer: canAnswer,

unavailable_reason:
  unavailableReason,

  client_name: customerData.name,
  client_nickname: customerData.nickname,

  previous_questions: previousQuestions,

  reservation: publicReservation(
    reservations.get(String(question.id)),
    profile,
  ),

});
        }
      } catch (storeError) {
        console.error(
          `Erro na loja ${store.name}:`,
          storeError.response?.data || storeError.message,
        );
      }
    }

    return res.status(200).json({
      success: true,
      total: allQuestions.length,
      questions: allQuestions,
      questions_since: company.questions_since || null,
    });
  } catch (error) {
    console.error(
      "Erro em /api/questions:",
      error.response?.data || error,
    );

    if (error instanceof ReservationError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
        message: error.message,
        reservation: error.reservation,
      });
    }

    const statusCode =
      error instanceof AuthError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error: error.response?.data || error.message || "Erro interno",
    });
  }
}