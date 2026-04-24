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

  // ✅ FIRST: mark messages as seen
  await supabase
    .from("messages")
    .update({ seen: true })
    .eq("receiver_id", currentUser)
    .eq("product_id", product_id);

  // ✅ SECOND: fetch messages
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser},receiver_id.eq.${user_id}),and(sender_id.eq.${user_id},receiver_id.eq.${currentUser})`
    )
    .eq("product_id", product_id)
    .order("created_at", { ascending: true });

  if (error) {
    console.log("FETCH ERROR:", error);
    return res.status(500).json(error);
  }

  res.json(data);
});



router.get("/conversations", auth, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase.rpc("get_conversations", {
    user_id: userId
  });

  if (error) return res.status(500).json(error);

  res.json(data);
});


router.get("/unread-count", auth, async (req, res) => {
  const userId = req.user.id;

  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("receiver_id", userId)
    .eq("seen", false);

  if (error) return res.status(500).json(error);

  res.json({ count });
});

router.post("/typing", auth, async (req, res) => {
  const userId = req.user.id;
  const { product_id } = req.body;

  await supabase
    .from("typing_status")
    .upsert({
      user_id: userId,
      product_id,
      is_typing: true,
      updated_at: new Date()
    });

  res.json({ success: true });
});

router.get("/typing-status", async (req, res) => {
  const { product, user } = req.query;

  const { data } = await supabase
    .from("typing_status")
    .select("*")
    .eq("product_id", product)
    .eq("user_id", user)
    .single();

  const isTyping =
    data && new Date() - new Date(data.updated_at) < 3000;

  res.json({ typing: isTyping });
});

module.exports = router;
