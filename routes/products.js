const router = require("express").Router();
const supabase = require("../config/supabase");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() }); // Temporary storage for uploaded files
const auth = require("../middleware/auth");

// ADD PRODUCT
router.post("/add", auth, upload.single("image"), async (req, res) => {
  const { title, description, price, category } = req.body;
  const user_id = req.user.id;
  const file = req.file;

  // Upload to Supabase
  const fileName = Date.now() + "-" + file.originalname;

  const { data, error } = await supabase.storage
    .from("products")
    .upload(fileName, file.buffer, {
      contentType: file.mimetype
    });

  if (error) return res.status(500).json(error);

  // Get public URL
  const { data: publicUrl } = supabase.storage
    .from("products")
    .getPublicUrl(fileName);

  // Save product
  const { data: product, error: dbError } = await supabase
    .from("products")
    .insert([{
     title,
     description,
     price,
     category,
     image: publicUrl.publicUrl,
     user_id
   }]); 

  if (dbError) return res.status(500).json(dbError);

  res.json({
    message: "Product with image uploaded",
    product
  });
});

// GET ALL PRODUCTS
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});

module.exports = router;


// GET MY PRODUCTS
router.get("/my", auth, async (req, res) => {
  const user_id = req.user.id;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});

// DELETE PRODUCT
router.delete("/:id", auth, async (req, res) => {
  const productId = req.params.id;
  const user_id = req.user.id;

  // Check if product belongs to user
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  if (product.user_id !== user_id) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  // Delete product
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId);

  if (error) return res.status(500).json(error);

  res.json({ message: "Product deleted successfully" });
});

// UPDATE PRODUCT
router.put("/:id", auth, async (req, res) => {
  const productId = req.params.id;
  const user_id = req.user.id;

  const { title, description, price } = req.body;

  // Check ownership
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  if (product.user_id !== user_id) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  // Update product
  const { data, error } = await supabase
    .from("products")
    .update({ title, description, price })
    .eq("id", productId);

  if (error) return res.status(500).json(error);

  res.json({
    message: "Product updated successfully",
    product: data
  });
});