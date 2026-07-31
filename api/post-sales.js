import axios from "axios";
import { createClient } from "@supabase/supabase-js";

class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

function getBearerToken(req) {
  const authorization =
    req.headers?.authorization || req.headers?.Authorization;

  if (!authorization) {
    throw new AuthError("Token de autenticação não enviado", 401);
  }

  const [type, token] = authorization.trim().split(/\s+/);

  if (type?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError("Formato de autenticação inválido", 401);
  }

  return token;
}

async function getAuthenticatedContext(req, supabase) {
  const accessToken = getBearerToken(req);
  const { data, error: userError } = await supabase.auth.getUser(accessToken);
  const user = data?.user;

  if (userError || !user) {
    throw new AuthError("Sessão inválida ou expirada", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users_app")
    .select("id, auth_id, company_id, name, email, role, status")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new AuthError("Erro ao localizar o perfil do usuário", 500);
  }

  if (!profile) {
    throw new AuthError("Perfil do usuário não encontrado", 403);
  }

  if (!profile.company_id) {
    throw new AuthError("Usuário não vinculado a uma empresa", 403);
  }

  if (profile.status && profile.status !== "active") {
    throw new AuthError("Usuário inativo", 403);
  }

  return { authUser: user, profile, companyId: profile.company_id };
}

async function refreshStoreToken(store, supabase) {
  if (!store.refresh_token) {
    throw new Error(`A loja ${store.name || store.id} não possui refresh_token.`);
  }

  const response = await axios.post(
    "https://api.mercadolibre.com/oauth/token",
    {
      grant_type: "refresh_token",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token: store.refresh_token,
    },
    { headers: { "Content-Type": "application/json" } },
  );

  const tokenData = response.data;
  const { error: updateError } = await supabase
    .from("stores")
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || store.refresh_token,
    })
    .eq("id", store.id);

  if (updateError) {
    throw new Error(`Erro ao salvar o novo token: ${updateError.message}`);
  }

  return {
    ...store,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || store.refresh_token,
  };
}

