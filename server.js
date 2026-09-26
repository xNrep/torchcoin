const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL) {
    console.error("FATAL: DATABASE_URL is missing.");
    process.exit(1);
}
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error("FATAL: JWT_SECRET is missing or too short.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

async function init() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            username VARCHAR(24) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            balance BIGINT NOT NULL DEFAULT 100 CHECK (balance >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(32) NOT NULL,
            amount BIGINT NOT NULL,
            balance_after BIGINT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS transactions_user_id_idx
        ON transactions(user_id, id DESC);
    `);
    console.log("PostgreSQL initialized.");
}

function auth(req, res, next) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({error:"Missing user token"});

    try {
        req.user = jwt.verify(match[1], JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({error:"Invalid or expired user token"});
    }
}

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({status:"ok", database:"ok"});
    } catch (e) {
        console.error("Health database error:", e.message);
        res.status(503).json({status:"error", database:"unavailable"});
    }
});

app.post("/v1/auth/register", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username))
        return res.status(400).json({error:"Username must be 3-24 characters: letters, numbers, underscore"});
    if (password.length < 8)
        return res.status(400).json({error:"Password must be at least 8 characters"});

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const result = await client.query(
                "INSERT INTO users(username,password_hash,balance) VALUES($1,$2,100) RETURNING id,username,balance,created_at",
                [username, passwordHash]
            );

            const user = result.rows[0];

            await client.query(
                "INSERT INTO transactions(user_id,type,amount,balance_after,description) VALUES($1,$2,$3,$4,$5)",
                [user.id, "initial", 100, 100, "Initial TorchCoin account balance"]
            );

            await client.query("COMMIT");

            const token = jwt.sign({id:String(user.id), username:user.username}, JWT_SECRET, {expiresIn:"30d"});
            res.status(201).json({token, user});
        } catch (e) {
            await client.query("ROLLBACK");
            if (e.code === "23505")
                return res.status(409).json({error:"Username already exists"});
            throw e;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error("Register error:", e);
        res.status(500).json({error:"Server error"});
    }
});

app.post("/v1/auth/login", async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    try {
        const result = await pool.query(
            "SELECT id,username,password_hash,balance,created_at FROM users WHERE username=$1",
            [username]
        );
        if (!result.rows.length)
            return res.status(401).json({error:"Invalid username or password"});

        const user = result.rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok)
            return res.status(401).json({error:"Invalid username or password"});

        const token = jwt.sign({id:String(user.id), username:user.username}, JWT_SECRET, {expiresIn:"30d"});
        delete user.password_hash;
        res.json({token, user});
    } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({error:"Server error"});
    }
});

app.get("/v1/me", auth, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id,username,balance,created_at FROM users WHERE id=$1",
            [req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({error:"User not found"});
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({error:"Server error"});
    }
});

app.get("/v1/wallet", auth, async (req, res) => {
    try {
        const result = await pool.query("SELECT balance FROM users WHERE id=$1", [req.user.id]);
        if (!result.rows.length) return res.status(404).json({error:"User not found"});
        res.json({balance:result.rows[0].balance});
    } catch {
        res.status(500).json({error:"Server error"});
    }
});

app.get("/v1/transactions", auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id,type,amount,balance_after,description,created_at
             FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 100`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch {
        res.status(500).json({error:"Server error"});
    }
});

app.get("/v1/transactions/:id", auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id,type,amount,balance_after,description,created_at
             FROM transactions WHERE id=$1 AND user_id=$2`,
            [req.params.id, req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({error:"Transaction not found"});
        res.json(result.rows[0]);
    } catch {
        res.status(500).json({error:"Server error"});
    }
});

app.use((req,res) => res.status(404).json({error:"Not found"}));

async function start() {
    await init();
    const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`TorchCoin API listening on port ${PORT}`);
    });

    const shutdown = async () => {
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

start().catch((e) => {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
});
