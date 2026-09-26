/*
 TorchCoin Server v1
 Node.js + Express + SQLite
 Fictional in-app currency. No real-world monetary value.

 Run:
   npm install
   npm start

 Environment:
   PORT=8787
   JWT_SECRET=replace-me-with-a-long-random-secret
   INITIAL_BALANCE=100
*/

const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";
const INITIAL_BALANCE = Number(process.env.INITIAL_BALANCE || 100);

if (JWT_SECRET === "CHANGE_ME_IN_PRODUCTION") {
  console.warn("WARNING: Set JWT_SECRET before public deployment.");
}

const db = new Database("torchcoin.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL CHECK(balance >= 0),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS project_permissions (
  project_id TEXT PRIMARY KEY,
  read_balance INTEGER NOT NULL DEFAULT 1,
  purchase INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  item_id TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  confirmation_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`);

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(12).toString("hex");
}
function hash(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function now() { return new Date().toISOString(); }
function requireUser(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({error:"User authentication required"});
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.userId);
    if (!u) return res.status(401).json({error:"Invalid user"});
    req.userRow = u;
    next();
  } catch { res.status(401).json({error:"Invalid user token"}); }
}
function requireProject(req, res, next) {
  const raw = req.headers["x-project-token"];
  if (!raw) return res.status(401).json({error:"Project token required"});
  const p = db.prepare("SELECT * FROM projects WHERE token_hash=? AND active=1").get(hash(raw));
  if (!p) return res.status(401).json({error:"Invalid project token"});
  req.project = p;
  next();
}
function requireBoth(req,res,next) {
  requireUser(req,res,()=>requireProject(req,res,next));
}

app.get("/health", (req,res)=>res.json({ok:true, service:"TorchCoin", version:"1.0.0"}));

app.post("/v1/dev/create-user", (req,res)=>{
  // Development/demo endpoint. Disable or remove before public deployment.
  const username = String(req.body.username || "").trim();
  if (!username || username.length > 32) return res.status(400).json({error:"Invalid username"});
  try {
    const uid = id("usr");
    db.prepare("INSERT INTO users(id,username,balance,created_at) VALUES(?,?,?,?)")
      .run(uid, username, INITIAL_BALANCE, now());
    const token = jwt.sign({userId:uid}, JWT_SECRET, {expiresIn:"30d"});
    res.json({userId:uid, username, balance:INITIAL_BALANCE, token});
  } catch(e) {
    res.status(409).json({error:"Username already exists"});
  }
});

app.post("/v1/dev/create-project", (req,res)=>{
  // Development/demo endpoint. In production, project creation must require account auth.
  const name = String(req.body.name || "").trim();
  const ownerUserId = String(req.body.ownerUserId || "").trim();
  if (!name || !ownerUserId) return res.status(400).json({error:"name and ownerUserId required"});
  const user = db.prepare("SELECT id FROM users WHERE id=?").get(ownerUserId);
  if (!user) return res.status(404).json({error:"Owner not found"});
  const pid = id("prj");
  const token = "pt_" + crypto.randomBytes(24).toString("base64url");
  const tx = db.transaction(()=>{
    db.prepare("INSERT INTO projects(id,name,owner_user_id,token_hash) VALUES(?,?,?,?)")
      .run(pid,name,ownerUserId,hash(token));
    db.prepare("INSERT INTO project_permissions(project_id) VALUES(?)").run(pid);
  });
  tx();
  res.json({projectId:pid, projectToken:token});
});

app.post("/v1/dev/create-shop", (req,res)=>{
  const {projectId, name, itemId, itemName, price} = req.body;
  const p = db.prepare("SELECT id FROM projects WHERE id=?").get(projectId);
  if (!p) return res.status(404).json({error:"Project not found"});
  const sid = id("shop");
  db.prepare("INSERT INTO shops(id,project_id,name) VALUES(?,?,?)").run(sid,projectId,String(name||"Shop"));
  if (itemId && itemName) db.prepare("INSERT INTO items(id,shop_id,name,price) VALUES(?,?,?,?)")
    .run(String(itemId),sid,String(itemName),Number(price));
  res.json({shopId:sid});
});

app.get("/v1/me", requireUser, (req,res)=>res.json({
  userId:req.userRow.id, username:req.userRow.username
}));

app.get("/v1/wallet", requireBoth, (req,res)=>{
  const perm = db.prepare("SELECT * FROM project_permissions WHERE project_id=?").get(req.project.id);
  if (!perm || !perm.read_balance) return res.status(403).json({error:"Project cannot read balance"});
  res.json({balance:req.userRow.balance});
});

app.get("/v1/project", requireProject, (req,res)=>res.json({
  projectId:req.project.id, name:req.project.name
}));

app.post("/v1/purchases/intents", requireBoth, (req,res)=>{
  const perm = db.prepare("SELECT * FROM project_permissions WHERE project_id=?").get(req.project.id);
  if (!perm || !perm.purchase) return res.status(403).json({error:"Project cannot make purchases"});

  const shopId = String(req.body.shopId || "");
  const itemId = String(req.body.itemId || "");
  const item = db.prepare(`
    SELECT i.*, s.project_id FROM items i JOIN shops s ON s.id=i.shop_id
    WHERE i.id=? AND i.shop_id=? AND s.project_id=? AND i.active=1 AND s.active=1
  `).get(itemId, shopId, req.project.id);
  if (!item) return res.status(404).json({error:"Item not found"});
  if (req.userRow.balance < item.price) return res.status(400).json({error:"Insufficient TorchCoin"});

  const intentId = id("pi");
  const confirmationToken = crypto.randomBytes(24).toString("base64url");
  const expires = Date.now() + 2 * 60 * 1000;
  db.prepare(`
    INSERT INTO purchase_intents(id,user_id,project_id,item_id,amount,confirmation_hash,status,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?, ?,?)
  `).run(intentId, req.userRow.id, req.project.id, item.id, item.price, hash(confirmationToken), "pending", expires, now());

  res.json({
    intentId, confirmationToken,
    itemId:item.id, itemName:item.name, amount:item.price,
    currentBalance:req.userRow.balance,
    balanceAfter:req.userRow.balance-item.price,
    expiresAt:expires
  });
});

app.post("/v1/purchases/confirm", requireBoth, (req,res)=>{
  const {intentId, confirmationToken} = req.body;
  const intent = db.prepare("SELECT * FROM purchase_intents WHERE id=?").get(String(intentId||""));
  if (!intent || intent.user_id !== req.userRow.id || intent.project_id !== req.project.id)
    return res.status(404).json({error:"Purchase intent not found"});
  if (intent.status !== "pending") return res.status(409).json({error:"Purchase is no longer pending"});
  if (Date.now() > intent.expires_at) {
    db.prepare("UPDATE purchase_intents SET status='expired' WHERE id=?").run(intent.id);
    return res.status(409).json({error:"Purchase confirmation expired"});
  }
  if (hash(String(confirmationToken||"")) !== intent.confirmation_hash)
    return res.status(401).json({error:"Invalid confirmation token"});

  const transactionId = id("tx");
  const tx = db.transaction(()=>{
    const user = db.prepare("SELECT balance FROM users WHERE id=?").get(intent.user_id);
    if (!user || user.balance < intent.amount) throw new Error("Insufficient TorchCoin");
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(intent.amount,intent.user_id);
    db.prepare(`
      INSERT INTO transactions(id,user_id,project_id,type,amount,item_id,description,created_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(transactionId,intent.user_id,intent.project_id,"purchase",-intent.amount,intent.item_id,
      "TorchCoin purchase",now());
    db.prepare("UPDATE purchase_intents SET status='confirmed' WHERE id=?").run(intent.id);
  });
  try { tx(); } catch(e) { return res.status(400).json({error:e.message}); }

  const fresh = db.prepare("SELECT balance FROM users WHERE id=?").get(req.userRow.id);
  res.json({success:true,transactionId,balance:fresh.balance});
});

app.get("/v1/transactions", requireBoth, (req,res)=>{
  const limit = Math.min(Math.max(Number(req.query.limit||50),1),100);
  const rows = db.prepare(`
    SELECT id,project_id,type,amount,item_id,description,created_at
    FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?
  `).all(req.userRow.id,limit);
  res.json({transactions:rows});
});

app.get("/v1/transactions/:id", requireUser, (req,res)=>{
  const row = db.prepare("SELECT * FROM transactions WHERE id=? AND user_id=?")
    .get(req.params.id,req.userRow.id);
  if (!row) return res.status(404).json({error:"Transaction not found"});
  res.json(row);
});

app.listen(PORT,()=>console.log(`TorchCoin API listening on http://localhost:${PORT}`));