async function meliRequest(store, supabase, config, allowRefresh = true) {
  try {
    return await axios({
      ...config,
      baseURL: "https://api.mercadolibre.com",
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${store.access_token}`,
      },
      timeout: 20000,
    });
  } catch (error) {
    const status = error.response?.status;

    if (allowRefresh && (status === 401 || status === 403)) {
      const refreshedStore = await refreshStoreToken(store, supabase);
      return meliRequest(refreshedStore, supabase, config, false);
    }

    throw error;
  }
}

function normalizeArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.claims)) return payload.claims;
  if (Array.isArray(payload?.messages)) return payload.messages;
  return [];
}

function pickDate(...values) {
  return values.find((value) => value && !Number.isNaN(Date.parse(value))) || null;
}

function classifyCaseStatus(claim) {
  const rawStatus = String(claim.status || "").toLowerCase();
  const stage = String(claim.stage || "").toLowerCase();
  const players = Array.isArray(claim.players) ? claim.players : [];
  const sellerPlayer = players.find((player) =>
    ["respondent", "seller"].includes(String(player.role || "").toLowerCase()),
  );
  const action = String(
    sellerPlayer?.available_actions?.[0] ||
      sellerPlayer?.status ||
      claim.action ||
      claim.expected_resolution ||
      "",
  ).toLowerCase();

  if (["closed", "resolved", "cancelled"].includes(rawStatus)) {
    return "resolved";
  }

  if (
    action.includes("respond") ||
    action.includes("send") ||
    action.includes("provide") ||
    action.includes("action") ||
    stage === "claim"
  ) {
    return "attention";
  }

  return "progress";
}

function getClaimType(claim) {
  const returnSignals = [
    claim.type,
    claim.stage,
    claim.reason_id,
    claim.reason?.name,
    claim.reason,
    claim.motive,
    claim.resource,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasReturn =
    Boolean(
      claim.return_id ||
      claim.return?.id ||
      claim.shipping?.return_id,
    ) ||
    returnSignals.includes("return") ||
    returnSignals.includes("devolu");

  return hasReturn
    ? "returns"
    : "claims";
}

function getClaimReason(claim) {
  return (
    claim.reason_id ||
    claim.reason?.name ||
    claim.reason ||
    claim.motive ||
    claim.type ||
    "Reclamação de pós-venda"
  );
}

function getClaimTitle(claim, status) {
  if (status === "resolved") return "Caso resolvido";
  if (status === "attention") return "Ação necessária no atendimento";
  return "Atendimento em andamento";
}

function getDeadline(claim, status) {
  if (status === "resolved") return "Encerrado";

  const date = pickDate(
    claim.due_date,
    claim.deadline,
    claim.expected_resolution_date,
    claim.date_due,
  );

  if (!date) {
    return status === "attention" ? "Responder o quanto antes" : "Aguardando atualização";
  }

  return `Prazo: ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))}`;
}

async function safeGetOrder(store, supabase, orderId) {
  if (!orderId) return null;
  try {
    const response = await meliRequest(store, supabase, {
      method: "GET",
      url: `/orders/${orderId}`,
    });
    return response.data;
  } catch (error) {
    console.error(`Erro ao buscar pedido ${orderId}:`, error.response?.data || error.message);
    return null;
  }
}

async function safeGetItem(store, supabase, itemId) {
  if (!itemId) return null;
  try {
    const response = await meliRequest(store, supabase, {
      method: "GET",
      url: `/items/${itemId}`,
    });
    return response.data;
  } catch (error) {
    console.error(`Erro ao buscar item ${itemId}:`, error.response?.data || error.message);
    return null;
  }
}

async function safeGetClaimMessages(store, supabase, claimId) {
  if (!claimId) return [];
  try {
    const response = await meliRequest(store, supabase, {
      method: "GET",
      url: `/post-purchase/v1/claims/${claimId}/messages`,
    });
    return normalizeArrayPayload(response.data);
  } catch (firstError) {
    try {
      const response = await meliRequest(store, supabase, {
        method: "GET",
        url: `/claims/${claimId}/messages`,
      });
      return normalizeArrayPayload(response.data);
    } catch (error) {
      console.error(`Erro ao buscar mensagens da reclamação ${claimId}:`, error.response?.data || error.message);
      return [];
    }
  }
}

function normalizeMessageText(message) {
  return (
    message?.message ||
    message?.text ||
    message?.content ||
    message?.body ||
    "Sem mensagens no atendimento."
  );
}

async function fetchClaimsForStore(store, supabase) {
  const endpoints = [
    "/post-purchase/v1/claims/search",
    "/claims/search",
  ];

  const statuses = ["opened", "closed"];
  const allClaims = [];
  let lastError = null;

  for (const status of statuses) {
    let payload = null;

    for (const endpoint of endpoints) {
      try {
        const response = await meliRequest(
          store,
          supabase,
          {
            method: "GET",
            url: endpoint,
            params: {
              status,
              limit: 50,
              offset: 0,
            },
          },
        );

        payload = response.data;
        break;
      } catch (error) {
        lastError = error;

        // Só tenta o endpoint alternativo se este não existir
        if (error.response?.status !== 404) {
          break;
        }
      }
    }

    if (payload) {
      allClaims.push(
        ...normalizeArrayPayload(payload),
      );
    }
  }

  if (
    allClaims.length === 0 &&
    lastError
  ) {
    throw lastError;
  }

  // Evita duplicações
  const claims = Array.from(
    new Map(
      allClaims.map((claim) => [
        String(claim.id),
        claim,
      ]),
    ).values(),
  );

  const normalized = await Promise.all(
    claims.map(async (claim) => {
      const orderId =
        claim.resource_id ||
        claim.order_id ||
        claim.resource?.id;

      const order = await safeGetOrder(
        store,
        supabase,
        orderId,
      );

      const orderItem =
        order?.order_items?.[0];

      const itemId =
        orderItem?.item?.id ||
        claim.item_id;

      const item = await safeGetItem(
        store,
        supabase,
        itemId,
      );

      const messages =
        await safeGetClaimMessages(
          store,
          supabase,
          claim.id,
        );

      const latestMessage = [...messages]
        .sort(
          (a, b) =>
            new Date(
              b.date_created ||
                b.created_at ||
                0,
            ) -
            new Date(
              a.date_created ||
                a.created_at ||
                0,
            ),
        )[0];

      const status =
        classifyCaseStatus(claim);

      const buyer = order?.buyer;

      return {
        id: String(claim.id),
        claim_id: String(claim.id),
        type: getClaimType(claim),
        case_type:
          getClaimType(claim) === "returns"
            ? "return"
            : "claim",
        status,
        platform_status: status,

        order_id: String(
          orderId || "Não informado",
        ),

        product_title:
          orderItem?.item?.title ||
          item?.title ||
          "Produto não identificado",

        product_thumbnail: (
          item?.thumbnail ||
          orderItem?.item?.thumbnail ||
          ""
        ).replace(/^http:/i, "https:"),

        price:
          orderItem?.unit_price ||
          order?.total_amount ||
          0,

        quantity:
          orderItem?.quantity || 1,

        store_id: store.id,

        store_name:
          store.name ||
          "Mercado Livre",

        buyer_name:
          [
            buyer?.first_name,
            buyer?.last_name,
          ]
            .filter(Boolean)
            .join(" ") ||
          buyer?.nickname ||
          "Cliente",

        reason: String(
          getClaimReason(claim),
        ),

        title: getClaimTitle(
          claim,
          status,
        ),

        description:
          claim.description ||
          claim.details ||
          `Reclamação ${
            claim.stage || "aberta"
          } no Mercado Livre.`,

        last_message: latestMessage
          ? normalizeMessageText(
              latestMessage,
            )
          : "Nenhuma mensagem disponível.",

        deadline: getDeadline(
          claim,
          status,
        ),

        date_created:
          claim.date_created ||
          claim.created_at ||
          null,

        last_updated:
          claim.last_updated ||
          claim.date_modified ||
          null,

        stage:
          claim.stage || null,

        raw_status:
          claim.status || null,

        messages_count:
          messages.length,
      };
    }),
  );

  return normalized;
}


function getMessageSenderRole(message, sellerId) {
  const role = String(
    message?.sender_role ||
    message?.sender?.role ||
    message?.from?.role ||
    message?.role ||
    "",
  ).toLowerCase();

  const senderId = String(
    message?.from?.user_id ||
    message?.from?.id ||
    message?.sender_id ||
    "",
  );

  if (
    role.includes("seller") ||
    role.includes("respondent") ||
    (sellerId && senderId === String(sellerId))
  ) {
    return "seller";
  }

  return "buyer";
}

async function safeGetOrderMessages(
  store,
  supabase,
  packId,
) {
  if (!packId || !store.seller_id) {
    return [];
  }

  try {
    const response = await meliRequest(
      store,
      supabase,
      {
        method: "GET",
        url:
          `/messages/packs/${packId}/sellers/${store.seller_id}`,
        params: {
          mark_as_read: false,
        },
      },
    );

    return normalizeArrayPayload(response.data);
  } catch (error) {
    console.error(
      `Erro ao buscar mensagens do pack ${packId}:`,
      error.response?.data || error.message,
    );

    return [];
  }
}

async function fetchMessagesForStore(
  store,
  supabase,
) {
  if (!store.seller_id) {
    return [];
  }

  const response = await meliRequest(
    store,
    supabase,
    {
      method: "GET",
      url: "/orders/search",
      params: {
        seller: store.seller_id,
        sort: "date_desc",
        limit: 50,
        offset: 0,
      },
    },
  );

  const orders = normalizeArrayPayload(
    response.data,
  );

  const threads = [];

  for (const order of orders) {
    const packId =
      order.pack_id ||
      order.id;

    const messages =
      await safeGetOrderMessages(
        store,
        supabase,
        packId,
      );

    if (!messages.length) {
      continue;
    }

    const buyerMessages = messages.filter(
      (message) =>
        getMessageSenderRole(
          message,
          store.seller_id,
        ) === "buyer",
    );

    if (!buyerMessages.length) {
      continue;
    }

    const sortMessages = (a, b) =>
      new Date(
        b.message_date?.created ||
        b.date_created ||
        b.created_at ||
        0,
      ) -
      new Date(
        a.message_date?.created ||
        a.date_created ||
        a.created_at ||
        0,
      );

    const latestMessage =
      [...messages].sort(sortMessages)[0];

    const latestBuyerMessage =
      [...buyerMessages].sort(sortMessages)[0];

    const orderItem =
      order.order_items?.[0];

    const item =
      await safeGetItem(
        store,
        supabase,
        orderItem?.item?.id,
      );

    const buyer =
      order.buyer;

    threads.push({
      id:
        `message-${store.id}-${packId}`,

      message_id: String(
        latestBuyerMessage?.id ||
        packId,
      ),

      pack_id: String(packId),
      case_type: "message",
      type: "messages",
      status: "attention",
      platform_status: "attention",
      raw_status: "open",

      order_id: String(
        order.id ||
        "Não informado",
      ),

      product_title:
        orderItem?.item?.title ||
        item?.title ||
        "Produto não identificado",

      product_thumbnail: (
        item?.thumbnail ||
        orderItem?.item?.thumbnail ||
        ""
      ).replace(/^http:/i, "https:"),

      price:
        orderItem?.unit_price ||
        order.total_amount ||
        0,

      quantity:
        orderItem?.quantity ||
        1,

      store_id:
        store.id,

      store_name:
        store.name ||
        "Mercado Livre",

      buyer_name:
        [
          buyer?.first_name,
          buyer?.last_name,
        ]
          .filter(Boolean)
          .join(" ") ||
        buyer?.nickname ||
        "Cliente",

      reason:
        "Mensagem do comprador",

      title:
        "Nova mensagem no chat",

      description:
        "Mensagem enviada pelo comprador no chat da plataforma.",

      last_message:
        normalizeMessageText(
          latestMessage,
        ),

      deadline:
        "Responder o quanto antes",

      date_created:
        latestBuyerMessage?.message_date?.created ||
        latestBuyerMessage?.date_created ||
        latestBuyerMessage?.created_at ||
        order.date_created ||
        null,

      last_updated:
        latestMessage?.message_date?.created ||
        latestMessage?.date_created ||
        latestMessage?.created_at ||
        order.last_updated ||
        null,

      messages_count:
        messages.length,
    });
  }

  return threads;
}

async function getInternalPostSalesCases(
  supabase,
  companyId,
) {
  const { data, error } = await supabase
    .from("post_sales_cases")
    .select(
      "case_id, case_type, status, resolved_at, resolved_by",
    )
    .eq("company_id", companyId);

  if (error) {
    if (error.code === "42P01") {
      throw new Error(
        "A tabela post_sales_cases ainda não foi criada no Supabase.",
      );
    }

    throw new Error(error.message);
  }

  return data || [];
}

function applyInternalPostSalesStatus(
  cases,
  internalCases,
) {
  const statusMap = new Map(
    internalCases.map((item) => [
      `${item.case_type}:${item.case_id}`,
      item,
    ]),
  );

  return cases.map((item) => {
    const caseType =
      item.case_type ||
      (
        item.type === "returns"
          ? "return"
          : item.type === "messages"
            ? "message"
            : "claim"
      );

    const caseId =
      caseType === "message"
        ? item.pack_id
        : item.claim_id || item.id;

    const internal =
      statusMap.get(
        `${caseType}:${caseId}`,
      );

    return {
      ...item,
      case_type: caseType,
      platform_status:
        item.platform_status ||
        item.status,
      status:
        internal?.status === "resolved"
          ? "resolved"
          : item.status,
      internal_status:
        internal?.status ||
        null,
      resolved_at:
        internal?.resolved_at ||
        null,
      resolved_by:
        internal?.resolved_by ||
        null,
    };
  });
}

function buildCounts(cases) {
  return {
    claims: cases.filter(
      (item) => item.case_type === "claim",
    ).length,

    messages: cases.filter(
      (item) => item.case_type === "message",
    ).length,

    returns: cases.filter(
      (item) => item.case_type === "return",
    ).length,

    attention: cases.filter(
      (item) => item.status === "attention",
    ).length,

    progress: cases.filter(
      (item) => item.status === "progress",
    ).length,

    resolved: cases.filter(
      (item) => item.status === "resolved",
    ).length,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const allowedMethods = [
      "GET",
      "POST",
      "DELETE",
    ];

    if (!allowedMethods.includes(req.method)) {
      res.setHeader(
        "Allow",
        allowedMethods.join(", "),
      );

      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const { action = "overview" } = req.query;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return res.status(500).json({
        success: false,
        error: "Variáveis do Supabase não configuradas",
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { companyId, profile, authUser } = await getAuthenticatedContext(req, supabase);


    if (
      action === "resolve" ||
      action === "reopen"
    ) {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};

      const caseId = String(
        body.case_id || "",
      ).trim();

      const caseType = String(
        body.case_type || "",
      ).trim();

      if (
        !caseId ||
        ![
          "claim",
          "message",
          "return",
        ].includes(caseType)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "case_id e case_type válidos são obrigatórios",
        });
      }

      if (action === "resolve") {
        if (req.method !== "POST") {
          return res.status(405).json({
            success: false,
            error:
              "Use POST para marcar como resolvido",
          });
        }

        const { error } = await supabase
          .from("post_sales_cases")
          .upsert(
            {
              company_id: companyId,
              case_id: caseId,
              case_type: caseType,
              status: "resolved",
              resolved_by: profile.id,
              resolved_at:
                new Date().toISOString(),
            },
            {
              onConflict:
                "company_id,case_id,case_type",
            },
          );

        if (error) {
          throw new Error(error.message);
        }

        return res.status(200).json({
          success: true,
          status: "resolved",
        });
      }

      if (req.method !== "DELETE") {
        return res.status(405).json({
          success: false,
          error:
            "Use DELETE para reabrir",
        });
      }

      const { error } = await supabase
        .from("post_sales_cases")
        .delete()
        .eq("company_id", companyId)
        .eq("case_id", caseId)
        .eq("case_type", caseType);

      if (error) {
        throw new Error(error.message);
      }

      return res.status(200).json({
        success: true,
        status: "open",
      });
    }

    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("id, name, seller_id, platform, access_token, refresh_token, company_id")
      .eq("platform", "mercadolivre")
      .eq("company_id", companyId);

    if (storesError) {
      return res.status(500).json({ success: false, error: storesError.message });
    }

    if (action === "test") {
      return res.status(200).json({
        success: true,
        message: "Autenticação segura funcionando",
        user: {
          auth_id: authUser.id,
          profile_id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role,
        },
        company_id: companyId,
        total_stores: stores?.length || 0,
        stores: (stores || []).map(({ access_token, refresh_token, ...store }) => store),
      });
    }

if (action === "detail") {
  const caseId = String(
    req.query.case_id ||
    req.query.claim_id ||
    "",
  ).trim();

  const caseType = String(
    req.query.case_type ||
    "claim",
  ).trim();

  const storeId = String(
    req.query.store_id || "",
  ).trim();

  if (!caseId || !storeId) {
    return res.status(400).json({
      success: false,
      error:
        "case_id e store_id são obrigatórios",
    });
  }

  const store = (stores || []).find(
    (item) =>
      String(item.id) === storeId,
  );

  if (!store) {
    return res.status(404).json({
      success: false,
      error: "Loja não encontrada",
    });
  }

  const messages =
    caseType === "message"
      ? await safeGetOrderMessages(
          store,
          supabase,
          caseId,
        )
      : await safeGetClaimMessages(
          store,
          supabase,
          caseId,
        );

  return res.status(200).json({
    success: true,
    case_id: caseId,
    case_type: caseType,
    messages,
  });
}

    if (action !== "overview" && action !== "claims") {
      return res.status(404).json({ success: false, error: "Ação não encontrada" });
    }

    if (!stores?.length) {
      return res.status(200).json({
        success: true,
        cases: [],
        counts: buildCounts([]),
        warnings: ["Nenhuma loja Mercado Livre conectada."],
      });
    }

    const results = await Promise.allSettled(
      stores.map(async (store) => {
        const [
          claims,
          messages,
        ] = await Promise.all([
          fetchClaimsForStore(
            store,
            supabase,
          ),
          fetchMessagesForStore(
            store,
            supabase,
          ),
        ]);

        return [
          ...claims,
          ...messages,
        ];
      }),
    );

    const cases = [];
    const warnings = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        cases.push(...result.value);
      } else {
        const store = stores[index];
        const apiError = result.reason?.response?.data;
        console.error(`Erro no pós-venda da loja ${store.name}:`, apiError || result.reason?.message);
        warnings.push(
          `${store.name || "Loja"}: ${apiError?.message || apiError?.error || result.reason?.message || "erro ao consultar"}`,
        );
      }
    });

    const internalCases =
      await getInternalPostSalesCases(
        supabase,
        companyId,
      );

    const normalizedCases =
      applyInternalPostSalesStatus(
        cases,
        internalCases,
      );

    normalizedCases.sort((a, b) =>
      new Date(
        b.last_updated ||
        b.date_created ||
        0,
      ) -
      new Date(
        a.last_updated ||
        a.date_created ||
        0,
      ),
    );

    return res.status(200).json({
      success: true,
      cases: normalizedCases,
      claims: normalizedCases.filter(
        (item) =>
          item.case_type === "claim",
      ),
      messages: normalizedCases.filter(
        (item) =>
          item.case_type === "message",
      ),
      returns: normalizedCases.filter(
        (item) =>
          item.case_type === "return",
      ),
      counts: buildCounts(normalizedCases),
      total_stores: stores.length,
      warnings,
    });
  } catch (error) {
    console.error("Erro em /api/post-sales:", error.response?.data || error);

    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }

    return res.status(error.response?.status || 500).json({
      success: false,
      error:
        error.response?.data?.message ||
        error.response?.data?.error ||
        error?.message ||
        "Erro interno na API de pós-vendas",
    });
  }
}
