const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*", // allow all (for now)
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
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

app.use("/api/messages", require("./routes/messages"));

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
