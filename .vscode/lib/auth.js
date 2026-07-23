export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

function getBearerToken(req) {
  const authorization = req.headers?.authorization;

  if (!authorization) {
    throw new AuthError(
      "Token de autenticação não enviado",
      401,
    );
  }

  const [type, token] = authorization.trim().split(/\s+/);

  if (type?.toLowerCase() !== "bearer" || !token) {
    throw new AuthError(
      "Formato de autenticação inválido",
      401,
    );
  }

  return token;
}

export async function getAuthenticatedContext(req, supabase) {
  const accessToken = getBearerToken(req);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    console.error("Erro ao validar sessão:", userError);

    throw new AuthError(
      "Sessão inválida ou expirada",
      401,
    );
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("users_app")
      .select(
        "id, auth_id, company_id, name, email, role, status",
      )
      .eq("auth_id", user.id)
      .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao buscar perfil do usuário:",
      profileError,
    );

    throw new AuthError(
      "Erro ao localizar o perfil do usuário",
      500,
    );
  }

  if (!profile) {
    throw new AuthError(
      "Perfil do usuário não encontrado",
      403,
    );
  }

  if (!profile.company_id) {
    throw new AuthError(
      "Usuário não vinculado a uma empresa",
      403,
    );
  }

  if (profile.status && profile.status !== "active") {
    throw new AuthError("Usuário inativo", 403);
  }

  return {
    accessToken,
    authUser: user,
    profile,
    companyId: profile.company_id,
  };
}