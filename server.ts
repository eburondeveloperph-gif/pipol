import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_DB_PATH = path.join(process.cwd(), "memory_db.json");

// Initialize Memory DB if not exists
if (!fs.existsSync(MEMORY_DB_PATH)) {
  fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify({
    discussions: {}
  }, null, 2));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get Memory Board for a discussion
  app.get("/api/memory/:id", (req, res) => {
    const db = JSON.parse(fs.readFileSync(MEMORY_DB_PATH, "utf-8"));
    res.json(db.discussions[req.params.id] || { facts: [], assumptions: [], conflicts: [], decisions: [], openQuestions: [] });
  });

  // Update Memory Board
  app.post("/api/memory/:id", (req, res) => {
    const db = JSON.parse(fs.readFileSync(MEMORY_DB_PATH, "utf-8"));
    db.discussions[req.params.id] = req.body;
    fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify(db, null, 2));
    res.json({ status: "saved" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
