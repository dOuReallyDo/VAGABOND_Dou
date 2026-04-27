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
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.API_KEY || "";
  res.json({ apiKey });
});

app.get("/api/health", (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.API_KEY || "";
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV || "development",
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey.length,
    apiKeyPrefix: apiKey.substring(0, 4) // Only show prefix for security
  });
});

// URL Safety Check endpoint — Google Safe Browsing API
app.post("/api/check-url", async (req, res) => {
  const { urls } = req.body as { urls?: string[] };

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "Missing or invalid 'urls' array" });
    return;
  }

  const API_KEY = process.env.GOOGLE_SAFE_BROWSING_API_KEY;

  if (!API_KEY) {
    // No API key configured — return safe for all URLs (whitelist-only mode)
    const results: Record<string, { safe: boolean; threats: string[] }> = {};
    for (const url of urls) {
      results[url] = { safe: true, threats: [] };
    }
    res.json({ results });
    return;
  }

  try {
    const results: Record<string, { safe: boolean; threats: string[] }> = {};

    // Google Safe Browsing API allows up to 500 URLs per request
    const batch = urls.slice(0, 500);

    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: {
            clientId: "vagabond-dou",
            clientVersion: "1.0.0",
          },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: batch.map((url: string) => ({ url })),
          },
        }),
      }
    );

    if (!response.ok) {
      // API error — fail closed (assume unsafe)
      for (const url of urls) {
        results[url] = { safe: false, threats: ["API_ERROR"] };
      }
      res.json({ results });
      return;
    }

    const data = await response.json();
    const matches = data.matches || [];

    // Build a map of matched URLs to their threats
    const threatMap = new Map<string, string[]>();
    for (const match of matches) {
      const matchedUrl = match.threat?.url || "";
      const threatType = match.threatType || "UNKNOWN";
      const existing = threatMap.get(matchedUrl) || [];
      if (!existing.includes(threatType)) {
        existing.push(threatType);
      }
      threatMap.set(matchedUrl, existing);
    }

    for (const url of urls) {
      const threats = threatMap.get(url);
      results[url] = {
        safe: !threats,
        threats: threats || [],
      };
    }

    res.json({ results });
  } catch (error) {
    console.error("Safe Browsing API error:", error);
    // Network/unknown error — fail closed
    const results: Record<string, { safe: boolean; threats: string[] }> = {};
    for (const url of urls) {
      results[url] = { safe: false, threats: ["NETWORK_ERROR"] };
    }
    res.json({ results });
  }
});

// 2. Setup serving logic
async function setupApp() {
  const distPath = path.join(process.cwd(), "dist");
  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(distPath);

  if (isProd) {
    console.log(`[PROD] Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("/{*path}", (req, res) => {
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
