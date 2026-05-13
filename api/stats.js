await supabase.from("answer_logs").insert({
  question_id,
  store_id,
  store_name: store.name,
  user_id: "admin",
  user_email: "admin@centralizachat.com",
  answer_text: text,
});
