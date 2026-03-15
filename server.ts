import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

console.log("========================================");
console.log("[Server] BOOTING UP...");
console.log("========================================");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let db: Database.Database;

try {
  console.log("[Database] Abrindo banco de dados fluxosaude.db...");
  db = new Database("fluxosaude.db");
  console.log("[Database] Banco de dados aberto com sucesso.");
} catch (err) {
  console.error("[Database] Erro ao abrir banco de dados:", err);
  process.exit(1);
}

// Migrações de Banco de Dados (Garantir colunas novas em tabelas existentes)
const ensureColumns = () => {
  const productionsInfo = db.prepare("PRAGMA table_info(productions)").all() as any[];
  const pCols = productionsInfo.map(c => c.name);
  
  if (pCols.length > 0) {
    if (!pCols.includes('health_insurance_id')) {
      db.exec("ALTER TABLE productions ADD COLUMN health_insurance_id INTEGER REFERENCES health_insurances(id)");
    }
    if (!pCols.includes('payment_status')) {
      db.exec("ALTER TABLE productions ADD COLUMN payment_status TEXT DEFAULT 'EM_ABERTO'");
    }
    if (!pCols.includes('transfer_id')) {
      db.exec("ALTER TABLE productions ADD COLUMN transfer_id INTEGER REFERENCES transfers(id)");
    }
    if (!pCols.includes('fee_value')) {
      db.exec("ALTER TABLE productions ADD COLUMN fee_value REAL DEFAULT 0");
    }
    if (!pCols.includes('net_value')) {
      db.exec("ALTER TABLE productions ADD COLUMN net_value REAL DEFAULT 0");
    }
    if (!pCols.includes('created_by')) {
      db.exec("ALTER TABLE productions ADD COLUMN created_by INTEGER REFERENCES users(id)");
    }
  }

  const usersInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
  const uCols = usersInfo.map(c => c.name);
  if (uCols.length > 0) {
    if (!uCols.includes('professional_id')) {
      db.exec("ALTER TABLE users ADD COLUMN professional_id INTEGER REFERENCES professionals(id)");
    }
    if (!uCols.includes('clinic_id')) {
      db.exec("ALTER TABLE users ADD COLUMN clinic_id INTEGER REFERENCES clinics(id)");
    }
  }

  const transfersInfo = db.prepare("PRAGMA table_info(transfers)").all() as any[];
  const tCols = transfersInfo.map(c => c.name);
  if (tCols.length > 0) {
    if (!tCols.includes('gross_value')) {
      db.exec("ALTER TABLE transfers ADD COLUMN gross_value REAL");
      db.exec("ALTER TABLE transfers ADD COLUMN glosa_value REAL");
      db.exec("ALTER TABLE transfers ADD COLUMN clinic_tax REAL");
      db.exec("ALTER TABLE transfers ADD COLUMN net_value REAL");
    }
    if (!tCols.includes('updated_by')) {
      db.exec("ALTER TABLE transfers ADD COLUMN updated_by INTEGER REFERENCES users(id)");
    }
  }
};

