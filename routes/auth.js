const router = require("express").Router();
const supabase = require("../config/supabase");
const bcrypt = require("bcrypt");

// TEST
router.get("/test", (req, res) => {
  res.send("Auth route working");
});



// REGISTER
/*router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  // Check if user exists
  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (existingUser) {
    return res.status(400).json({ message: "User already exists" });
  }

  // 🔐 HASH PASSWORD
  const hashedPassword = await bcrypt.hash(password, 10);

  // Save user
  const { data, error } = await supabase
    .from("users")
    .insert([{ name, email, password: hashedPassword, role: role || "buyer" }]);

  if (error) return res.status(500).json(error);

  res.json({
    message: "User registered securely",
    user: data
  });
});*/

router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle(); // 🔥 FIX

  if (existingUser) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("users")
    .insert([{
      name, 
      email,
      password: hashedPassword,
      role: role || "buyer",
      store_name: name + "'s Store"
    }])
    .select(); // 🔥 IMPORTANT

  if (error) {
    console.log("REGISTER ERROR:", error);
    return res.status(500).json(error);
  }

  res.json({
    message: "User registered",
    user: data
  });
});



module.exports = router;


// LOGIN
const jwt = require("jsonwebtoken");

// LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (!user) return res.status(404).json({ message: "User not found" });

  //const bcrypt = require("bcrypt");
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(400).json({ message: "Wrong password" });
  }

  // 🔐 CREATE TOKEN
  const token = jwt.sign(
    { id: user.id, role: user.role },
    "secretkey",
    { expiresIn: "7d" }
  );

  res.json({
    message: "Login successful",
    token,
    user
  });
});

const auth = require("../middleware/auth");

router.get("/me", auth, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, phone, store_name, avatar")
    .eq("id", userId)
    .single();

  if (error) {
    console.log("ME ERROR:", error);
    return res.status(500).json({ message: "Failed to fetch user" });
  }

  res.json(data);
});

router.put("/update", auth, async (req, res) => {
  const userId = req.user.id;

  const {
    name,
    store_name,
    phone,
    whatsapp,
    email,
    location,
    sex,
    business_location,
    delivery
  } = req.body;

  const { data, error } = await supabase
    .from("users")
    .update({
      name,
      store_name,
      phone,
      whatsapp,
      email,
      location,
      sex,
      business_location,
      delivery
    })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.log("UPDATE ERROR:", error);
    return res.status(500).json({ message: "Update failed" });
  }

  res.json(data);
});

//const bcrypt = require("bcrypt");

router.put("/password", auth, async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  // get current user
  const { data: user, error } = await supabase
    .from("users")
    .select("password")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return res.status(400).json({ message: "User not found" });
  }

  // check current password
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return res.status(401).json({ message: "Wrong current password" });
  }

  // hash new password
  const hashed = await bcrypt.hash(newPassword, 10);

  // update password
  const { error: updateError } = await supabase
    .from("users")
    .update({ password: hashed })
    .eq("id", userId);

  if (updateError) {
    return res.status(500).json({ message: "Password update failed" });
  }

  res.json({ message: "Password updated" });
});

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload-avatar", auth, upload.single("image"), async (req, res) => {
  const userId = req.user.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const fileName = `avatar_${userId}_${Date.now()}`;

  // 🔥 Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("avatars") // bucket name
    .upload(fileName, file.buffer, {
      contentType: file.mimetype
    });

  if (uploadError) {
    console.log(uploadError);
    return res.status(500).json({ message: "Upload failed" });
  }

  // 🔥 Get public URL
  const { data } = supabase.storage
    .from("avatars")
    .getPublicUrl(fileName);

  const imageUrl = data.publicUrl;

  // 🔥 Save to DB
  const { error: dbError } = await supabase
    .from("users")
    .update({ avatar: imageUrl })
    .eq("id", userId);

  if (dbError) {
    return res.status(500).json({ message: "DB update failed" });
  }

  res.json({
    message: "Avatar updated",
    avatar: imageUrl
  });
});
