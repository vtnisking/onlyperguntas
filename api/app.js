import { createClient } from "@supabase/supabase-js";
import meliConnectHandler from "../lib/meli-connect.js";
import meliCallbackHandler from "../lib/meli-callback.js";

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

async function getAuthenticatedCompany(
  req,
  supabase,
) {
  const authHeader =
    req.headers?.authorization ||
    req.headers?.Authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    throw new AuthError(
      "Token de autenticação não enviado",
      401,
    );
  }

  const accessToken = authHeader
    .slice("Bearer ".length)
    .trim();

  if (!accessToken) {
    throw new AuthError(
      "Token de autenticação não enviado",
      401,
    );
  }

console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("Access token recebido:", accessToken.substring(0, 20) + "...");

  const {
    data: userData,
    error: userError,
  } = await supabase.auth.getUser(
    accessToken,
  );

  console.log("userError:", userError);
console.log("userData:", userData);

  if (userError || !userData?.user) {
    console.error(
      "Erro ao validar usuário:",
      userError,
    );

    throw new AuthError(
      "Sessão inválida ou expirada",
      401,
    );
  }

  const authUser = userData.user;

  const {
    data: appUser,
    error: appUserError,
  } = await supabase
    .from("users_app")
    .select("id, company_id, auth_id, role")
    .eq("auth_id", authUser.id)
    .single();

  if (
    appUserError ||
    !appUser?.company_id
  ) {
    console.error(
      "Usuário não encontrado em users_app:",
      appUserError,
    );

    throw new AuthError(
      "Empresa do usuário não encontrada",
      403,
    );
  }

  return {
    user: authUser,
    appUser,
    companyId: appUser.company_id,
    accessToken,
  };
}

export default async function handler(req, res) {
  try {
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

const { action, company_id } = req.query;

if (!action) {
  return res.status(400).json({
    success: false,
    error: "action obrigatório",
  });
}

// ==========================================
// INTEGRAÇÃO MERCADO LIVRE
// ==========================================

if (action === "meli_connect") {
  return meliConnectHandler(req, res);
}

if (action === "meli_callback") {
  return meliCallbackHandler(req, res);
}

// ==========================================
// LISTAR LOJAS CONECTADAS
// ==========================================

if (action === "list_stores") {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  try {
    const {
      companyId,
    } = await getAuthenticatedCompany(
      req,
      supabase,
    );

    const {
      data: stores,
      error: storesError,
    } = await supabase
      .from("stores")
.select(
  "id, name, platform, seller_id, company_id, created_at, connected_at",
)
      .eq("company_id", companyId)
      .order("created_at", {
        ascending: false,
      });

    if (storesError) {
      console.error(
        "Erro ao listar lojas:",
        storesError,
      );

      return res.status(500).json({
        success: false,
        error: "Erro ao carregar lojas conectadas",
      });
    }

    return res.status(200).json({
      success: true,
      stores: stores || [],
      total: stores?.length || 0,
    });
  } catch (error) {
    const statusCode =
      error instanceof AuthError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "Erro ao listar lojas",
    });
  }
}

// ==========================================
// DESCONECTAR LOJA
// ==========================================

