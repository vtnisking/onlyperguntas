/**
 * Reserva de resposta
 * ---------------------------------------------------------------
 * Quando um usuário reserva uma pergunta, só ele pode responder,
 * excluir, remover ou bloquear o comprador dela. Administradores
 * podem apenas liberar a reserva (ex.: a pessoa saiu e esqueceu).
 *
 * Tabela: question_reservations (ver supabase/question_reservations.sql)
 * Se a tabela ainda não existir, nada é travado e reservar avisa.
 */

export class ReservationError extends Error {
  constructor(message, statusCode = 423, code = "QUESTION_RESERVED", reservation = null) {
    super(message);
    this.name = "ReservationError";
    this.statusCode = statusCode;
    this.code = code;
    this.reservation = reservation;
  }
}

const TABLE = "question_reservations";
const ADMIN_ROLES = ["owner", "admin", "superadmin"];

function tableMissing(error) {
  if (!error) return false;
  const text = `${error.code || ""} ${error.message || ""}`;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /question_reservations/.test(text) && /(does not exist|schema cache|not find)/i.test(text)
  );
}

export function isAdmin(profile) {
  return ADMIN_ROLES.includes(profile?.role);
}

export function publicReservation(row, profile) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    user_name: row.user_name || "Outro usuário",
    created_at: row.created_at,
    mine: String(row.user_id) === String(profile?.id),
  };
}

/** Todas as reservas da empresa: Map(question_id -> linha) */
export async function getReservations(supabase, companyId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("question_id, user_id, user_name, created_at")
    .eq("company_id", String(companyId));

  if (error) {
    if (!tableMissing(error)) console.error("Erro ao carregar reservas:", error);
    return new Map();
  }

  return new Map((data || []).map((r) => [String(r.question_id), r]));
}

async function getReservation(supabase, companyId, questionId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("question_id, user_id, user_name, created_at")
    .eq("company_id", String(companyId))
    .eq("question_id", String(questionId))
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) return { missing: true, row: null };
    throw error;
  }

  return { missing: false, row: data || null };
}

/** Lança ReservationError se a pergunta estiver reservada por outra pessoa. */
export async function assertCanAct(supabase, companyId, questionId, profile) {
  if (!questionId) return;
  const { row } = await getReservation(supabase, companyId, questionId);
  if (row && String(row.user_id) !== String(profile?.id)) {
    throw new ReservationError(
      `Esta pergunta está reservada por ${row.user_name || "outro usuário"}. Só essa pessoa pode responder ou mexer nela.`,
      423,
      "QUESTION_RESERVED",
      publicReservation(row, profile),
    );
  }
}

export async function reserveQuestion(supabase, companyId, questionId, profile) {
  const current = await getReservation(supabase, companyId, questionId);

  if (current.missing) {
    throw new ReservationError(
      "A reserva de respostas ainda não foi ativada no banco de dados.",
      503,
      "RESERVATIONS_NOT_READY",
    );
  }

  if (current.row) {
    if (String(current.row.user_id) === String(profile.id)) {
      return publicReservation(current.row, profile);
    }
    throw new ReservationError(
      `${current.row.user_name || "Outro usuário"} já reservou esta pergunta.`,
      409,
      "QUESTION_RESERVED",
      publicReservation(current.row, profile),
    );
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      company_id: String(companyId),
      question_id: String(questionId),
      user_id: profile.id,
      user_name: profile.name || profile.email || "Usuário",
    })
    .select("question_id, user_id, user_name, created_at")
    .single();

  if (error) {
    // Duas pessoas clicaram ao mesmo tempo: vale quem chegou primeiro
    if (error.code === "23505") {
      const again = await getReservation(supabase, companyId, questionId);
      if (again.row && String(again.row.user_id) !== String(profile.id)) {
        throw new ReservationError(
          `${again.row.user_name || "Outro usuário"} já reservou esta pergunta.`,
          409,
          "QUESTION_RESERVED",
          publicReservation(again.row, profile),
        );
      }
      return publicReservation(again.row, profile);
    }
    throw error;
  }

  return publicReservation(data, profile);
}

export async function releaseQuestion(supabase, companyId, questionId, profile) {
  const current = await getReservation(supabase, companyId, questionId);
  if (current.missing || !current.row) return;

  const owner = String(current.row.user_id) === String(profile.id);
  if (!owner && !isAdmin(profile)) {
    throw new ReservationError(
      `Só ${current.row.user_name || "quem reservou"} ou um administrador pode liberar esta reserva.`,
      403,
      "QUESTION_RESERVED",
      publicReservation(current.row, profile),
    );
  }

  await clearReservation(supabase, companyId, questionId);
}

/** Apaga a reserva (pergunta respondida, excluída ou removida). Nunca lança. */
export async function clearReservation(supabase, companyId, questionId) {
  try {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("company_id", String(companyId))
      .eq("question_id", String(questionId));
    if (error && !tableMissing(error)) console.error("Erro ao limpar reserva:", error);
  } catch (e) {
    console.error("Erro ao limpar reserva:", e);
  }
}
