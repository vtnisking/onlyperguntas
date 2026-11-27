/**
 * Melhorar resposta com IA (Claude, da Anthropic)
 * ---------------------------------------------------------------
 * A chave fica só no servidor (ANTHROPIC_API_KEY na Vercel).
 * Modelo: ANTHROPIC_MODEL (padrão claude-haiku-5-5, rápido e barato).
 */

export class AiError extends Error {
  constructor(message, statusCode = 502, code = "AI_ERROR") {
    super(message);
    this.name = "AiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const ENDPOINT = "https://api.anthropic.com/v1/messages";

// Preços em US$ por milhão de tokens (platform.claude.com/docs/en/about-claude/pricing, nov/2026)
export const AI_MODELS = {
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    input: 0.1,
    output: 0.5,
    // Haiku 5.5 cobra mais caro em pedidos acima de 100 mil tokens
    longInput: 0.5,
    longOutput: 2.5,
    tagline: "Mais rápido e mais barato. Ótimo para corrigir e organizar textos.",
  },
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    input: 2,
    output: 10,
    tagline: "Equilíbrio entre qualidade e custo. Escrita mais natural.",
  },
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    input: 4,
    output: 20,
    tagline: "O mais inteligente. Melhor para respostas longas ou delicadas.",
  },
};

export const DEFAULT_MODEL = "claude-haiku-5-5";

export function costOf(model, inputTokens = 0, outputTokens = 0) {
  const m = AI_MODELS[model] || AI_MODELS[DEFAULT_MODEL];
  const long = m.longInput && inputTokens > 100000;
  const inP = long ? m.longInput : m.input;
  const outP = long ? m.longOutput : m.output;
  return (inputTokens * inP + outputTokens * outP) / 1_000_000;
}

const SYSTEM = `Você revisa respostas que vendedores escrevem para perguntas de compradores no Mercado Livre.

Reescreva a resposta do vendedor deixando-a mais clara, educada e profissional, em português do Brasil.

Regras:
- Mantenha exatamente o mesmo sentido, as mesmas informações, valores, prazos, condições e decisões do vendedor. Não invente nada e não tire nenhuma informação.
- Corrija ortografia, acentuação, pontuação e concordância.
- Tom cordial e direto, como um bom atendente. Pode começar com uma saudação curta (ex.: "Olá!") se combinar.
- Não inclua telefone, e-mail, links, redes sociais nem pedido para contato fora do Mercado Livre.
- Não use emojis, markdown, aspas ou assinaturas.
- Seja conciso: no máximo 2000 caracteres, de preferência bem menos.
- Responda somente com o texto final da resposta, sem explicações.`;

function explain(status, error = {}) {
  const type = error?.type || "";
  const msg = String(error?.message || "");
  if (status === 401 || type === "authentication_error")
    return "A chave da IA é inválida. Confira ANTHROPIC_API_KEY na Vercel.";
  if (/credit|balance|billing/i.test(msg))
    return "A conta da IA está sem créditos. Adicione créditos em console.anthropic.com.";
  if (status === 404 || type === "not_found_error")
    return "Modelo de IA não encontrado. Confira ANTHROPIC_MODEL na Vercel.";
  if (status === 429 || type === "rate_limit_error")
    return "Muitos pedidos à IA agora. Tente de novo em instantes.";
  if (status === 529 || type === "overloaded_error")
    return "A IA está sobrecarregada. Tente de novo em instantes.";
  const original = msg.replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[chave]").slice(0, 200);
  return `A IA não conseguiu melhorar a resposta (${status}${original ? `: ${original}` : ""}).`;
}

export async function improveAnswer({ text, question, questions = [], product, model }) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) {
    throw new AiError(
      "A IA ainda não foi ativada. Falta configurar ANTHROPIC_API_KEY na Vercel.",
      503,
      "AI_NOT_CONFIGURED",
    );
  }

  const perguntas = (questions.length ? questions : [question])
    .filter(Boolean)
    .map((q) => `- ${String(q).slice(0, 1500)}`)
    .join("\n");

  const userContent = [
    product ? `Anúncio: ${String(product).slice(0, 300)}` : "",
    perguntas ? `Pergunta(s) do comprador:\n${perguntas}` : "",
    `Resposta escrita pelo vendedor (reescreva esta):\n${String(text).slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const usedModel =
    (model && AI_MODELS[model] ? model : null) ||
    String(process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new AiError(
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "A IA demorou demais. Tente de novo."
        : "Sem conexão com a IA. Tente de novo.",
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* sem corpo */
  }

  if (!response.ok) {
    console.error("Erro da IA:", response.status, data?.error?.type, data?.error?.message);
    const err = new AiError(explain(response.status, data?.error));
    err.model = usedModel;
    throw err;
  }

  const improved = (data?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .slice(0, 2000);

  const usage = {
    input_tokens: data?.usage?.input_tokens || 0,
    output_tokens: data?.usage?.output_tokens || 0,
  };
  const cost_usd = costOf(usedModel, usage.input_tokens, usage.output_tokens);

  if (!improved) {
    const e = new AiError("A IA devolveu uma resposta vazia. Tente de novo.");
    e.usage = usage;
    e.model = usedModel;
    e.cost_usd = cost_usd;
    throw e;
  }
  return { text: improved, model: data?.model || usedModel, usage, cost_usd };
}
