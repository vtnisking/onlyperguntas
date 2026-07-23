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

export function createOAuthState({
  provider,
  companyId,
  profileId,
  authId,
  redirectPath = "/",
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