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

  const newTokenData = response.data;

  const { error: updateError } = await supabase
    .from("stores")
    .update({
      access_token: newTokenData.access_token,
      refresh_token:
        newTokenData.refresh_token || store.refresh_token,
    })
    .eq("id", store.id);

  if (updateError) {
    throw new Error(
      `Erro ao atualizar token da loja ${store.name}: ${updateError.message}`,
    );
  }

  return {
    ...store,
    access_token: newTokenData.access_token,
    refresh_token:
      newTokenData.refresh_token || store.refresh_token,
  };
}

async function requestWithTokenRefresh(
  store,
  supabase,
  requestFunction,
) {
  try {
    return await requestFunction(store.access_token);
  } catch (error) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    const tokenExpired =
      status === 401 ||
      errorData?.error === "invalid_token" ||
      errorData?.message === "invalid_token";

    if (!tokenExpired) {
      throw error;
    }

    console.log(
      `Token vencido da loja ${store.name}. Renovando...`,
    );

    const refreshedStore = await refreshStoreToken(
      store,
      supabase,
    );

    return await requestFunction(
      refreshedStore.access_token,
    );
  }
}

export default async function handler(req, res) {
  try {
    const {
      action,
      company_id: companyId,
    } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: "action obrigatório",
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id obrigatório",
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
      },
    );

    const { data: stores, error: storesError } =
      await supabase
        .from("stores")
        .select(
          "id, name, seller_id, platform, access_token, refresh_token",
        )
        .eq("platform", "mercadolivre")
        .eq("company_id", companyId);

    if (storesError) {
      return res.status(500).json({
        success: false,
        error: storesError.message,
      });
    }

    if (!stores?.length) {
      return res.status(200).json({
        success: true,
        total: 0,
        stores: [],
      });
    }

    // ==========================================
    // TESTAR TOKENS DAS LOJAS
    // ==========================================

    if (action === "test") {
      const testResults = [];

      for (const originalStore of stores) {
        let store = originalStore;

        try {
          const response =
            await requestWithTokenRefresh(
              store,
              supabase,
              async (accessToken) =>
                axios.get(
                  `https://api.mercadolibre.com/users/${store.seller_id}`,
                  {
                    headers: {
                      Authorization:
                        `Bearer ${accessToken}`,
                    },
                  },
                ),
            );

          testResults.push({
            id: store.id,
            name: store.name,
            seller_id: store.seller_id,
            connected: true,
            status: response.status,
            nickname:
              response.data?.nickname || null,
          });
        } catch (storeError) {
          console.error(
            `Erro ao testar loja ${store.name}:`,
            storeError.response?.data ||
              storeError.message,
          );

          testResults.push({
            id: store.id,
            name: store.name,
            seller_id: store.seller_id,
            connected: false,
            status:
              storeError.response?.status || null,
            error:
              storeError.response?.data ||
              storeError.message,
          });
        }
      }

      const connectedStores =
        testResults.filter(
          (store) => store.connected,
        ).length;

      return res.status(200).json({
        success: true,
        message:
          "Teste de autenticação das lojas concluído",
        total: testResults.length,
        connected: connectedStores,
        failed:
          testResults.length - connectedStores,
        stores: testResults,
      });
    }

    return res.status(404).json({
      success: false,
      error: "Ação não encontrada",
    });
  } catch (error) {
    console.error(
      "Erro em /api/post-sales:",
      error.response?.data || error,
    );

    return res.status(500).json({
      success: false,
      error:
        error.response?.data ||
        error.message ||
        "Erro interno na API de pós-vendas",
    });
  }
}