import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import {
  AuthError,
  getAuthenticatedContext,
} from "../lib/auth.js";
import {
  ReservationError,
  assertCanAct,
  clearReservation,
} from "../lib/reservations.js";
import { AiError, improveAnswer } from "../lib/ai.js";
import {
  AiSettingsError,
  getAiSettings,
  getAiUsageReport,
  logAiUsage,
  monthCostUsd,
  saveAiSettings,
} from "../lib/ai-usage.js";

const AI_ADMIN_ROLES = ["owner", "admin", "superadmin"];

function aiClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.CHATI_SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function sendAiError(res, error) {
  if (error instanceof AiError || error instanceof AiSettingsError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code || "AI_ERROR",
      error: error.message,
      message: error.message,
    });
  }
  return null;
}

// Painel de custos e configurações da IA (só administradores)
async function handleAiAdmin(req, res) {
  const supabase = aiClient();
  const { profile, companyId } = await getAuthenticatedContext(req, supabase);

  if (!AI_ADMIN_ROLES.includes(profile.role)) {
    return res.status(403).json({
      success: false,
      error: "Só administradores podem ver os custos e as configurações da IA.",
    });
  }

  try {
    if (req.method === "GET" && req.query.action === "ai_usage") {
      const report = await getAiUsageReport(supabase, companyId, String(req.query.period || "month"));
      return res.status(200).json({
        success: true,
        api_key_configured: Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim()),
        ...report,
      });
    }

    if (req.method === "POST" && req.body?.action === "ai_settings") {
      const settings = await saveAiSettings(supabase, companyId, req.body.settings || {}, profile);
      return res.status(200).json({ success: true, settings });
    }
  } catch (error) {
    const sent = sendAiError(res, error);
    if (sent) return sent;
    throw error;
  }

  return res.status(404).json({ success: false, error: "Ação não encontrada" });
}

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
      `Erro ao atualizar token da loja: ${updateError.message}`,
    );
  }

  return {
    ...store,
    access_token: newData.access_token,
    refresh_token: newData.refresh_token,
  };
}

async function sendMercadoLivreAnswer(
  store,
  questionId,
  text,
) {
  return axios.post(
    "https://api.mercadolibre.com/answers",
    {
      question_id: questionId,
      text,
    },
    {
      headers: {
        Authorization: `Bearer ${store.access_token}`,
        "Content-Type": "application/json",
      },
    },
  );
}

async function saveAnswerLog(
  supabase,
  store,
  body,
  text,
) {
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
    console.error(
      "Erro ao salvar answer_log:",
      logError,
    );

    throw new Error(
      `A resposta foi enviada, mas o histórico não foi salvo: ${logError.message}`,
    );
  }
}

