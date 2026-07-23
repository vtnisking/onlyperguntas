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
    data,
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  const user = data?.user;

  if (userError || !user) {
    console.error(
      "Erro ao validar sessão:",
      userError,
    );

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
    .eq("auth_id", user.id)
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

  if (
    profile.status &&
    profile.status !== "active"
  ) {
    throw new AuthError(
      "Usuário inativo",
      403,
    );
  }

  return {
    accessToken,
    authUser: user,
    profile,
    companyId: profile.company_id,
  };
}

export default async function handler(req, res) {
  try {
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

    const { action } = req.query;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: "action obrigatório",
      });
    }

    const {
      companyId,
      profile,
      authUser,
    } = await getAuthenticatedContext(
      req,
      supabase,
    );

    if (action === "test") {
      const {
        data: stores,
        error: storesError,
      } = await supabase
        .from("stores")
        .select(
          "id, name, seller_id, platform",
        )
        .eq("platform", "mercadolivre")
        .eq("company_id", companyId);

      if (storesError) {
        console.error(
          "Erro ao buscar lojas:",
          storesError,
        );

        return res.status(500).json({
          success: false,
          error: storesError.message,
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Autenticação segura funcionando",
        user: {
          auth_id: authUser.id,
          profile_id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role,
        },
        company_id: companyId,
        total_stores: stores?.length || 0,
        stores: stores || [],
      });
    }

    return res.status(404).json({
      success: false,
      error: "Ação não encontrada",
    });
  } catch (error) {
    console.error(
      "Erro em /api/post-sales:",
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
        "Erro interno na API de pós-vendas",
    });
  }
}