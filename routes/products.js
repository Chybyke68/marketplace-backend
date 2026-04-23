const router = require("express").Router();
const supabase = require("../config/supabase");
const multer = require("multer");
const auth = require("../middleware/auth");

const upload = multer({ storage: multer.memoryStorage() });


// ============================
// ADD PRODUCT
// ============================
router.post("/add", auth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, price, category, condition, location } = req.body;
    const user_id = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "Image is required" });
    }

    const fileName = Date.now() + "-" + file.originalname;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype
      });

    if (uploadError) {
      return res.status(500).json(uploadError);
    }

    // Get public URL
    const { data: publicUrl } = supabase.storage
      .from("products")
      .getPublicUrl(fileName);

    // Save to DB
    const { data, error } = await supabase
      .from("products")
      .insert([{
        title,
        description,
        price,
        category,
        condition,
        location,
        image: publicUrl.publicUrl,
        user_id,
        status: "available"
      }])
      .select();

    if (error) return res.status(500).json(error);

    res.json({
      message: "Product added successfully",
      product: data[0]
    });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/test-rel", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select(`
      *, users(name, store_name)
    `)
    .eq("status", "available")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});


// ============================
// GET ALL PRODUCTS
// ============================
router.get("/", async (req, res) => {
  try {
    let query = supabase
      .from("products")
      .select("*, users(name, store_name)")
      .eq("status", "available")
      .order("created_at", { ascending: false });

    // OPTIONAL FILTERS (SAFE)
    const { search, category, location, minPrice, maxPrice } = req.query;

    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    if (category && category !== "All") {
      query = query.eq("category", category);
    }

    if (location) {
      query = query.ilike("location", `%${location}%`);
    }

    if (minPrice) query = query.gte("price", minPrice);
    if (maxPrice) query = query.lte("price", maxPrice);

    const { data, error } = await query;

    if (error) {
      console.log("PRODUCT ERROR:", error);
      return res.status(500).json({ message: error.message });
    }

    res.json(data);

  } catch (err) {
    console.log("SERVER CRASH:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================
// GET MY PRODUCTS
// ============================
router.get("/my", auth, async (req, res) => {
  const user_id = req.user.id;

  const { data, error } = await supabase
    .from("products")
    .select("*, users(name, store_name)")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});


// ============================
// GET SINGLE PRODUCT
// ============================
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("products")
    .select("*, users(name, store_name)")
    .eq("id", id)
    .single();


  if (error || !data) {
    return res.status(404).json({ message: "Product not found" });
  }

  res.json(data);
});


// ============================
// DELETE PRODUCT
// ============================
router.delete("/:id", auth, async (req, res) => {
  const productId = req.params.id;
  const user_id = req.user.id;

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

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId);

  if (error) return res.status(500).json(error);

  res.json({ message: "Product deleted successfully" });
});



// ============================
// UPDATE PRODUCT
// ============================
router.put("/:id", auth, async (req, res) => {
  const productId = req.params.id;
  const user_id = req.user.id;

  const { title, description, price } = req.body;

  const { data: product } = await supabase
    .from("products")
    .select("*, users(name, store_name)")
    .eq("id", productId)
    .single();

  if (!product) {
    return res.status(404).json({ message: "Product not found" });
  }

  if (product.user_id !== user_id) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const { data, error } = await supabase
    .from("products")
    .update({ title, description, price })
    .eq("id", productId)
    .select();

  if (error) return res.status(500).json(error);

  res.json({
    message: "Product updated successfully",
    product: data[0]
  });
});



module.exports = router;