if (action === "disconnect_store") {
  if (
    req.method !== "DELETE" &&
    req.method !== "POST"
  ) {
    res.setHeader("Allow", "DELETE, POST");

    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  try {
    const auth =
  await getAuthenticatedCompany(
    req,
    supabase,
  );

console.log(
  "Retorno getAuthenticatedCompany:",
  auth,
);

const companyId = auth.companyId;
const appUser = auth.appUser;


    const storeId =
      req.body?.store_id ||
      req.query?.store_id;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: "store_id obrigatório",
      });
    }

    const {
      data: store,
      error: storeError,
    } = await supabase
      .from("stores")
      .select(
        "id, name, platform, seller_id, company_id",
      )
      .eq("id", storeId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (storeError) {
      console.error(
        "Erro ao localizar loja:",
        storeError,
      );

      return res.status(500).json({
        success: false,
        error: "Erro ao localizar a loja",
      });
    }

    if (!store) {
      return res.status(404).json({
        success: false,
        error:
          "Loja não encontrada ou não pertence à sua empresa",
      });
    }

    // Opcional: somente administradores podem desconectar.
   
if (!appUser) {
  return res.status(401).json({
    success: false,
    error:
      "Perfil do usuário autenticado não foi encontrado",
  });
}

if (
  appUser.role !== "admin" &&
  appUser.role !== "owner" &&
  appUser.role !== "superadmin"
) {
  return res.status(403).json({
    success: false,
    error:
      "Você não tem permissão para desconectar lojas",
  });
}

    const {
      error: deleteError,
    } = await supabase
      .from("stores")
      .delete()
      .eq("id", store.id)
      .eq("company_id", companyId);

    if (deleteError) {
      console.error(
        "Erro ao desconectar loja:",
        deleteError,
      );

      return res.status(500).json({
        success: false,
        error: "Erro ao desconectar a loja",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Loja desconectada com sucesso",
      store: {
        id: store.id,
        name: store.name,
        platform: store.platform,
        seller_id: store.seller_id,
      },
    });
  } catch (error) {
    const statusCode =
      error instanceof AuthError
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      error:
        error?.message ||
        "Erro ao desconectar loja",
    });
  }
}

// ==========================================
// CRIAR EMPRESA + CRIAR ADMINISTRADOR COM SENHA INICIAL
// ==========================================

if (action === "create-company") {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  let createdCompanyId = null;
  let createdAuthUserId = null;

  try {
    // ========================================
    // CONFIRMA SE QUEM ESTÁ CHAMANDO É SUPERADMIN
    // ========================================

    const accessToken = getBearerToken(req);

    const {
      data: authData,
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !authData?.user) {
      return res.status(401).json({
        success: false,
        error: "Sessão inválida ou expirada",
      });
    }

    const {
      data: requester,
      error: requesterError,
    } = await supabase
      .from("users_app")
      .select("id, auth_id, role, status")
      .eq("auth_id", authData.user.id)
      .maybeSingle();

    if (requesterError || !requester) {
      return res.status(403).json({
        success: false,
        error: "Usuário não autorizado",
      });
    }

    if (
      requester.role !== "superadmin" ||
      requester.status !== "active"
    ) {
      return res.status(403).json({
        success: false,
        error: "Apenas o superadmin pode criar empresas",
      });
    }

    // ========================================
    // DADOS
    // ========================================

    const {
      name,
      email,
      password,
      plan,
      max_users,
      expires_at,
      status,
    } = req.body || {};

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        error:
          "Nome da empresa, e-mail do administrador e senha inicial são obrigatórios",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "A senha inicial deve ter pelo menos 6 caracteres",
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // ========================================
    // VERIFICA SE O E-MAIL JÁ EXISTE
    // ========================================

    const {
      data: existingUser,
      error: existingUserError,
    } = await supabase
      .from("users_app")
      .select("id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUserError) {
      throw existingUserError;
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error:
          "Já existe um usuário cadastrado com este e-mail",
      });
    }

    // ========================================
    // 1. CRIA EMPRESA
    // ========================================

    const {
      data: company,
      error: companyError,
    } = await supabase
      .from("companies")
      .insert({
        name: normalizedName,
        owner_email: normalizedEmail,
        plan: plan || "bronze",
        max_users: Number(max_users) || 5,
        expires_at: expires_at || null,
        status: status || "active",
      })
      .select()
      .single();

    if (companyError) {
      throw companyError;
    }

    createdCompanyId = company.id;

    // ========================================
    // 2. CRIA ADMINISTRADOR NO SUPABASE AUTH
    //    SEM ENVIAR E-MAIL (modo temporário)
    // ========================================

    const {
      data: authCreateData,
      error: authCreateError,
    } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: normalizedName,
        company_id: company.id,
        company_name: company.name,
        role: "admin",
      },
    });

    if (authCreateError) {
      throw authCreateError;
    }

    createdAuthUserId = authCreateData?.user?.id;

    if (!createdAuthUserId) {
      throw new Error(
        "O Supabase não retornou o usuário criado",
      );
    }

    // ========================================
    // 3. CRIA PERFIL EM users_app
    // ========================================

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("users_app")
      .insert({
        company_id: company.id,
        auth_id: createdAuthUserId,
        name: normalizedName,
        email: normalizedEmail,
        role: "admin",
        status: "active",
      })
      .select(
        "id, auth_id, company_id, name, email, role, status",
      )
      .single();

    if (profileError) {
      throw profileError;
    }

    return res.status(201).json({
      success: true,
      message:
        "Empresa e administrador criados com sucesso",
      company,
      user: profile,
    });
  } catch (error) {
    console.error(
      "Erro ao criar empresa:",
      error,
    );

    // Remove usuário Auth caso tenha sido criado
    if (createdAuthUserId) {
      try {
        await supabase.auth.admin.deleteUser(
          createdAuthUserId,
        );
      } catch (rollbackError) {
        console.error(
          "Erro no rollback do Authentication:",
          rollbackError,
        );
      }
    }

    // Remove empresa caso tenha sido criada
    if (createdCompanyId) {
      try {
        await supabase
          .from("companies")
          .delete()
          .eq("id", createdCompanyId);
      } catch (rollbackError) {
        console.error(
          "Erro no rollback da empresa:",
          rollbackError,
        );
      }
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro interno ao criar empresa",
    });
  }
}



