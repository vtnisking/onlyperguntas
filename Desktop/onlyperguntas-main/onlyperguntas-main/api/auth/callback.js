import axios from "axios";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Código de autorização não encontrado.");
    }

    const tokenResponse = await axios.post("https://api.mercadolibre.com/oauth/token", {
      grant_type: "authorization_code",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      code,
      redirect_uri: process.env.MELI_REDIRECT_URI
    });

    const data = tokenResponse.data;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { error } = await supabase
      .from("stores")
      .insert({
        name: `Mercado Livre ${data.user_id}`,
        platform: "mercadolivre",
        seller_id: String(data.user_id),
        access_token: data.access_token,
        refresh_token: data.refresh_token
      });

    if (error) {
      return res.status(500).json({
        message: "Token gerado, mas erro ao salvar loja no Supabase.",
        error
      });
    }

    return res.status(200).json({
      message: "Loja Mercado Livre conectada e salva com sucesso!",
      seller_id: data.user_id
    });

  } catch (error) {
    return res.status(500).json({
      message: "Erro ao conectar com o Mercado Livre.",
      error: error.response?.data || error.message
    });
  }
}
