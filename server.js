const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json()); // 👈 IMPORTANT

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const supabase = require("./config/supabase");
app.get("/test-supabase", async (req, res) => {
  const { data, error } = await
   supabase.from("test").select("*");
   
  if (error) return res.json(error);
  
  res.json(data);
});

const productRoutes = require("./routes/products");
app.use("/api/products", productRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Campus Marketplace API is running");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});