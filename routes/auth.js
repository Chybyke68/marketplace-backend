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
  const { email, password, role } = req.body;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (!user) return res.status(404).json({ message: "User not found" });

  const bcrypt = require("bcrypt");
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
