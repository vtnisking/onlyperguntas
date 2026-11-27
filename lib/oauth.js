import crypto from "node:crypto";

export class OAuthStateError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OAuthStateError";
    this.statusCode = statusCode;
  }
}

function getOAuthSecret() {
  const secret = process.env.OAUTH_STATE_SECRET;

  if (!secret) {
    throw new OAuthStateError(
      "OAUTH_STATE_SECRET não configurado",
      500,
    );
  }

  return secret;
}

function createSignature(encodedPayload) {
  return crypto
    .createHmac("sha256", getOAuthSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(firstValue, secondValue) {
  const firstBuffer = Buffer.from(firstValue);
  const secondBuffer = Buffer.from(secondValue);

  if (firstBuffer.length !== secondBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer,
  );
}

/**
 * Endereço (origin) para onde voltar depois da autorização.
 * O login do Chati fica salvo por endereço no navegador: voltar para
 * outro endereço (ex.: project-xxx.vercel.app) faz a pessoa cair no login.
 * Só aceita chatiapp.com.br, o próprio host do pedido e localhost.
 */
export function safeReturnOrigin(value, req) {
  try {
    if (!value) return null;
    const u = new URL(String(value));
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    const requestHost = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
      .split(",")[0]
      .trim()
      .split(":")[0]
      .toLowerCase();
    const ok =
      host === "chatiapp.com.br" ||
      host.endsWith(".chatiapp.com.br") ||
      host === "localhost" ||
      (requestHost && host === requestHost);
    if (!ok) return null;
    if (u.protocol === "http:" && host !== "localhost") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Origin de onde a conexão começou: ?return_origin=, Origin ou Referer. */
export function returnOriginFromRequest(req) {
  return (
    safeReturnOrigin(req?.query?.return_origin, req) ||
    safeReturnOrigin(req?.headers?.origin, req) ||
    safeReturnOrigin(req?.headers?.referer, req)
  );
}

export function createOAuthState({
  provider,
  companyId,
  profileId,
  authId,
  redirectPath = "/",
  returnOrigin = null,
  expiresInMinutes = 10,
}) {
  if (!provider) {
    throw new OAuthStateError(
      "Provedor OAuth obrigatório",
      500,
    );
  }

  if (!companyId || !profileId || !authId) {
    throw new OAuthStateError(
      "Dados do usuário incompletos para gerar o state",
      500,
    );
  }

  const now = Date.now();

  const payload = {
    provider,
    company_id: companyId,
    profile_id: profileId,
    auth_id: authId,
    redirect_path: redirectPath,
    return_origin: returnOrigin || null,
    nonce: crypto.randomBytes(32).toString("hex"),
    created_at: now,
    expires_at:
      now + expiresInMinutes * 60 * 1000,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
  ).toString("base64url");

  const signature =
    createSignature(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(
  state,
  expectedProvider = null,
) {
  if (!state || typeof state !== "string") {
    throw new OAuthStateError(
      "State OAuth não informado",
      400,
    );
  }

  const parts = state.split(".");

  if (parts.length !== 2) {
    throw new OAuthStateError(
      "State OAuth inválido",
      400,
    );
  }

  const [encodedPayload, receivedSignature] =
    parts;

  const expectedSignature =
    createSignature(encodedPayload);

  if (
    !safeCompare(
      receivedSignature,
      expectedSignature,
    )
  ) {
    throw new OAuthStateError(
      "Assinatura OAuth inválida",
      403,
    );
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(
        encodedPayload,
        "base64url",
      ).toString("utf8"),
    );
  } catch {
    throw new OAuthStateError(
      "Conteúdo do state OAuth inválido",
      400,
    );
  }

  if (!payload.expires_at) {
    throw new OAuthStateError(
      "State OAuth sem validade",
      400,
    );
  }

  if (Date.now() > payload.expires_at) {
    throw new OAuthStateError(
      "Autorização expirada. Inicie a conexão novamente.",
      400,
    );
  }

  if (
    expectedProvider &&
    payload.provider !== expectedProvider
  ) {
    throw new OAuthStateError(
      "Provedor OAuth inválido",
      400,
    );
  }

  if (
    !payload.company_id ||
    !payload.profile_id ||
    !payload.auth_id
  ) {
    throw new OAuthStateError(
      "State OAuth incompleto",
      400,
    );
  }

  return payload;
}