// Inicialização do Banco de Dados
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

  CREATE TABLE IF NOT EXISTS health_insurances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    default_value REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    health_insurance_id INTEGER,
    procedure_id INTEGER,
    fee_percent REAL DEFAULT 0,
    fixed_fee REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(clinic_id) REFERENCES clinics(id),
    FOREIGN KEY(health_insurance_id) REFERENCES health_insurances(id),
    FOREIGN KEY(procedure_id) REFERENCES procedures(id)
  );

  CREATE TABLE IF NOT EXISTS professional_clinics (
    professional_id INTEGER,
    clinic_id INTEGER,
    PRIMARY KEY (professional_id, clinic_id),
    FOREIGN KEY(professional_id) REFERENCES professionals(id),
    FOREIGN KEY(clinic_id) REFERENCES clinics(id)
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
    FOREIGN KEY(professional_id) REFERENCES professionals(id),
    FOREIGN KEY(health_insurance_id) REFERENCES health_insurances(id),
    FOREIGN KEY(procedure_id) REFERENCES procedures(id),
    FOREIGN KEY(transfer_id) REFERENCES transfers(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS glosas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_id INTEGER UNIQUE,
    reason TEXT,
    value REAL,
    status TEXT DEFAULT 'EM_RECURSO', -- EM_RECURSO, DEFINITIVO, REVERTIDA
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER,
    FOREIGN KEY(production_id) REFERENCES productions(id),
    FOREIGN KEY(updated_by) REFERENCES users(id)
  );

  -- Tabelas Analíticas (Summary Tables)
  CREATE TABLE IF NOT EXISTS summary_monthly_professional (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    professional_id INTEGER NOT NULL,
    clinic_id INTEGER NOT NULL,
    total_gross REAL DEFAULT 0,
    total_glosa REAL DEFAULT 0,
    total_received REAL DEFAULT 0,
    total_pending REAL DEFAULT 0,
    total_transfer REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month, professional_id, clinic_id)
  );

  CREATE TABLE IF NOT EXISTS summary_monthly_clinic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    clinic_id INTEGER NOT NULL,
    total_gross REAL DEFAULT 0,
    total_glosa REAL DEFAULT 0,
    total_received REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month, clinic_id)
  );

  CREATE TABLE IF NOT EXISTS summary_monthly_insurance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    insurance_id INTEGER NOT NULL,
    clinic_id INTEGER NOT NULL,
    total_gross REAL DEFAULT 0,
    total_glosa REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month, insurance_id, clinic_id)
  );

  CREATE TABLE IF NOT EXISTS analytics_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    professional_id INTEGER,
    clinic_id INTEGER,
    gross_value REAL,
    glosa_value REAL,
    clinic_tax REAL, -- Valor em R$ da taxa
    net_value REAL,  -- Valor final para o médico
    status TEXT DEFAULT 'PENDENTE', -- PENDENTE, APROVADO, PAGO
    period_start TEXT,
    period_end TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER,
    FOREIGN KEY(professional_id) REFERENCES professionals(id),
    FOREIGN KEY(clinic_id) REFERENCES clinics(id),
    FOREIGN KEY(updated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'ADMIN', -- MEDICO, GESTOR, ADMIN, BPO, CLINICA
    professional_id INTEGER,
    clinic_id INTEGER,
    FOREIGN KEY(professional_id) REFERENCES professionals(id),
    FOREIGN KEY(clinic_id) REFERENCES clinics(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL, -- CREATE, UPDATE, DELETE, LOGIN
    table_name TEXT,
    record_id INTEGER,
    old_data TEXT, -- JSON
    new_data TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Função de Consolidação Analítica
const consolidateAnalytics = () => {
  console.log("[Analytics] Iniciando consolidação de dados...");
  const start = Date.now();

  try {
    const transaction = db.transaction(() => {
      // 1. Resumo Mensal por Profissional
      db.prepare(`
        INSERT INTO summary_monthly_professional (year, month, professional_id, clinic_id, total_gross, total_glosa, total_received, total_pending, total_transfer, updated_at)
        SELECT 
          strftime('%Y', p.date) as year,
          strftime('%m', p.date) as month,
          p.professional_id,
          p.clinic_id,
          SUM(p.value) as total_gross,
          SUM(CASE WHEN p.payment_status = 'GLOSADO' THEN g.value ELSE 0 END) as total_glosa,
          SUM(CASE WHEN p.payment_status = 'RECEBIDO' THEN p.value ELSE 0 END) as total_received,
          SUM(CASE WHEN p.payment_status = 'EM_ABERTO' THEN p.value ELSE 0 END) as total_pending,
          (SELECT COALESCE(SUM(net_value), 0) FROM transfers t WHERE t.professional_id = p.professional_id AND t.clinic_id = p.clinic_id AND strftime('%Y', t.created_at) = strftime('%Y', p.date) AND strftime('%m', t.created_at) = strftime('%m', p.date)) as total_transfer,
          CURRENT_TIMESTAMP
        FROM productions p
        LEFT JOIN glosas g ON p.id = g.production_id
        GROUP BY year, month, p.professional_id, p.clinic_id
        ON CONFLICT(year, month, professional_id, clinic_id) DO UPDATE SET
          total_gross = excluded.total_gross,
          total_glosa = excluded.total_glosa,
          total_received = excluded.total_received,
          total_pending = excluded.total_pending,
          total_transfer = excluded.total_transfer,
          updated_at = CURRENT_TIMESTAMP
      `).run();

      // 2. Resumo Mensal por Clínica
      db.prepare(`
        INSERT INTO summary_monthly_clinic (year, month, clinic_id, total_gross, total_glosa, total_received, updated_at)
        SELECT 
          strftime('%Y', p.date) as year,
          strftime('%m', p.date) as month,
          p.clinic_id,
          SUM(p.value) as total_gross,
          SUM(CASE WHEN p.payment_status = 'GLOSADO' THEN g.value ELSE 0 END) as total_glosa,
          SUM(CASE WHEN p.payment_status = 'RECEBIDO' THEN p.value ELSE 0 END) as total_received,
          CURRENT_TIMESTAMP
        FROM productions p
        LEFT JOIN glosas g ON p.id = g.production_id
        GROUP BY year, month, p.clinic_id
        ON CONFLICT(year, month, clinic_id) DO UPDATE SET
          total_gross = excluded.total_gross,
          total_glosa = excluded.total_glosa,
          total_received = excluded.total_received,
          updated_at = CURRENT_TIMESTAMP
      `).run();

      // 3. Resumo Mensal por Convênio
      db.prepare(`
        INSERT INTO summary_monthly_insurance (year, month, insurance_id, clinic_id, total_gross, total_glosa, updated_at)
        SELECT 
          strftime('%Y', p.date) as year,
          strftime('%m', p.date) as month,
          p.health_insurance_id,
          p.clinic_id,
          SUM(p.value) as total_gross,
          SUM(CASE WHEN p.payment_status = 'GLOSADO' THEN g.value ELSE 0 END) as total_glosa,
          CURRENT_TIMESTAMP
        FROM productions p
        LEFT JOIN glosas g ON p.id = g.production_id
        GROUP BY year, month, p.health_insurance_id, p.clinic_id
        ON CONFLICT(year, month, insurance_id, clinic_id) DO UPDATE SET
          total_gross = excluded.total_gross,
          total_glosa = excluded.total_glosa,
          updated_at = CURRENT_TIMESTAMP
      `).run();

      db.prepare("INSERT OR REPLACE INTO analytics_metadata (key, value) VALUES ('last_sync', ?)").run(new Date().toISOString());
    });
    transaction();
    console.log(`[Analytics] Consolidação concluída em ${Date.now() - start}ms`);
  } catch (err) {
    console.error("[Analytics] Erro na consolidação:", err);
  }
};

// Rodar consolidação inicial e agendar
consolidateAnalytics();
setInterval(consolidateAnalytics, 5 * 60 * 1000); // A cada 5 minutos

ensureColumns();

// Limpeza de dados: Garantir que não existam valores nulos que possam quebrar o frontend
db.exec("UPDATE productions SET value = 0 WHERE value IS NULL");
db.exec("UPDATE productions SET date = date('now') WHERE date IS NULL");
db.exec("UPDATE productions SET patient_name = 'Paciente não informado' WHERE patient_name IS NULL");
db.exec("UPDATE productions SET payment_status = 'EM_ABERTO' WHERE payment_status IS NULL");

// Seed inicial expandido
const clinicCount = db.prepare("SELECT count(*) as count FROM clinics").get() as { count: number };
if (clinicCount.count === 0) {
  db.prepare("INSERT INTO clinics (name, cnpj) VALUES (?, ?)").run("Clínica Santa Helena", "12.345.678/0001-90");
  db.prepare("INSERT INTO professionals (name, crm, email) VALUES (?, ?, ?)").run("Dr. Lucas Ferreira", "CRM/SP 123456", "luufe28@gmail.com");
  db.prepare("INSERT INTO professional_clinics (professional_id, clinic_id) VALUES (1, 1)").run();
  
  db.prepare("INSERT INTO health_insurances (name) VALUES (?)").run("Unimed");
  db.prepare("INSERT INTO health_insurances (name) VALUES (?)").run("Bradesco Saúde");
  
  db.prepare("INSERT INTO procedures (name, code) VALUES (?, ?)").run("Consulta Eletiva", "10101012");
  db.prepare("INSERT INTO procedures (name, code) VALUES (?, ?)").run("Eletrocardiograma", "40101010");

  // Adicionar algumas produções de exemplo
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO productions (clinic_id, professional_id, health_insurance_id, procedure_id, patient_name, value, date, payment_status)
    VALUES (1, 1, 1, 1, 'Maria Silva', 250.00, ?, 'RECEBIDO')
  `).run(today);
  
  db.prepare(`
    INSERT INTO productions (clinic_id, professional_id, health_insurance_id, procedure_id, patient_name, value, date, payment_status)
    VALUES (1, 1, 2, 2, 'João Pereira', 1200.00, ?, 'GLOSADO')
  `).run(today);

  db.prepare(`
    INSERT INTO glosas (production_id, value, reason, status)
    VALUES (2, 1200.00, 'Guia sem assinatura do paciente', 'EM_RECURSO')
  `).run();

  // Adicionar regra de taxa padrão para testes
  db.prepare("INSERT INTO rules (clinic_id, fee_percent, fixed_fee) VALUES (1, 30.0, 5.0)").run();
  
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (1, 'CREATE', 'rules', 1, '{"clinic_id": 1, "fee_percent": 30, "fixed_fee": 5}')
  `).run();
}

// Seed de usuários (independente de outras tabelas)
const userCount = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("admin", "654321", "ADMIN");
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("felipe", "bia1712", "ADMIN");
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("aline", "dudu", "ADMIN");
} else {
  // Garantir que o usuário felipe existe se a tabela não estiver vazia
  const felipeExists = db.prepare("SELECT 1 FROM users WHERE username = ?").get("felipe");
  if (!felipeExists) {
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("felipe", "bia1712", "ADMIN");
  }

  const guilhermeExists = db.prepare("SELECT 1 FROM users WHERE username = ?").get("guilherme");
  if (!guilhermeExists) {
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("guilherme", "Isis", "ADMIN");
  }

  const alineExists = db.prepare("SELECT 1 FROM users WHERE username = ?").get("aline");
  if (!alineExists) {
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("aline", "dudu", "ADMIN");
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[Server] Iniciando startServer na porta ${PORT}...`);
  console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}`);

  // Logger de requisições
  app.use((req, res, next) => {
    console.log(`[Request] ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());

  // Rota de Health Check para diagnóstico
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(), 
      env: process.env.NODE_ENV || 'development',
      cwd: process.cwd(),
      dirname: __dirname
    });
  });

  app.get("/api/debug-403", (req, res) => {
    res.send("Se você está vendo isso, o servidor está respondendo a rotas API.");
  });

  // Helper para Auditoria
  const logAction = (userId: number | null, action: string, tableName: string, recordId: number | null, oldData: any = null, newData: any = null) => {
    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId, 
        action, 
        tableName, 
        recordId, 
        oldData ? JSON.stringify(oldData) : null, 
        newData ? JSON.stringify(newData) : null
      );
    } catch (e) {
      console.error("Erro ao registrar auditoria:", e);
    }
  };

  // API: Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT id, username, role FROM users WHERE username = ? AND password = ?")
      .get(username, password) as any;

    if (user) {
      logAction(user.id, "LOGIN", "users", user.id);
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username, role: user.role },
        token: `mock-token-${user.id}-${Date.now()}`
      });
    } else {
      res.status(401).json({ success: false, error: "Usuário ou senha inválidos" });
    }
  });

  // APIs de Cadastro Mestre (CRUD)
  
  // Clinics
  app.get("/api/clinics", (req, res) => res.json(db.prepare("SELECT * FROM clinics").all()));
  app.post("/api/clinics", (req, res) => {
    const { name, cnpj, tax_rules, userId } = req.body;
    const result = db.prepare("INSERT INTO clinics (name, cnpj, tax_rules) VALUES (?, ?, ?)").run(name, cnpj, tax_rules);
    logAction(userId, "CREATE", "clinics", Number(result.lastInsertRowid), null, { name, cnpj, tax_rules });
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Professionals
  app.get("/api/professionals", (req, res) => res.json(db.prepare("SELECT * FROM professionals").all()));
  app.post("/api/professionals", (req, res) => {
    const { name, crm, email, role, userId } = req.body;
    const result = db.prepare("INSERT INTO professionals (name, crm, email, role) VALUES (?, ?, ?, ?)").run(name, crm, email, role);
    logAction(userId, "CREATE", "professionals", Number(result.lastInsertRowid), null, { name, crm, email, role });
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Health Insurances
  app.get("/api/health-insurances", (req, res) => res.json(db.prepare("SELECT * FROM health_insurances").all()));
  app.post("/api/health-insurances", (req, res) => {
    const { name, userId } = req.body;
    const result = db.prepare("INSERT INTO health_insurances (name) VALUES (?)").run(name);
    logAction(userId, "CREATE", "health_insurances", Number(result.lastInsertRowid), null, { name });
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Procedures
  app.get("/api/procedures", (req, res) => res.json(db.prepare("SELECT * FROM procedures").all()));
  app.post("/api/procedures", (req, res) => {
    const { name, code, default_value, userId } = req.body;
    const result = db.prepare("INSERT INTO procedures (name, code, default_value) VALUES (?, ?, ?)").run(name, code, default_value);
    logAction(userId, "CREATE", "procedures", Number(result.lastInsertRowid), null, { name, code, default_value });
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Rules
  app.get("/api/rules", (req, res) => {
    res.json(db.prepare(`
      SELECT r.*, c.name as clinic_name, hi.name as insurance_name, p.name as procedure_name
      FROM rules r
      LEFT JOIN clinics c ON r.clinic_id = c.id
      LEFT JOIN health_insurances hi ON r.health_insurance_id = hi.id
      LEFT JOIN procedures p ON r.procedure_id = p.id
    `).all());
  });
  app.post("/api/rules", (req, res) => {
    const { clinic_id, health_insurance_id, procedure_id, fee_percent, fixed_fee, userId } = req.body;
    const result = db.prepare(`
      INSERT INTO rules (clinic_id, health_insurance_id, procedure_id, fee_percent, fixed_fee)
      VALUES (?, ?, ?, ?, ?)
    `).run(clinic_id, health_insurance_id, procedure_id, fee_percent, fixed_fee);
    logAction(userId, "CREATE", "rules", Number(result.lastInsertRowid), null, req.body);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Audit Logs
  app.get("/api/audit-logs", (req, res) => {
    res.json(db.prepare(`
      SELECT a.*, u.username
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all());
  });

  // DELETE endpoints for Master Data
  app.delete("/api/clinics/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT * FROM clinics WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM clinics WHERE id = ?").run(id);
      logAction(userId, "DELETE", "clinics", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Clinic not found" });
    }
  });

  app.delete("/api/professionals/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT * FROM professionals WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM professionals WHERE id = ?").run(id);
      logAction(userId, "DELETE", "professionals", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Professional not found" });
    }
  });

  app.delete("/api/health-insurances/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT * FROM health_insurances WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM health_insurances WHERE id = ?").run(id);
      logAction(userId, "DELETE", "health_insurances", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Insurance not found" });
    }
  });

  app.delete("/api/procedures/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT * FROM procedures WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM procedures WHERE id = ?").run(id);
      logAction(userId, "DELETE", "procedures", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Procedure not found" });
    }
  });

  app.delete("/api/rules/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM rules WHERE id = ?").run(id);
      logAction(userId, "DELETE", "rules", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Rule not found" });
    }
  });

  // User Management
  app.get("/api/users", (req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.username, u.role, u.professional_id, u.clinic_id,
             p.name as professional_name, c.name as clinic_name
      FROM users u
      LEFT JOIN professionals p ON u.professional_id = p.id
      LEFT JOIN clinics c ON u.clinic_id = c.id
    `).all());
  });

  app.post("/api/users", (req, res) => {
    const { username, password, role, professional_id, clinic_id, userId } = req.body;
    try {
      const result = db.prepare(`
        INSERT INTO users (username, password, role, professional_id, clinic_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(username, password, role, professional_id, clinic_id);
      logAction(userId, "CREATE", "users", Number(result.lastInsertRowid), null, { username, role });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const oldData = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
    if (oldData) {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      logAction(userId, "DELETE", "users", Number(id), oldData, null);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  // API: Salvar Lote de Produção (com regras automáticas)
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
        const clinicId = p.clinic_id ? Number(p.clinic_id) : null;
        const profId = p.professional_id ? Number(p.professional_id) : null;
        const insuranceId = p.health_insurance_id ? Number(p.health_insurance_id) : null;
        const procId = p.procedure_id ? Number(p.procedure_id) : null;
        const val = p.value ? Number(p.value) : 0;

        if (!clinicId || !profId || !insuranceId || !procId) {
          throw new Error("Campos obrigatórios ausentes.");
        }

        // Buscar Regra Automática
        const rule = db.prepare(`
          SELECT * FROM rules 
          WHERE clinic_id = ? 
          AND (health_insurance_id = ? OR health_insurance_id IS NULL)
          AND (procedure_id = ? OR procedure_id IS NULL)
          ORDER BY procedure_id DESC, health_insurance_id DESC
          LIMIT 1
        `).get(clinicId, insuranceId, procId) as any;

        let feeValue = 0;
        if (rule) {
          feeValue = (val * (rule.fee_percent / 100)) + (rule.fixed_fee || 0);
        }
        const netValue = val - feeValue;

        const result = insert.run(
          clinicId, profId, insuranceId, procId,
          p.patient_name || "Paciente não informado", val, feeValue, netValue, 
          p.date || new Date().toISOString().split('T')[0], userId
        );
        
        logAction(userId, "CREATE", "productions", Number(result.lastInsertRowid), null, { ...p, feeValue, netValue });
      }
    });

    try {
      transaction(productions);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // API: Listar Produções para Gestão de Glosas (com filtros)
  app.get("/api/productions/glosas-list", (req, res) => {
    const { clinic_id, insurance_id, professional_id, status } = req.query;
    let query = `
      SELECT 
        p.*, 
        pr.name as professional_name, 
        c.name as clinic_name, 
        hi.name as insurance_name,
        proc.name as procedure_name,
        g.reason as glosa_reason,
        g.value as glosa_value,
        g.status as glosa_status
      FROM productions p
      JOIN professionals pr ON p.professional_id = pr.id
      JOIN clinics c ON p.clinic_id = c.id
      JOIN health_insurances hi ON p.health_insurance_id = hi.id
      JOIN procedures proc ON p.procedure_id = proc.id
      LEFT JOIN glosas g ON p.id = g.production_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (clinic_id) { query += " AND p.clinic_id = ?"; params.push(clinic_id); }
    if (insurance_id) { query += " AND p.health_insurance_id = ?"; params.push(insurance_id); }
    if (professional_id) { query += " AND p.professional_id = ?"; params.push(professional_id); }
    if (status) { query += " AND p.payment_status = ?"; params.push(status); }

    query += " ORDER BY p.date DESC";
    res.json(db.prepare(query).all(...params));
  });

  // API: Resumo de Glosas
  app.get("/api/glosas/summary", (req, res) => {
    const { clinic_id, insurance_id, professional_id, start_date, end_date } = req.query;
    let whereClause = "WHERE 1=1";
    const params: any[] = [];

    if (clinic_id) { whereClause += " AND p.clinic_id = ?"; params.push(clinic_id); }
    if (insurance_id) { whereClause += " AND p.health_insurance_id = ?"; params.push(insurance_id); }
    if (professional_id) { whereClause += " AND p.professional_id = ?"; params.push(professional_id); }
    if (start_date) { whereClause += " AND p.date >= ?"; params.push(start_date); }
    if (end_date) { whereClause += " AND p.date <= ?"; params.push(end_date); }

    const summary = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN g.status != 'REVERTIDA' THEN g.value ELSE 0 END), 0) as total_glosado,
        COALESCE(SUM(CASE WHEN g.status = 'EM_RECURSO' THEN g.value ELSE 0 END), 0) as total_em_recurso,
        COALESCE(SUM(CASE WHEN g.status = 'DEFINITIVO' THEN g.value ELSE 0 END), 0) as total_definitivo,
        COALESCE(SUM(CASE WHEN g.status = 'REVERTIDA' THEN g.value ELSE 0 END), 0) as total_revertido
      FROM glosas g
      JOIN productions p ON g.production_id = p.id
      ${whereClause}
    `).get(...params);
    res.json(summary);
  });

  // API: Registrar/Editar Glosa
  app.post("/api/productions/:id/glosa", (req, res) => {
    const { id } = req.params;
    const { value, reason, status } = req.body;

    const transaction = db.transaction(() => {
      // Atualiza status da produção
      db.prepare("UPDATE productions SET payment_status = 'GLOSADO' WHERE id = ?").run(id);
      
      // Upsert na tabela de glosas
      const existing = db.prepare("SELECT id FROM glosas WHERE production_id = ?").get(id);
      if (existing) {
        db.prepare("UPDATE glosas SET value = ?, reason = ?, status = ? WHERE production_id = ?")
          .run(value, reason, status, id);
      } else {
        db.prepare("INSERT INTO glosas (production_id, value, reason, status) VALUES (?, ?, ?, ?)")
          .run(id, value, reason, status);
      }
    });

    try {
      transaction();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // API: Reverter Glosa (Voltar para Recebido)
  app.post("/api/productions/:id/revert-glosa", (req, res) => {
    const { id } = req.params;
    const transaction = db.transaction(() => {
      db.prepare("UPDATE productions SET payment_status = 'RECEBIDO' WHERE id = ?").run(id);
      db.prepare("UPDATE glosas SET status = 'REVERTIDA', value = 0 WHERE production_id = ?").run(id);
    });

    try {
      transaction();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // API: Listar Produções Elegíveis para Repasse
  app.get("/api/transfers/eligible-productions", (req, res) => {
    const { professional_id, clinic_id, start_date, end_date } = req.query;
    const data = db.prepare(`
      SELECT p.*, proc.name as procedure_name, hi.name as insurance_name
      FROM productions p
      JOIN procedures proc ON p.procedure_id = proc.id
      JOIN health_insurances hi ON p.health_insurance_id = hi.id
      WHERE p.professional_id = ? 
        AND p.clinic_id = ? 
        AND p.payment_status = 'RECEBIDO' 
        AND p.transfer_id IS NULL
        AND p.date >= ? AND p.date <= ?
    `).all(professional_id, clinic_id, start_date, end_date);
    res.json(data);
  });

  // API: Gerar Lote de Repasse
  app.post("/api/transfers/generate", (req, res) => {
    const { professional_id, clinic_id, period_start, period_end, production_ids, clinic_tax_percent } = req.body;
    
    const transaction = db.transaction(() => {
      // Calcula valores do lote
      const prods = db.prepare(`
        SELECT COALESCE(SUM(value), 0) as gross FROM productions WHERE id IN (${production_ids.join(',')})
      `).get() as { gross: number };

      const gross = prods.gross || 0;
      const tax_value = gross * (clinic_tax_percent / 100);
      const net = gross - tax_value;

      // Insere o lote
      const result = db.prepare(`
        INSERT INTO transfers (professional_id, clinic_id, gross_value, glosa_value, clinic_tax, net_value, period_start, period_end, status)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'PENDENTE')
      `).run(professional_id, clinic_id, gross, tax_value, net, period_start, period_end);

      const transferId = result.lastInsertRowid;

      // Vincula produções ao lote
      db.prepare(`UPDATE productions SET transfer_id = ? WHERE id IN (${production_ids.join(',')})`).run(transferId);
      
      return transferId;
    });

    try {
      const id = transaction();
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // API: Listar Lotes de Repasse
  app.get("/api/transfers", (req, res) => {
    const { clinic_id, professional_id, status } = req.query;
    let query = `
      SELECT t.*, p.name as professional_name, c.name as clinic_name
      FROM transfers t
      JOIN professionals p ON t.professional_id = p.id
      JOIN clinics c ON t.clinic_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (clinic_id) { query += " AND t.clinic_id = ?"; params.push(clinic_id); }
    if (professional_id) { query += " AND t.professional_id = ?"; params.push(professional_id); }
    if (status) { query += " AND t.status = ?"; params.push(status); }

    query += " ORDER BY t.created_at DESC";
    res.json(db.prepare(query).all(...params));
  });

  // API: Atualizar Status do Lote
  app.patch("/api/transfers/:id/status", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  });

  // API: Dashboard do Gestor (Cards) - OTIMIZADO
  app.get("/api/manager/stats", (req, res) => {
    const { clinic_id, professional_id, insurance_id, start_date, end_date } = req.query;
    
    // Se houver filtros de data específicos (não apenas mês/ano), ainda usamos a query bruta para precisão no MVP
    // Mas se for visão geral, usamos o resumo.
    // Para este protótipo, vamos migrar para a tabela de resumo mensal se start_date/end_date não forem informados.
    
    if (!start_date && !end_date) {
      let query = `
        SELECT 
          SUM(total_gross) as gross_billing,
          SUM(total_glosa) as total_glosas,
          SUM(total_received) as total_received,
          SUM(total_pending) as total_pending,
          SUM(total_transfer) as transfers_to_pay
        FROM summary_monthly_professional
        WHERE 1=1
      `;
      const params: any[] = [];
      if (clinic_id) { query += " AND clinic_id = ?"; params.push(clinic_id); }
      if (professional_id) { query += " AND professional_id = ?"; params.push(professional_id); }
      
      const stats = db.prepare(query).get(...params) as any;
      const gross = stats.gross_billing || 0;
      const glosas = stats.total_glosas || 0;
      
      return res.json({
        gross_billing: gross,
        total_glosas: glosas,
        glosa_rate: gross > 0 ? (glosas / gross) * 100 : 0,
        net_estimated: gross - glosas,
        transfers_to_pay: stats.transfers_to_pay || 0,
        projected_cash: (stats.total_received || 0) - (stats.transfers_to_pay || 0)
      });
    }

    // Fallback para query bruta se houver filtros de data customizados
    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    if (clinic_id) { whereClause += " AND p.clinic_id = ?"; params.push(clinic_id); }
    if (professional_id) { whereClause += " AND p.professional_id = ?"; params.push(professional_id); }
    if (insurance_id) { whereClause += " AND p.health_insurance_id = ?"; params.push(insurance_id); }
    if (start_date) { whereClause += " AND p.date >= ?"; params.push(start_date); }
    if (end_date) { whereClause += " AND p.date <= ?"; params.push(end_date); }

    const subquery_params: any[] = [];
    if (professional_id) subquery_params.push(professional_id);
    if (clinic_id) subquery_params.push(clinic_id);

    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(p.value), 0) as gross_billing,
        COALESCE(SUM(CASE WHEN p.payment_status = 'GLOSADO' THEN g.value ELSE 0 END), 0) as total_glosas,
        COALESCE(SUM(CASE WHEN p.payment_status = 'RECEBIDO' THEN p.value ELSE 0 END), 0) as total_received,
        COALESCE(SUM(CASE WHEN p.payment_status = 'EM_ABERTO' THEN p.value ELSE 0 END), 0) as total_pending,
        COALESCE((SELECT SUM(net_value) FROM transfers WHERE status = 'PENDENTE' ${professional_id ? 'AND professional_id = ?' : ''} ${clinic_id ? 'AND clinic_id = ?' : ''}), 0) as transfers_to_pay
      FROM productions p
      LEFT JOIN glosas g ON p.id = g.production_id
      ${whereClause}
    `).get(...subquery_params, ...params) as any;

    const gross = stats.gross_billing || 0;
    const glosas = stats.total_glosas || 0;
    res.json({
      gross_billing: gross,
      total_glosas: glosas,
      glosa_rate: gross > 0 ? (glosas / gross) * 100 : 0,
      net_estimated: gross - glosas,
      transfers_to_pay: stats.transfers_to_pay || 0,
      projected_cash: stats.total_received - (stats.transfers_to_pay || 0)
    });
  });

  // API: Faturamento por Convênio - OTIMIZADO
  app.get("/api/manager/billing-by-insurance", (req, res) => {
    const { clinic_id, professional_id } = req.query;
    
    let query = `
      SELECT 
        hi.name as insurance_name,
        SUM(s.total_gross) as gross_billing,
        SUM(s.total_glosa) as total_glosas
      FROM summary_monthly_insurance s
      JOIN health_insurances hi ON s.insurance_id = hi.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (clinic_id) { query += " AND s.clinic_id = ?"; params.push(clinic_id); }
    // Nota: summary_monthly_insurance não tem professional_id no grão atual para simplificar
    // Se precisar por profissional, usaríamos summary_monthly_professional e JOIN com productions (ou expandir o grão)
    
    query += " GROUP BY hi.id";
    res.json(db.prepare(query).all(...params));
  });

  // API: Tendência Mensal - OTIMIZADO
  app.get("/api/manager/monthly-trends", (req, res) => {
    const { clinic_id, professional_id } = req.query;
    
    let query = `
      SELECT 
        month || '/' || year as month_year,
        SUM(total_gross) as faturamento,
        SUM(total_glosa) as glosas
      FROM summary_monthly_professional
      WHERE 1=1
    `;
    const params: any[] = [];
    if (clinic_id) { query += " AND clinic_id = ?"; params.push(clinic_id); }
    if (professional_id) { query += " AND professional_id = ?"; params.push(professional_id); }

    query += " GROUP BY year, month ORDER BY year ASC, month ASC LIMIT 12";
    const data = db.prepare(query).all(...params);

    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const formatted = data.map((d: any) => {
      const [m, y] = d.month_year.split('/');
      return {
        name: months[parseInt(m) - 1],
        faturamento: d.faturamento,
        glosas: d.glosas
      };
    });

    res.json(formatted);
  });

  // API: Metadata de Sincronização
  app.get("/api/analytics/status", (req, res) => {
    const lastSync = db.prepare("SELECT value FROM analytics_metadata WHERE key = 'last_sync'").get() as any;
    res.json({ last_sync: lastSync?.value || null });
  });

  // API: Forçar Sincronização
  app.post("/api/analytics/sync", (req, res) => {
    consolidateAnalytics();
    res.json({ success: true });
  });

  // API: Distribuição de Status de Glosas
  app.get("/api/manager/glosa-status-distribution", (req, res) => {
    const { clinic_id, professional_id, insurance_id, start_date, end_date } = req.query;
    let whereClause = "WHERE 1=1";
    const params: any[] = [];

    if (clinic_id) { whereClause += " AND p.clinic_id = ?"; params.push(clinic_id); }
    if (professional_id) { whereClause += " AND p.professional_id = ?"; params.push(professional_id); }
    if (insurance_id) { whereClause += " AND p.health_insurance_id = ?"; params.push(insurance_id); }
    if (start_date) { whereClause += " AND p.date >= ?"; params.push(start_date); }
    if (end_date) { whereClause += " AND p.date <= ?"; params.push(end_date); }

    const data = db.prepare(`
      SELECT 
        g.status,
        COALESCE(SUM(g.value), 0) as value
      FROM glosas g
      JOIN productions p ON g.production_id = p.id
      ${whereClause}
      GROUP BY g.status
    `).all(...params);

    const statusMap: any = {
      'EM_RECURSO': { name: 'Em Recurso', color: '#f59e0b' },
      'REVERTIDA': { name: 'Recuperado', color: '#10b981' },
      'DEFINITIVO': { name: 'Perdido', color: '#ef4444' }
    };

    const formatted = data.map((d: any) => ({
      name: statusMap[d.status]?.name || d.status,
      value: d.value,
      color: statusMap[d.status]?.color || '#94a3b8'
    }));

    res.json(formatted);
  });

  // API: Listar Produções
  app.get("/api/productions", (req, res) => {
    const prods = db.prepare(`
      SELECT p.*, pr.name as professional_name 
      FROM productions p
      JOIN professionals pr ON p.professional_id = pr.id
      ORDER BY date DESC
    `).all();
    res.json(prods);
  });

  // Vite middleware para desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Iniciando em modo DESENVOLVIMENTO (Vite Middleware)");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Iniciando em modo PRODUÇÃO (Static Files)");
    const distPath = path.resolve(__dirname, "dist");
    console.log(`[Server] Servindo arquivos estáticos de: ${distPath}`);
    
    app.use(express.static(distPath));
    
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      console.log(`[Server] Servindo index.html de: ${indexPath}`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`[Server] Erro ao enviar index.html: ${err.message}`);
          res.status(500).send("Erro interno ao carregar a página.");
        }
      });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Fluxo Saúde rodando em http://localhost:${PORT}`);
  });
}

startServer();
