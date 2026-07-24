export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");

      return res.status(405).json({
        success: false,
        error: "Método não permitido",
      });
    }

    console.log("Webhook Mercado Livre recebido:", {
      headers: req.headers,
      query: req.query,
      body: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Webhook recebido com sucesso",
    });
  } catch (error) {
    console.error("Erro no webhook Mercado Livre:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Erro interno",
    });
  }
}