// ==========================================
// EXCLUIR EMPRESA
// ==========================================

if (action === "delete-company") {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  try {
    const accessToken = getBearerToken(req);

    const {
      data: authData,
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !authData?.user) {
      return res.status(401).json({
        success: false,
        error: "Sessão inválida ou expirada",
      });
    }

    const {
      data: requester,
      error: requesterError,
    } = await supabase
      .from("users_app")
      .select("id, role, status")
      .eq("auth_id", authData.user.id)
      .maybeSingle();

    if (
      requesterError ||
      !requester ||
      requester.role !== "superadmin" ||
      requester.status !== "active"
    ) {
      return res.status(403).json({
        success: false,
        error: "Apenas o superadmin pode excluir empresas",
      });
    }

    const { company_id: companyId } = req.body || {};

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id obrigatório",
      });
    }

    const {
      data: companyUsers,
      error: usersError,
    } = await supabase
      .from("users_app")
      .select("id, auth_id")
      .eq("company_id", companyId);

    if (usersError) {
      throw usersError;
    }

    for (const user of companyUsers || []) {
      if (user.auth_id) {
        const { error: authDeleteError } =
          await supabase.auth.admin.deleteUser(
            user.auth_id,
          );

        if (authDeleteError) {
          console.error(
            "Erro ao excluir usuário do Authentication:",
            user.auth_id,
            authDeleteError,
          );
        }
      }
    }

    const { error: profilesError } = await supabase
      .from("users_app")
      .delete()
      .eq("company_id", companyId);

    if (profilesError) {
      throw profilesError;
    }

    const { error: companyError } = await supabase
      .from("companies")
      .delete()
      .eq("id", companyId);

    if (companyError) {
      throw companyError;
    }

    return res.status(200).json({
      success: true,
      message: "Empresa excluída com sucesso",
    });
  } catch (error) {
    console.error("Erro ao excluir empresa:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro interno ao excluir empresa",
    });
  }
}

