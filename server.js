const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 3000);

const STORAGE_URL =
    (process.env.SERVER_STORAGE_URL ||
        "https://ikelene.net/storage/")
        .replace(/\/+$/, "") + "/";

const STORAGE_KEY = process.env.SERVER_STORAGE_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "";

const STARTING_BALANCE = 100;

// --------------------------------------------------
// SERVER STORAGE
// --------------------------------------------------

async function storageRequest(path, method = "POST", body = null) {
    const options = {
        method,
        headers: {
            Accept: "application/json"
        }
    };

    if (body !== null) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(STORAGE_URL + path, options);

    let data = null;

    try {
        data = await response.json();
    } catch (_) {}

    return { response, data };
}

function storageError(data, fallback) {
    if (data && typeof data === "object") {
        return (
            data.error ||
            data.message ||
            data.detail ||
            fallback
        );
    }

    return fallback;
}

async function storageGet(key) {
    const { response, data } =
        await storageRequest(
            "get.php",
            "POST",
            {
                apiKey: STORAGE_KEY,
                key
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (!response.ok) {
        throw new Error(
            storageError(
                data,
                "Server Storage: request failed"
            )
        );
    }

    if (data && data.success && data.data) {
        return data.data.value;
    }

    if (data && data.success === false) {
        throw new Error(
            storageError(
                data,
                "Server Storage: get failed"
            )
        );
    }

    return null;
}

async function storageSet(key, value) {
    const { response, data } =
        await storageRequest(
            "store.php",
            "POST",
            {
                apiKey: STORAGE_KEY,
                key,
                value,
                mimeType: "application/json"
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (!response.ok || !data || !data.success) {
        throw new Error(
            storageError(
                data,
                "Server Storage: write failed"
            )
        );
    }

    return true;
}

async function storageDelete(key) {
    const { response, data } =
        await storageRequest(
            "delete.php",
            "DELETE",
            {
                apiKey: STORAGE_KEY,
                key
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (!response.ok || !data || !data.success) {
        throw new Error(
            storageError(
                data,
                "Server Storage: delete failed"
            )
        );
    }

    return true;
}

async function readJSON(key, fallback = null) {
    const value = await storageGet(key);

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

async function writeJSON(key, value) {
    return storageSet(key, JSON.stringify(value));
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function generateId() {
    return crypto.randomUUID();
}

function createToken(userId) {
    if (!JWT_SECRET) {
        throw new Error(
            "JWT_SECRET is not configured on the server"
        );
    }

    return jwt.sign(
        { sub: userId },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
}

function userKey(userId) {
    return `torchbank:user:${userId}`;
}

function usernameKey(username) {
    return `torchbank:username:${username.toLowerCase()}`;
}

function transactionKey(userId) {
    return `torchbank:transactions:${userId}`;
}

function purchaseKey(purchaseId) {
    return `torchbank:purchase:${purchaseId}`;
}

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

function authenticate(req, res, next) {
    try {
        const header =
            req.headers.authorization || "";

        if (!header.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "Missing authentication token"
            });
        }

        const token = header.substring(7);

        const decoded =
            jwt.verify(token, JWT_SECRET);

        req.userId = decoded.sub;

        next();
    } catch (_) {
        return res.status(401).json({
            error: "Invalid or expired token"
        });
    }
}

// --------------------------------------------------
// SIMPLE LOCK
// --------------------------------------------------

const locks = new Map();

async function withUserLock(userId, callback) {
    const previous =
        locks.get(userId) ||
        Promise.resolve();

    let release;

    const current =
        new Promise(resolve => {
            release = resolve;
        });

    locks.set(userId, current);

    await previous;

    try {
        return await callback();
    } finally {
        release();

        if (locks.get(userId) === current) {
            locks.delete(userId);
        }
    }
}

// --------------------------------------------------
// TRANSACTIONS
// --------------------------------------------------

async function addTransaction(userId, transaction) {
    const key = transactionKey(userId);

    const transactions =
        await readJSON(key, []);

    transactions.unshift(transaction);

    if (transactions.length > 100) {
        transactions.length = 100;
    }

    await writeJSON(key, transactions);
}

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        name: "TorchBank",
        status: "online",
        currency: "TorchCoin",
        symbol: "TC"
    });
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/health", async (req, res) => {
    try {
        const { response, data } =
            await storageRequest(
                "ping.php",
                "GET"
            );

        const working =
            response.ok &&
            data &&
            data.success === true &&
            data.status === "ok";

        if (!working) {
            return res.status(503).json({
                ok: false,
                storage: "offline"
            });
        }

        res.json({
            ok: true,
            storage: "online"
        });
    } catch (_) {
        res.status(503).json({
            ok: false,
            storage: "offline"
        });
    }
});

// --------------------------------------------------
// REGISTER
// --------------------------------------------------

app.post("/register", async (req, res) => {
    try {
        const username =
            String(
                req.body.username || ""
            ).trim();

        const password =
            String(
                req.body.password || ""
            );

        if (
            !/^[A-Za-z0-9_-]{3,24}$/.test(
                username
            )
        ) {
            return res.status(400).json({
                error:
                    "Username must contain 3-24 characters"
            });
        }

        if (
            password.length < 6 ||
            password.length > 128
        ) {
            return res.status(400).json({
                error:
                    "Password must contain 6-128 characters"
            });
        }

        const existing =
            await storageGet(
                usernameKey(username)
            );

        if (existing) {
            return res.status(409).json({
                error:
                    "Username already exists"
            });
        }

        const userId = generateId();

        const passwordHash =
            await bcrypt.hash(
                password,
                12
            );

        const user = {
            id: userId,
            username,
            passwordHash,
            balance: STARTING_BALANCE,
            createdAt:
                new Date().toISOString()
        };

        await storageSet(
            usernameKey(username),
            userId
        );

        await writeJSON(
            userKey(userId),
            user
        );

        await writeJSON(
            transactionKey(userId),
            [
                {
                    id: generateId(),
                    type: "system",
                    amount: STARTING_BALANCE,
                    description:
                        "Initial TorchCoin balance",
                    createdAt:
                        new Date().toISOString()
                }
            ]
        );

        res.status(201).json({
            token: createToken(userId),
            user: {
                id: userId,
                username,
                balance: STARTING_BALANCE
            }
        });
    } catch (error) {
        console.error(
            "REGISTER ERROR:",
            error
        );

        res.status(500).json({
            error:
                error && error.message
                    ? error.message
                    : "Registration failed"
        });
    }
});

// --------------------------------------------------
// ENCRYPTED ACCOUNT RECOVERY
// --------------------------------------------------
// Keep RECOVERY_SIGNING_SECRET stable in Render environment variables.
// JWT_SECRET is used as a compatibility fallback, but a dedicated secret is preferred.
const RECOVERY_SIGNING_SECRET =
    process.env.RECOVERY_SIGNING_SECRET || JWT_SECRET;

function recoverySignature(value) {
    if (!RECOVERY_SIGNING_SECRET) {
        throw new Error("RECOVERY_SIGNING_SECRET (or JWT_SECRET) is not configured");
    }
    return crypto.createHmac("sha256", RECOVERY_SIGNING_SECRET)
        .update(value)
        .digest("base64url");
}

function recoveryCodeFor(snapshot) {
    const secret = crypto.randomBytes(32).toString("base64url");
    const key = crypto.scryptSync(secret, "TorchBank Recovery v1", 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(snapshot), "utf8"),
        cipher.final()
    ]).toString("base64url");
    const tag = cipher.getAuthTag().toString("base64url");
    const unsigned = ["TB1", secret, iv.toString("base64url"), tag, ciphertext].join(".");
    return unsigned + "." + recoverySignature(unsigned);
}

function decodeRecoveryCode(code) {
    if (typeof code !== "string" || code.length > 200000) {
        throw new Error("Invalid recovery code");
    }
    const parts = code.trim().split(".");
    if (parts.length !== 6 || parts[0] !== "TB1") {
        throw new Error("Invalid recovery code format");
    }
    const unsigned = parts.slice(0, 5).join(".");
    const expected = Buffer.from(recoverySignature(unsigned), "base64url");
    const supplied = Buffer.from(parts[5], "base64url");
    if (expected.length !== supplied.length ||
        !crypto.timingSafeEqual(expected, supplied)) {
        throw new Error("Recovery code signature is invalid");
    }
    const secret = parts[1];
    const key = crypto.scryptSync(secret, "TorchBank Recovery v1", 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parts[4], "base64url")),
        decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
}

