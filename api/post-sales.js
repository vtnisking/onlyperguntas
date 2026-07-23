import axios from "axios";
import { createClient } from "@supabase/supabase-js";

async function refreshStoreToken(store, supabase) {
  const response = await axios.post(
    "https://api.mercadolibre.com/oauth/token",
    {
      grant_type: "refresh_token",
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token: store.refresh_token,
    },
  );

  const newData = response.data;

  await supabase
    .from("stores")
    .update({
      access_token: newData.access_token,
      refresh_token: newData.refresh_token,
    })
    .eq("id", store.id);

  return {
    ...store,
    access_token: newData.access_token,
    refresh_token: newData.refresh_token,
  };
}

export default async function handler(req, res) {

  try {

    const companyId = req.query.company_id;
    const action = req.query.action;

    if (!companyId) {
      return res.status(400).json({
        success:false,
        error:"company_id obrigatório"
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth:{
          persistSession:false,
          autoRefreshToken:false,
        },
      },
    );

    const { data: stores, error: storesError } =
      await supabase
      .from("stores")
      .select("*")
      .eq("platform","mercadolivre")
      .eq("company_id",companyId);

    if(storesError){

      return res.status(500).json({
        success:false,
        error:storesError.message
      });

    }

    if(!stores?.length){

      return res.status(200).json({
        success:true,
        cases:[]
      });

    }

    // ações virão aqui

  }
  catch(error){

    console.error(error);

    return res.status(500).json({
      success:false,
      error:error.message
    });

  }

}

if(action==="test"){

    return res.json({

        success:true,

        stores:stores.map(store=>({

            id:store.id,
            name:store.name,
            seller_id:store.seller_id

        }))

    });

}