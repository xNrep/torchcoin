const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL) console.warn("DATABASE_URL manquant.");
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn("JWT_SECRET doit être une chaîne aléatoire d'au moins 32 caractères.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(12).toString("hex");
}

function signToken(user) {
  return jwt.sign({ sub:user.id, username:user.username }, JWT_SECRET, { expiresIn:"30d" });
}

function auth(req,res,next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({error:"missing_token"});
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({error:"invalid_token"});
  }
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS transactions_user_idx
      ON transactions(user_id, created_at DESC);
  `);
}

app.get("/health", (_req,res) => res.json({ok:true,service:"torchcoin-api"}));

app.post("/v1/auth/register", async (req,res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username))
      return res.status(400).json({error:"invalid_username"});
    if (password.length < 8)
      return res.status(400).json({error:"password_too_short"});

    const exists = await pool.query("SELECT 1 FROM users WHERE LOWER(username)=LOWER($1)",[username]);
    if (exists.rowCount) return res.status(409).json({error:"username_taken"});

    const hash = await bcrypt.hash(password, 12);
    const id = newId("usr");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users(id,username,password_hash,balance) VALUES($1,$2,$3,100)",
        [id,username,hash]
      );
      await client.query(
        "INSERT INTO transactions(id,user_id,type,amount,balance_after,description) VALUES($1,$2,$3,$4,$5,$6)",
        [newId("tx"),id,"initial",100,100,"Initial TorchCoin balance"]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally { client.release(); }

    const token = signToken({id,username});
    res.json({ok:true,id,username,balance:100,token});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"server_error"});
  }
});

app.post("/v1/auth/login", async (req,res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const r = await pool.query("SELECT * FROM users WHERE LOWER(username)=LOWER($1)",[username]);
    if (!r.rowCount) return res.status(401).json({error:"invalid_credentials"});
    const user = r.rows[0];
    const ok = await bcrypt.compare(password,user.password_hash);
    if (!ok) return res.status(401).json({error:"invalid_credentials"});
    const token = signToken(user);
    res.json({ok:true,id:user.id,username:user.username,balance:user.balance,token});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"server_error"});
  }
});

app.get("/v1/me", auth, async (req,res) => {
  const r = await pool.query(
    "SELECT id,username,balance,created_at FROM users WHERE id=$1",[req.user.sub]
  );
  if (!r.rowCount) return res.status(404).json({error:"user_not_found"});
  res.json(r.rows[0]);
});

app.get("/v1/wallet", auth, async (req,res) => {
  const r = await pool.query("SELECT balance FROM users WHERE id=$1",[req.user.sub]);
  if (!r.rowCount) return res.status(404).json({error:"user_not_found"});
  res.json({balance:r.rows[0].balance});
});

app.get("/v1/transactions", auth, async (req,res) => {
  const r = await pool.query(
    `SELECT id,type,amount,balance_after,description,created_at
     FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.user.sub]
  );
  res.json(r.rows);
});

app.get("/v1/transactions/:id", auth, async (req,res) => {
  const r = await pool.query(
    `SELECT id,type,amount,balance_after,description,created_at
     FROM transactions WHERE id=$1 AND user_id=$2`,
    [req.params.id,req.user.sub]
  );
  if (!r.rowCount) return res.status(404).json({error:"transaction_not_found"});
  res.json(r.rows[0]);
});

init()
  .then(() => app.listen(PORT, () => console.log("TorchCoin API listening on "+PORT)))
  .catch(e => { console.error(e); process.exit(1); });
