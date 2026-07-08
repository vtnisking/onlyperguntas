export default function handler(req, res) {
  const appId = process.env.MELI_APP_ID;
  const redirectUri = process.env.MELI_REDIRECT_URI;

  const authUrl =
    `https://auth.mercadolivre.com.br/authorization` +
    `?response_type=code` +
    `&client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(authUrl);
}
