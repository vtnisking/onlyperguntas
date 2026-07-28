export default function handler(req, res) {
  const appId = process.env.MELI_APP_ID;
  const redirectUri = process.env.MELI_REDIRECT_URI;
  const companyId = req.query.company_id;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      error: "company_id obrigatório",
    });
  }

  const authUrl =
    `https://auth.mercadolivre.com.br/authorization` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(companyId)}`;

  return res.redirect(authUrl);
}