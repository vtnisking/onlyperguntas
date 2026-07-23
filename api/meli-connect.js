import { createClient } from "@supabase/supabase-js";

class AuthError extends Error {
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

  const [type, token] = authorization
    .trim()
    .split(/\s+/);

  if (
    type?.toLowerCase() !== "bearer" ||
    !token
  ) {
    throw new AuthError(
      "Formato de autenticação inválido",
      401,
    );
  }

  return token;
}

async function getAuthenticatedContext(
  req,
  supabase,
) {
  const accessToken = getBearerToken(req);

  const {
    data: authData,
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  const authUser = authData?.user;

  if (authError || !authUser) {
    throw new AuthError(
      "Sessão inválida ou expirada",
      401,
    );
  }

  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("users_app")
    .select(
      "id, auth_id, company_id, name, email, role, status",
    )
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (profileError) {
    console.error(
      "Erro ao buscar perfil:",
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

  return {
    authUser,
    profile,
    companyId: profile.company_id,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        success: false,
        error:
          "Variáveis do Supabase não configuradas",
      });
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const {
      companyId,
      profile,
      authUser,
    } = await getAuthenticatedContext(
      req,
      supabase,
    );

    return res.status(200).json({
      success: true,
      message: "Autenticação funcionando",
      company_id: companyId,
      user: {
        id: profile.id,
        auth_id: authUser.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
      },
    });
  } catch (error) {
    console.error(
      "Erro em /api/meli-connect:",
      error,
    );

    if (error instanceof AuthError) {
      return res
        .status(error.statusCode)
        .json({
          success: false,
          error: error.message,
        });
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro interno no meli-connect",
    });
  }
}