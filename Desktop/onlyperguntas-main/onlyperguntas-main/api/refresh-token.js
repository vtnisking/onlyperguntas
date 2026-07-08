import axios from "axios";

export default async function handler(req, res) {

  try {

    const response = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      {
        grant_type: 'refresh_token',
        client_id: process.env.MELI_APP_ID,
        client_secret: process.env.MELI_CLIENT_SECRET,
        refresh_token: process.env.MELI_REFRESH_TOKEN
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json({
      success: true,
      data: response.data
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });

  }

}
