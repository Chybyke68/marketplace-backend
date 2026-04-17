const router = require("express").Router();
const supabase = require("../config/supabase");
const auth = require("../middleware/auth");

// SEND MESSAGE
router.post("/send", auth, async (req, res) => {
  const { receiver_id, product_id, text } = req.body;
  const sender_id = req.user.id;

  const { data, error } = await supabase
    .from("messages")
    .insert([{ sender_id, receiver_id, product_id, text }])
    .select();

  if (error) return res.status(500).json(error);

  res.json(data[0]);
});

// GET MESSAGES (CHAT)
router.get("/:product_id/:user_id", auth, async (req, res) => {
  const { product_id, user_id } = req.params;
  const currentUser = req.user.id;

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser},receiver_id.eq.${user_id}),and(sender_id.eq.${user_id},receiver_id.eq.${currentUser})`
    )
    .eq("product_id", product_id)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json(error);

  res.json(data);
});

module.exports = router;
