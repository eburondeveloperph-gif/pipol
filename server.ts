import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";

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
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
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
    if (!db.discussions) db.discussions = {};
    db.discussions[req.params.id] = req.body;
    fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify(db, null, 2));
    
    // Broadcast update to all clients in the discussion room
    io.to(req.params.id).emit("memory_update", req.body);
    
    res.json({ status: "saved" });
  });

  // Save Avatars
  app.post("/api/avatars", (req, res) => {
    const AVATARS_PATH = path.join(process.cwd(), "avatars.json");
    fs.writeFileSync(AVATARS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ status: "saved" });
  });

  // Get Avatars
  app.get("/api/avatars", (req, res) => {
    const AVATARS_PATH = path.join(process.cwd(), "avatars.json");
    if (fs.existsSync(AVATARS_PATH)) {
      try {
        const data = JSON.parse(fs.readFileSync(AVATARS_PATH, "utf-8"));
        res.json(data);
      } catch (e) {
        res.json([]);
      }
    } else {
      res.json([]);
    }
  });

  // Socket.io connection handling
  io.on("connection", (socket) => {
    socket.on("join_discussion", (discussionId) => {
      socket.join(discussionId);
      console.log(`Socket ${socket.id} joined discussion ${discussionId}`);
    });

    socket.on("update_memory", (data) => {
      const { discussionId, memory } = data;
      const db = JSON.parse(fs.readFileSync(MEMORY_DB_PATH, "utf-8"));
      db.discussions[discussionId] = memory;
      fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify(db, null, 2));
      
      // Broadcast to others in the same room
      socket.to(discussionId).emit("memory_update", memory);
    });
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

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