// As ações antigas ainda usam company_id.
// As ações seguras do Mercado Livre são tratadas antes.
if (!company_id) {
  return res.status(400).json({
    success: false,
    error: "company_id obrigatório",
  });
}

    // ==========================================
    // USUÁRIOS
    // ==========================================

    if (action === "users") {
      const { data, error } = await supabase
        .from("users_app")
        .select("id, name, email, role, status, created_at")
        .eq("company_id", company_id)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          success: false,
          error,
        });
      }

      return res.status(200).json({
        success: true,
        users: data || [],
      });
    }

    // ==========================================
    // ESTATÍSTICAS
    // ==========================================

    if (action === "stats") {
      const period = req.query.period || "day";
      const start = req.query.start;
      const end = req.query.end;
      const now = new Date();

      function brazilDateParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(date);

        return {
          year: Number(
            parts.find((part) => part.type === "year")?.value,
          ),
          month: Number(
            parts.find((part) => part.type === "month")?.value,
          ),
          day: Number(
            parts.find((part) => part.type === "day")?.value,
          ),
        };
      }

      function startOfBrazilDay(year, month, day) {
        return new Date(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
            2,
            "0",
          )}T00:00:00-03:00`,
        );
      }

      function endOfBrazilDay(year, month, day) {
        return new Date(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
            2,
            "0",
          )}T23:59:59.999-03:00`,
        );
      }

      const brazilToday = brazilDateParts(now);

      const todayStart = startOfBrazilDay(
        brazilToday.year,
        brazilToday.month,
        brazilToday.day,
      );

      let startDate;
      let endDate = endOfBrazilDay(
        brazilToday.year,
        brazilToday.month,
        brazilToday.day,
      );

      if (period === "day") {
        startDate = todayStart;
      } else if (period === "7days") {
        startDate = new Date(
          todayStart.getTime() - 6 * 24 * 60 * 60 * 1000,
        );
      } else if (period === "30days") {
        startDate = new Date(
          todayStart.getTime() - 29 * 24 * 60 * 60 * 1000,
        );
      } else if (period === "month") {
        startDate = startOfBrazilDay(
          brazilToday.year,
          brazilToday.month,
          1,
        );
      } else if (period === "year") {
        startDate = startOfBrazilDay(
          brazilToday.year,
          1,
          1,
        );
      } else if (period === "custom" && start && end) {
        startDate = new Date(`${start}T00:00:00-03:00`);
        endDate = new Date(`${end}T23:59:59.999-03:00`);
      } else {
        startDate = todayStart;
      }

      const {
        count: companyTotal,
        error: countError,
      } = await supabase
        .from("answer_logs")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("company_id", company_id);

      if (countError) {
        return res.status(500).json({
          success: false,
          etapa: "contagem_sem_data",
          error: countError,
        });
      }

      const { data: logs, error: logsError } = await supabase
        .from("answer_logs")
        .select("*")
        .eq("company_id", company_id)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString())
        .order("created_at", { ascending: false });

      if (logsError) {
        return res.status(500).json({
          success: false,
          etapa: "consulta_com_data",
          error: logsError,
        });
      }

      const byUser = {};

      (logs || []).forEach((log) => {
        const user =
          log.user_name ||
          log.user_email ||
          "Sem usuário";

        byUser[user] = (byUser[user] || 0) + 1;
      });

      const {
        data: allUsers,
        error: usersError,
      } = await supabase
        .from("users_app")
        .select("name, email")
        .eq("company_id", company_id);

      if (usersError) {
        return res.status(500).json({
          success: false,
          etapa: "usuarios",
          error: usersError,
        });
      }

      const rankingUsers = Object.fromEntries(
        (allUsers || []).map((user) => {
          const displayName = user.name || user.email;

          return [
            displayName,
            byUser[user.name] ||
              byUser[user.email] ||
              0,
          ];
        }),
      );

      return res.status(200).json({
        success: true,
        period,
        server_now: now.toISOString(),
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        company_total_without_date_filter: companyTotal || 0,
        total: (logs || []).length,
        by_user: rankingUsers,
        logs: logs || [],
      });
    }


// ==========================================
// RESPOSTAS RÁPIDAS
// ==========================================

