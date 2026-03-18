import express from "express";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite Database
const db = new Database("transcripts.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS shared_transcripts (
    id TEXT PRIMARY KEY,
    title TEXT,
    transcript TEXT,
    briefing TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  );

  // Google OAuth URL
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file",
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  // Google OAuth Callback
  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      // In a real app, we'd store this in a session or database.
      // For this demo, we'll pass it back to the client via postMessage.
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'GOOGLE_AUTH_SUCCESS', 
                  tokens: ${JSON.stringify(tokens)} 
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google Auth Error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Create Google Doc
  app.post("/api/export/google-docs", async (req, res) => {
    const { tokens, title, content } = req.body;
    if (!tokens) return res.status(401).json({ error: "No tokens provided" });

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials(tokens);
      const docs = google.docs({ version: "v1", auth });
      const drive = google.drive({ version: "v3", auth });

      // Create a new doc
      const doc = await docs.documents.create({
        requestBody: { title },
      });

      const documentId = doc.data.documentId;

      // Insert content
      await docs.documents.batchUpdate({
        documentId: documentId!,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      });

      res.json({ success: true, documentId, url: `https://docs.google.com/document/d/${documentId}/edit` });
    } catch (error) {
      console.error("Export Error:", error);
      res.status(500).json({ error: "Failed to create Google Doc" });
    }
  });

  // Fetch Google Drive File Data
  app.post("/api/drive/fetch", async (req, res) => {
    const { fileId, tokens } = req.body;
    if (!fileId) return res.status(400).json({ error: "File ID is required" });

    try {
      let auth: any = process.env.GOOGLE_API_KEY; // Default to API Key

      if (tokens) {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials(tokens);
        auth = oauth2Client;
      }

      const drive = google.drive({ version: "v3", auth });
      
      // Get file metadata to check mimeType
      const metadata = await drive.files.get({
        fileId: fileId,
        fields: "mimeType, name",
      });

      // Download file
      const response = await drive.files.get(
        { fileId: fileId, alt: "media" },
        { responseType: "arraybuffer" }
      );

      const base64 = Buffer.from(response.data as ArrayBuffer).toString("base64");
      res.json({ 
        success: true, 
        data: base64, 
        mimeType: metadata.data.mimeType,
        name: metadata.data.name
      });
    } catch (error: any) {
      console.error("Drive Fetch Error Details:", error.response?.data || error.message);
      const errorMessage = error.response?.data?.error?.message || error.message;
      res.status(500).json({ 
        error: `ගොනුව බාගත කිරීම අසාර්ථක විය: ${errorMessage}. කරුණාකර ලින්ක් එක පරීක්ෂා කරන්න, ගොනුව 'Public' කරන්න හෝ Google API Key එක නිවැරදිදැයි බලන්න.` 
      });
    }
  });

  // Share Transcript API
  app.post("/api/share", (req, res) => {
    const { title, transcript, briefing } = req.body;
    const id = uuidv4();
    try {
      const stmt = db.prepare("INSERT INTO shared_transcripts (id, title, transcript, briefing) VALUES (?, ?, ?, ?)");
      stmt.run(id, title, transcript, briefing);
      res.json({ success: true, id });
    } catch (error) {
      console.error("Share Error:", error);
      res.status(500).json({ error: "Failed to share transcript" });
    }
  });

  // Get Shared Transcript API
  app.get("/api/share/:id", (req, res) => {
    const { id } = req.params;
    try {
      const stmt = db.prepare("SELECT * FROM shared_transcripts WHERE id = ?");
      const transcript = stmt.get(id);
      if (transcript) {
        res.json({ success: true, data: transcript });
      } else {
        res.status(404).json({ error: "Transcript not found" });
      }
    } catch (error) {
      console.error("Fetch Shared Error:", error);
      res.status(500).json({ error: "Failed to fetch shared transcript" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
