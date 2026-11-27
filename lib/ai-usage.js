/**
 * Uso e configurações da IA por empresa
 * ---------------------------------------------------------------
 * Tabelas (supabase/ai.sql):
 *   ai_settings  -> modelo, IA ligada/desligada e limite de gasto do mês
 *   ai_usage     -> cada chamada: quem, modelo, tokens e custo em US$
 * Sem as tabelas, a IA funciona com o padrão (Haiku, sem limite)
 * e nada é registrado.
 */
import { AI_MODELS, DEFAULT_MODEL } from "./ai.js";

const TZ = "America/Sao_Paulo";

// Só "a tabela não existe" (não confundir com coluna faltando ou outro erro)
function missing(error) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const t = String(error.message || "");
  return /relation .*(ai_usage|ai_settings).* does not exist/i.test(t) ||
    /could not find the table/i.test(t);
}

export const DEFAULT_SETTINGS = {
  enabled: true,
  model: DEFAULT_MODEL,
  monthly_limit_usd: 0,
};

export async function getAiSettings(supabase, companyId) {
  const { data, error } = await supabase
    .from("ai_settings")
    .select("enabled, model, monthly_limit_usd, updated_at, updated_by_name")
    .eq("company_id", String(companyId))
    .maybeSingle();

  if (error) {
    if (!missing(error)) console.error("Erro ao ler ai_settings:", error);
    return { ...DEFAULT_SETTINGS, ready: !missing(error) };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(data || {}),
    model: AI_MODELS[data?.model] ? data.model : DEFAULT_MODEL,
    monthly_limit_usd: Number(data?.monthly_limit_usd || 0),
    enabled: data ? data.enabled !== false : true,
    ready: true,
  };
}

export class AiSettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function saveAiSettings(supabase, companyId, input, profile) {
  const patch = {};
  if (input.model !== undefined) {
    if (!AI_MODELS[input.model]) throw new AiSettingsError("Modelo de IA inválido.");
    patch.model = input.model;
  }
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  if (input.monthly_limit_usd !== undefined) {
    const n = Number(String(input.monthly_limit_usd).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 10000) {
      throw new AiSettingsError("Limite do mês: de 0 (sem limite) a 10.000 dólares.");
    }
    patch.monthly_limit_usd = Math.round(n * 100) / 100;
  }

  const row = {
    company_id: String(companyId),
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by: String(profile.id),
    updated_by_name: profile.name || profile.email || null,
  };

  const { error } = await supabase.from("ai_settings").upsert(row, { onConflict: "company_id" });
  if (error) {
    if (missing(error)) {
      throw new AiSettingsError(
        "As configurações da IA ainda não foram ativadas no banco de dados (falta rodar o SQL).",
        503,
      );
    }
    console.error("Erro ao salvar ai_settings:", error);
    throw new AiSettingsError("Não foi possível salvar as configurações.", 500);
  }

  return getAiSettings(supabase, companyId);
}

/** Início do mês corrente no horário de Brasília, em ISO (UTC). */
export function monthStartIso(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .format(now)
    .split("-");
  // Brasília é UTC-3 (sem horário de verão)
  return new Date(`${y}-${m}-01T03:00:00.000Z`).toISOString();
}

function dayStartIso(daysBack = 0, now = new Date()) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now.getTime() - daysBack * 86400000));
  return new Date(`${d}T03:00:00.000Z`).toISOString();
}

export async function monthCostUsd(supabase, companyId) {
  const { data, error } = await supabase
    .from("ai_usage")
    .select("cost_usd")
    .eq("company_id", String(companyId))
    .gte("created_at", monthStartIso())
    .limit(100000);
  if (error) return 0;
  return (data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
}

/** Registra uma chamada. Nunca lança; devolve { ok, error }. */
export async function logAiUsage(supabase, row) {
  try {
    const { error } = await supabase.from("ai_usage").insert({
      company_id: String(row.company_id),
      user_id: row.user_id ? String(row.user_id) : null,
      user_name: row.user_name || null,
      feature: row.feature || "melhorar_resposta",
      model: row.model || null,
      input_tokens: row.input_tokens || 0,
      output_tokens: row.output_tokens || 0,
      cost_usd: Number((row.cost_usd || 0).toFixed(8)),
      ok: row.ok !== false,
      error: row.error ? String(row.error).slice(0, 300) : null,
    });
    if (error) {
      console.error("Erro ao registrar uso da IA:", error);
      return {
        ok: false,
        error: missing(error)
          ? "a tabela ai_usage não existe (falta rodar supabase/ai.sql)"
          : `${error.code || ""} ${error.message || "erro desconhecido"}`.trim(),
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("Erro ao registrar uso da IA:", e);
    return { ok: false, error: e.message || String(e) };
  }
}

const PERIODS = {
  today: () => dayStartIso(0),
  "7days": () => dayStartIso(6),
  "30days": () => dayStartIso(29),
  month: () => monthStartIso(),
};

/** Painel de custos: totais, por dia, por pessoa, por modelo e últimos usos. */
export async function getAiUsageReport(supabase, companyId, period = "month") {
  const since = (PERIODS[period] || PERIODS.month)();

  const [{ data, error }, settings, monthCost] = await Promise.all([
    supabase
      .from("ai_usage")
      .select("created_at, user_id, user_name, feature, model, input_tokens, output_tokens, cost_usd, ok, error")
      .eq("company_id", String(companyId))
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000),
    getAiSettings(supabase, companyId),
    monthCostUsd(supabase, companyId),
  ]);

  if (error && !missing(error)) {
    console.error("Erro ao ler ai_usage:", error);
    throw new AiSettingsError("Não foi possível carregar o uso da IA.", 500);
  }

  const rows = data || [];
  const sum = (list, k) => list.reduce((s, r) => s + Number(r[k] || 0), 0);
  const group = (keyFn) => {
    const m = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      const g = m.get(k) || { key: k, uses: 0, errors: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      g.uses += 1;
      if (r.ok === false) g.errors += 1;
      g.input_tokens += Number(r.input_tokens || 0);
      g.output_tokens += Number(r.output_tokens || 0);
      g.cost_usd += Number(r.cost_usd || 0);
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => b.cost_usd - a.cost_usd || b.uses - a.uses);
  };

  const okRows = rows.filter((r) => r.ok !== false);

  return {
    ready: !missing(error) && settings.ready,
    period,
    since,
    settings,
    month_cost_usd: monthCost,
    totals: {
      uses: rows.length,
      ok: okRows.length,
      errors: rows.length - okRows.length,
      input_tokens: sum(rows, "input_tokens"),
      output_tokens: sum(rows, "output_tokens"),
      cost_usd: sum(rows, "cost_usd"),
      avg_cost_usd: okRows.length ? sum(okRows, "cost_usd") / okRows.length : 0,
      avg_input_tokens: okRows.length ? sum(okRows, "input_tokens") / okRows.length : 0,
      avg_output_tokens: okRows.length ? sum(okRows, "output_tokens") / okRows.length : 0,
    },
    by_day: group((r) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(r.created_at))),
    by_user: group((r) => r.user_name || "Sem usuário"),
    by_model: group((r) => r.model || "—"),
    recent: rows.slice(0, 15),
    models: Object.values(AI_MODELS),
  };
}
