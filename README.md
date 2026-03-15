# fluxosaude
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let db: Database.Database;

// 1. Inicialização do Banco de Dados SQLite
try {
  db = new Database("fluxosaude.db");
  console.log("[Database] Banco de dados aberto com sucesso.");
} catch (err) {
  console.error("[Database] Erro ao abrir banco de dados:", err);
  process.exit(1);
}

// 2. Esquema do Banco de Dados (Tabelas principais)
db.exec(`
  CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cnpj TEXT UNIQUE,
    tax_rules TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS professionals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    crm TEXT UNIQUE,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'PROFISSIONAL',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS productions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    professional_id INTEGER,
    health_insurance_id INTEGER,
    procedure_id INTEGER,
    patient_name TEXT,
    value REAL,
    fee_value REAL DEFAULT 0,
    net_value REAL DEFAULT 0,
    billing_status TEXT DEFAULT 'A_FATURAR',
    payment_status TEXT DEFAULT 'EM_ABERTO',
    date TEXT,
    transfer_id INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(clinic_id) REFERENCES clinics(id),
    FOREIGN KEY(professional_id) REFERENCES professionals(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'ADMIN'
  );
`);

// 3. Servidor Express e Rotas de API
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Rota de Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT id, username, role FROM users WHERE username = ? AND password = ?")
      .get(username, password) as any;

    if (user) {
      res.json({ success: true, user });
    } else {
      res.status(401).json({ success: false, error: "Usuário ou senha inválidos" });
    }
  });

  // API: Salvar Produção Médica (com cálculo de taxas automático)
  app.post("/api/productions/batch", (req, res) => {
    const { productions, userId } = req.body;
    const insert = db.prepare(`
      INSERT INTO productions (
        clinic_id, professional_id, health_insurance_id, procedure_id, 
        patient_name, value, fee_value, net_value, date, billing_status, payment_status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'A_FATURAR', 'EM_ABERTO', ?)
    `);

    const transaction = db.transaction((prods) => {
      for (const p of prods) {
        // Busca regra de taxa da clínica
        const rule = db.prepare("SELECT * FROM rules WHERE clinic_id = ? LIMIT 1").get(p.clinic_id) as any;
        let feeValue = 0;
        if (rule) {
          feeValue = (p.value * (rule.fee_percent / 100)) + (rule.fixed_fee || 0);
        }
        const netValue = p.value - feeValue;

        insert.run(p.clinic_id, p.professional_id, p.health_insurance_id, p.procedure_id, p.patient_name, p.value, feeValue, netValue, p.date, userId);
      }
    });

    transaction(productions);
    res.json({ success: true });
  });

  // Configuração do Vite (Frontend) ou Arquivos Estáticos
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Fluxo Saúde rodando em http://localhost:${PORT}`);
  });
}

startServer()