app.post("/recovery/create", authenticate, async (req, res) => {
    try {
        const user = await readJSON(userKey(req.userId));
        if (!user) return res.status(404).json({ error: "Account not found" });
        const transactions = await readJSON(transactionKey(req.userId), []);
        const recoveryCode = recoveryCodeFor({
            version: 1,
            user,
            transactions,
            createdAt: new Date().toISOString()
        });
        res.json({
            recoveryCode,
            warning: "Keep this code private. Anyone with it can restore this account."
        });
    } catch (error) {
        console.error("RECOVERY CREATE ERROR:", error);
        res.status(500).json({ error: error.message || "Could not create recovery code" });
    }
});

app.post("/recovery/restore", async (req, res) => {
    let restoredUserId = null;
    let restoredUsernameKey = null;
    try {
        const snapshot = decodeRecoveryCode(String(req.body.code || ""));
        const user = snapshot && snapshot.user;
        const transactions = snapshot && snapshot.transactions;
        if (snapshot.version !== 1 || !user || typeof user.id !== "string" ||
            typeof user.username !== "string" || typeof user.passwordHash !== "string" ||
            !Number.isSafeInteger(user.balance) || user.balance < 0 ||
            !Array.isArray(transactions) || transactions.length > 100) {
            return res.status(400).json({ error: "Recovery snapshot is invalid" });
        }
        if (!/^[A-Za-z0-9_-]{3,24}$/.test(user.username)) {
            return res.status(400).json({ error: "Recovery snapshot has an invalid username" });
        }

        const existingUser = await storageGet(usernameKey(user.username));
        const existingById = await readJSON(userKey(user.id));
        if (existingUser || existingById) {
            return res.status(409).json({
                error: "An account with this identity already exists; recovery will not overwrite it"
            });
        }

        // Restore the account and its transaction history. If a later write fails,
        // attempt to remove partial records so the account is not left half-restored.
        restoredUserId = user.id;
        restoredUsernameKey = usernameKey(user.username);
        await writeJSON(userKey(user.id), user);
        await storageSet(restoredUsernameKey, user.id);
        await writeJSON(transactionKey(user.id), transactions);

        return res.status(201).json({
            success: true,
            token: createToken(user.id),
            user: { id: user.id, username: user.username, balance: user.balance }
        });
    } catch (error) {
        if (restoredUserId) {
            try { await storageDelete(userKey(restoredUserId)); } catch (_) {}
            try { await storageDelete(transactionKey(restoredUserId)); } catch (_) {}
            if (restoredUsernameKey) {
                try { await storageDelete(restoredUsernameKey); } catch (_) {}
            }
        }
        console.error("RECOVERY RESTORE ERROR:", error);
        const message = error && error.message ? error.message : "Could not restore account";
        const clientError = /Invalid recovery|signature|authenticate|Unsupported state|unable to authenticate|JSON/i.test(message);
        return res.status(clientError ? 400 : 500).json({ error: clientError ? "Invalid recovery code or damaged backup" : message });
    }
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

app.post("/login", async (req, res) => {
    try {
        const username =
            String(
                req.body.username || ""
            ).trim();

        const password =
            String(
                req.body.password || ""
            );

        const userId =
            await storageGet(
                usernameKey(username)
            );

        if (!userId) {
            return res.status(401).json({
                error:
                    "Invalid username or password"
            });
        }

        const user =
            await readJSON(
                userKey(userId)
            );

        if (!user) {
            return res.status(401).json({
                error:
                    "Invalid username or password"
            });
        }

        const valid =
            await bcrypt.compare(
                password,
                user.passwordHash
            );

        if (!valid) {
            return res.status(401).json({
                error:
                    "Invalid username or password"
            });
        }

        res.json({
            token:
                createToken(user.id),
            user: {
                id: user.id,
                username: user.username,
                balance: user.balance
            }
        });
    } catch (error) {
        console.error(
            "LOGIN ERROR:",
            error
        );

        res.status(500).json({
            error:
                error && error.message
                    ? error.message
                    : "Login failed"
        });
    }
});

// --------------------------------------------------
// ACCOUNT
// --------------------------------------------------

app.get(
    "/me",
    authenticate,
    async (req, res) => {
        try {
            const user =
                await readJSON(
                    userKey(req.userId)
                );

            if (!user) {
                return res.status(404).json({
                    error:
                        "Account not found"
                });
            }

            res.json({
                id: user.id,
                username: user.username,
                balance: user.balance,
                currency: "TC"
            });
        } catch (_) {
            res.status(500).json({
                error:
                    "Could not load account"
            });
        }
    }
);

// --------------------------------------------------
// BALANCE
// --------------------------------------------------

app.get(
    "/balance",
    authenticate,
    async (req, res) => {
        try {
            const user =
                await readJSON(
                    userKey(req.userId)
                );

            if (!user) {
                return res.status(404).json({
                    error:
                        "Account not found"
                });
            }

            res.json({
                balance: user.balance,
                currency: "TC"
            });
        } catch (_) {
            res.status(500).json({
                error:
                    "Could not load balance"
            });
        }
    }
);

// --------------------------------------------------
// TRANSACTIONS
// --------------------------------------------------

app.get(
    "/transactions",
    authenticate,
    async (req, res) => {
        try {
            const transactions =
                await readJSON(
                    transactionKey(
                        req.userId
                    ),
                    []
                );

            res.json({
                transactions
            });
        } catch (_) {
            res.status(500).json({
                error:
                    "Could not load transactions"
            });
        }
    }
);

// --------------------------------------------------
// CREATE PURCHASE
// --------------------------------------------------

app.post(
    "/purchase/create",
    authenticate,
    async (req, res) => {
        try {
            const amount =
                Number(
                    req.body.amount
                );

            const description =
                String(
                    req.body.description ||
                    "Purchase"
                ).slice(0, 120);

            const appId =
                String(
                    req.body.appId ||
                    "unknown"
                ).slice(0, 100);

            if (
                !Number.isInteger(amount) ||
                amount <= 0 ||
                amount > 1000000
            ) {
                return res.status(400).json({
                    error:
                        "Invalid purchase amount"
                });
            }

            const user =
                await readJSON(
                    userKey(req.userId)
                );

            if (!user) {
                return res.status(404).json({
                    error:
                        "Account not found"
                });
            }

            if (user.balance < amount) {
                return res.status(400).json({
                    error:
                        "Insufficient balance"
                });
            }

            const purchaseId =
                generateId();

            await writeJSON(
                purchaseKey(purchaseId),
                {
                    id: purchaseId,
                    userId: req.userId,
                    amount,
                    description,
                    appId,
                    status: "pending",
                    createdAt:
                        new Date().toISOString()
                }
            );

            res.status(201).json({
                purchaseId,
                amount,
                description,
                appId,
                status: "pending"
            });
        } catch (error) {
            console.error(
                "PURCHASE CREATE ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Could not create purchase"
            });
        }
    }
);

// --------------------------------------------------
// CONFIRM PURCHASE
// --------------------------------------------------

app.post(
    "/purchase/confirm",
    authenticate,
    async (req, res) => {
        try {
            const purchaseId =
                String(
                    req.body.purchaseId ||
                    ""
                );

            if (!purchaseId) {
                return res.status(400).json({
                    error:
                        "Missing purchaseId"
                });
            }

            const result =
                await withUserLock(
                    req.userId,
                    async () => {
                        const purchase =
                            await readJSON(
                                purchaseKey(
                                    purchaseId
                                )
                            );

                        if (
                            !purchase ||
                            purchase.userId !==
                                req.userId
                        ) {
                            return {
                                status: 404,
                                body: {
                                    error:
                                        "Purchase not found"
                                }
                            };
                        }

                        if (
                            purchase.status ===
                            "confirmed"
                        ) {
                            const user =
                                await readJSON(
                                    userKey(
                                        req.userId
                                    )
                                );

                            return {
                                status: 200,
                                body: {
                                    success: true,
                                    alreadyConfirmed: true,
                                    balance:
                                        user.balance
                                }
                            };
                        }

                        if (
                            purchase.status !==
                            "pending"
                        ) {
                            return {
                                status: 400,
                                body: {
                                    error:
                                        "Purchase is not pending"
                                }
                            };
                        }

                        const user =
                            await readJSON(
                                userKey(
                                    req.userId
                                )
                            );

                        if (!user) {
                            return {
                                status: 404,
                                body: {
                                    error:
                                        "Account not found"
                                }
                            };
                        }

                        if (
                            user.balance <
                            purchase.amount
                        ) {
                            return {
                                status: 400,
                                body: {
                                    error:
                                        "Insufficient balance"
                                }
                            };
                        }

                        user.balance -=
                            purchase.amount;

                        await writeJSON(
                            userKey(
                                req.userId
                            ),
                            user
                        );

                        await addTransaction(
                            req.userId,
                            {
                                id: generateId(),
                                type: "purchase",
                                amount:
                                    -purchase.amount,
                                description:
                                    purchase.description,
                                appId:
                                    purchase.appId,
                                purchaseId:
                                    purchase.id,
                                createdAt:
                                    new Date().toISOString()
                            }
                        );

                        purchase.status =
                            "confirmed";

                        purchase.confirmedAt =
                            new Date().toISOString();

                        await writeJSON(
                            purchaseKey(
                                purchase.id
                            ),
                            purchase
                        );

                        return {
                            status: 200,
                            body: {
                                success: true,
                                purchaseId:
                                    purchase.id,
                                charged:
                                    purchase.amount,
                                balance:
                                    user.balance,
                                currency: "TC"
                            }
                        };
                    }
                );

            res
                .status(result.status)
                .json(result.body);
        } catch (error) {
            console.error(
                "PURCHASE CONFIRM ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Could not confirm purchase"
            });
        }
    }
);

// --------------------------------------------------
// INTENTIONALLY NO:
// --------------------------------------------------
// POST /mint
// POST /set-balance
// POST /delete-balance
// POST /give-money

app.listen(
    PORT,
    () => {
        console.log(
            `TorchBank running on port ${PORT}`
        );

        console.log(
            "SERVER_STORAGE_API_KEY:",
            STORAGE_KEY
                ? "configured"
                : "MISSING"
        );

        console.log(
            "JWT_SECRET:",
            JWT_SECRET
                ? "configured"
                : "MISSING"
        );
    }
);