if (action === "quick-replies") {

  if (req.method === "GET") {

    const { data, error } = await supabase
      .from("quick_replies")
      .select("*")
      .eq("company_id", company_id)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.status(200).json({
      success: true,
      replies: data || [],
    });
  }

  if (req.method === "POST") {

    const { reply_text } = req.body;

    if (!reply_text?.trim()) {
      return res.status(400).json({
        success: false,
        error: "reply_text obrigatório",
      });
    }

    const { data, error } = await supabase
      .from("quick_replies")
      .insert({
        company_id,
        reply_text: reply_text.trim(),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.status(200).json({
      success: true,
      reply: data,
    });
  }

  if (req.method === "PUT") {

    const { id, reply_text } = req.body;

    const { error } = await supabase
      .from("quick_replies")
      .update({
        reply_text,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", company_id);

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.json({
      success: true,
    });
  }

  if (req.method === "DELETE") {

    const { id } = req.body;

    const { error } = await supabase
      .from("quick_replies")
      .delete()
      .eq("id", id)
      .eq("company_id", company_id);

    if (error) {
      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.json({
      success: true,
    });
  }

  return res.status(405).json({
    success: false,
    error: "Método não permitido",
  });
}


// ==========================================
// CRIAR USUÁRIO
// ==========================================

if (action === "create-user") {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido",
    });
  }

  let createdAuthUserId = null;

  try {
    const { name, email, password, role } = req.body || {};

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        error: "Nome, e-mail e senha são obrigatórios",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "A senha deve ter pelo menos 6 caracteres",
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    const allowedRoles = ["admin", "employee"];

    const normalizedRole = allowedRoles.includes(role)
      ? role
      : "employee";

    // Verifica se já existe na users_app
    const {
      data: existingUser,
      error: existingUserError,
    } = await supabase
      .from("users_app")
      .select("id, auth_id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUserError) {
      console.error(
        "Erro ao verificar usuário existente:",
        existingUserError,
      );

      return res.status(500).json({
        success: false,
        error: "Erro ao verificar o e-mail informado",
      });
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "Este e-mail já está cadastrado",
      });
    }

    // 1. Cria no Supabase Authentication
    const {
      data: authData,
      error: authError,
    } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: normalizedName,
      },
    });

    if (authError) {
      console.error(
        "Erro ao criar usuário no Authentication:",
        authError,
      );

      return res.status(400).json({
        success: false,
        error:
          authError.message ||
          "Erro ao criar usuário no Authentication",
      });
    }

    createdAuthUserId = authData?.user?.id;

    if (!createdAuthUserId) {
      return res.status(500).json({
        success: false,
        error: "O Authentication não retornou o ID do usuário",
      });
    }

    console.log(
      "Usuário criado no Authentication:",
      createdAuthUserId,
    );

    // 2. Cria o perfil e grava o UUID na coluna auth_id
    const {
      data: profileData,
      error: profileError,
    } = await supabase
      .from("users_app")
      .insert({
        company_id,
        auth_id: createdAuthUserId,
        name: normalizedName,
        email: normalizedEmail,
        role: normalizedRole,
        status: "active",
      })
      .select(
        "id, auth_id, company_id, name, email, role, status, created_at",
      )
      .single();

    if (profileError) {
      console.error(
        "Erro ao criar perfil em users_app:",
        profileError,
      );

      // Evita deixar usuário somente no Authentication
      await supabase.auth.admin.deleteUser(createdAuthUserId);

      return res.status(500).json({
        success: false,
        error:
          profileError.message ||
          "Erro ao criar perfil do usuário",
      });
    }

    console.log("Perfil criado em users_app:", profileData);

    return res.status(201).json({
      success: true,
      message: "Usuário criado com sucesso",
      user: profileData,
    });
  } catch (error) {
    console.error("Erro inesperado no create-user:", error);

    if (createdAuthUserId) {
      try {
        await supabase.auth.admin.deleteUser(createdAuthUserId);
      } catch (rollbackError) {
        console.error(
          "Erro ao remover usuário do Authentication:",
          rollbackError,
        );
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno ao criar usuário",
    });
  }
}

    // ==========================================
    // DELETAR USUÁRIO
    // ==========================================

    if (action === "delete-user") {
      if (req.method !== "POST") {
        return res.status(405).json({
          success: false,
          error: "Método não permitido",
        });
      }

      const { user_id } = req.body || {};

      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: "user_id obrigatório",
        });
      }

      const { error } = await supabase
        .from("users_app")
        .delete()
        .eq("id", user_id)
        .eq("company_id", company_id);

      if (error) {
        return res.status(500).json({
          success: false,
          error,
        });
      }

      return res.status(200).json({
        success: true,
      });
    }

    // ==========================================
    // AÇÃO NÃO ENCONTRADA
    // ==========================================

    return res.status(404).json({
      success: false,
      error: "Ação não encontrada",
    });
  } catch (error) {
    console.error("Erro em /api/app:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno",
    });
  }
}