import { createClient } from "@supabase/supabase-js";
import {
  AuthError,
  getAuthenticatedContext,
} from "../lib/auth.js";

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
      message: "Auth funcionando",
      company_id: companyId,
      user: {
        id: profile.id,
        auth_id: authUser.id,
        name: profile.name,
      },
    });
  } catch (error) {
    console.error("Erro teste auth:", error);

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
      error: error?.message || "Erro interno",
    });
  }
}