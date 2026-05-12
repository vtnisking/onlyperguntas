export default async function handler(req, res) {
  try {
    console.log("Webhook recebido:");

    console.log(req.body);

    return res.status(200).json({
      success: true,
      message: "Webhook recebido com sucesso"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
