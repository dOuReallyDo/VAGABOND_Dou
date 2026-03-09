import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// 1. API Routes (Always available)
app.get("/api/config", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  res.json({ apiKey });
});

app.get("/api/health", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV || "development",
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey.length,
    apiKeyPrefix: apiKey.substring(0, 4) // Only show prefix for security
  });
});

// 2. Setup serving logic
async function setupApp() {
  const distPath = path.join(process.cwd(), "dist");
  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(distPath);

  if (isProd) {
    console.log(`[PROD] Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("index.html not found in dist folder");
      }
    });
  } else {
    console.log("[DEV] Starting Vite middleware...");
    // Dynamic import for Vite to avoid loading it in production
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
}

// Start listening IMMEDIATELY to satisfy health checks
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is listening on port ${PORT}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  
  // Initialize the rest of the app in the background
  setupApp().catch(err => {
    console.error("Failed to setup app middleware:", err);
  });
});
