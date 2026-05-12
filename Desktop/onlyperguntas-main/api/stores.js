import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, platform, seller_id, created_at")
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.status(200).json({
      stores: stores || []
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