export default async function handler(req, res) {
  try {
    if (
      (req.method === "GET" && req.query?.action === "ai_usage") ||
      (req.method === "POST" && req.body?.action === "ai_settings")
    ) {
      return await handleAiAdmin(req, res);
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const {
      question_id,
      text,
      store_id,
    } = req.body || {};

    // ========================================
    // MELHORAR RESPOSTA COM IA (não envia nada ao ML)
    // ========================================
    if (req.body?.action === "improve") {
      const draft = String(text || "").trim();
      if (!draft) {
        return res.status(400).json({
          success: false,
          error: "Digite uma resposta para melhorar.",
        });
      }

      const supabaseAi = aiClient();
      const { profile: aiProfile, companyId: aiCompany } =
        await getAuthenticatedContext(req, supabaseAi);

      const settings = await getAiSettings(supabaseAi, aiCompany);
      if (!settings.enabled) {
        return res.status(403).json({
          success: false,
          code: "AI_DISABLED",
          error: "A IA está desligada para sua empresa. Um administrador pode ligar em Inteligência artificial → Configurações.",
          message: "A IA está desligada para sua empresa. Um administrador pode ligar em Inteligência artificial → Configurações.",
        });
      }
      if (settings.monthly_limit_usd > 0) {
        const spent = await monthCostUsd(supabaseAi, aiCompany);
        if (spent >= settings.monthly_limit_usd) {
          const msg = `Limite de gasto com IA deste mês atingido (US$ ${settings.monthly_limit_usd.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). Um administrador pode aumentar em Inteligência artificial → Configurações.`;
          return res.status(429).json({ success: false, code: "AI_LIMIT", error: msg, message: msg });
        }
      }

      const base = {
        company_id: aiCompany,
        user_id: aiProfile.id,
        user_name: aiProfile.name || aiProfile.email,
        feature: "melhorar_resposta",
      };

      try {
        const result = await improveAnswer({
          text: draft,
          questions: Array.isArray(req.body.questions) ? req.body.questions.slice(0, 10) : [],
          question: req.body.question,
          product: req.body.product,
          model: settings.model,
        });
        const logged = await logAiUsage(supabaseAi, {
          ...base,
          model: result.model,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cost_usd: result.cost_usd,
          ok: true,
        });
        return res.status(200).json({
          success: true,
          text: result.text,
          model: result.model,
          usage_logged: logged.ok,
          // Só administradores veem o motivo (para corrigir o banco)
          usage_log_error: logged.ok || !AI_ADMIN_ROLES.includes(aiProfile.role) ? undefined : logged.error,
        });
      } catch (error) {
        if (error instanceof AiError) {
          await logAiUsage(supabaseAi, {
            ...base,
            model: error.model || settings.model,
            input_tokens: error.usage?.input_tokens || 0,
            output_tokens: error.usage?.output_tokens || 0,
            cost_usd: error.cost_usd || 0,
            ok: false,
            error: error.message,
          });
        }
        const sent = sendAiError(res, error);
        if (sent) return sent;
        throw error;
      }
    }

    if (!question_id || !text || !store_id) {
      return res.status(400).json({
        success: false,
        error: "question_id, text ou store_id ausentes",
      });
    }

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

    const {
      profile,
      companyId,
    } = await getAuthenticatedContext(
      req,
      supabase,
    );

    await assertCanAct(
      supabase,
      companyId,
      question_id,
      profile,
    );

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
        details: storeError?.message || null,
      });
    }

    const answerBody = {
      question_id,
      text,
      store_id,
      user_id: profile.id,
      user_name: profile.name,
      user_email: profile.email,
    };

    let activeStore = store;
    let response;

    try {
      response = await sendMercadoLivreAnswer(
        activeStore,
        question_id,
        text,
      );
    } catch (tokenError) {
      const errorData =
        tokenError.response?.data;

      const status =
        tokenError.response?.status;

      const tokenExpired =
        errorData?.message === "invalid_token" ||
        errorData?.error === "invalid_token" ||
        status === 401;

      if (!tokenExpired) {
        throw tokenError;
      }

      activeStore = await refreshStoreToken(
        store,
        supabase,
      );

      response = await sendMercadoLivreAnswer(
        activeStore,
        question_id,
        text,
      );
    }

    await saveAnswerLog(
      supabase,
      activeStore,
      answerBody,
      text,
    );

    await clearReservation(
      supabase,
      companyId,
      question_id,
    );

    return res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    if (error instanceof ReservationError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
        message: error.message,
        reservation: error.reservation,
      });
    }

    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    const errorData = error.response?.data;
    const status = error.response?.status;

    console.error(
      "Erro em /api/answer:",
      errorData || error,
    );

    const rawError = JSON.stringify(
      errorData || error.message || "",
    ).toLowerCase();

    // Produto vendido, anúncio encerrado,
    // pausado ou inativo
    if (
      rawError.includes("item must be active") ||
      rawError.includes("item is not active")
    ) {
      return res.status(409).json({
        success: false,
        code: "QUESTION_UNAVAILABLE",
        reason: "ITEM_NOT_ACTIVE",
        message:
          "O produto foi vendido ou o anúncio foi encerrado. Esta pergunta não pode mais ser respondida.",
      });
    }

    // Pergunta excluída / inexistente
    if (
      status === 404 ||
      rawError.includes("question not found") ||
      rawError.includes(
        "question does not exist",
      )
    ) {
      return res.status(404).json({
        success: false,
        code: "QUESTION_UNAVAILABLE",
        reason: "QUESTION_NOT_FOUND",
        message:
          "Esta pergunta foi excluída ou não está mais disponível no Mercado Livre.",
      });
    }

    // Já respondida / não está pendente
    if (
      rawError.includes(
        "not_unanswered_question",
      )
    ) {
      return res.status(409).json({
        success: false,
        code: "QUESTION_ALREADY_ANSWERED",
        message:
          "Essa pergunta já foi respondida ou não está mais pendente.",
      });
    }

    return res.status(status || 500).json({
      success: false,
      message:
        errorData?.message ||
        errorData?.error ||
        error.message ||
        "Não foi possível responder.",
    });
  }
}