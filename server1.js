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

    const response = await fetch(
        STORAGE_URL + path,
        options
    );

    let data = null;

    try {
        data = await response.json();
    } catch (_) {}

    return {
        response,
        data
    };
}


// GET
async function storageGet(key) {
    const { response, data } =
        await storageRequest(
            "get.php",
            "POST",
            {
                apiKey: STORAGE_KEY,
                key: key
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (!response.ok) {
        throw new Error("Server Storage: request failed");
    }

    if (
        data &&
        data.success &&
        data.data
    ) {
        return data.data.value;
    }

    return null;
}


// SAVE
async function storageSet(key, value) {
    const { response, data } =
        await storageRequest(
            "store.php",
            "POST",
            {
                apiKey: STORAGE_KEY,
                key: key,
                value: value,
                mimeType: "application/json"
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (
        !response.ok ||
        !data ||
        !data.success
    ) {
        throw new Error("Server Storage: write failed");
    }

    return true;
}


// DELETE
async function storageDelete(key) {
    const { response, data } =
        await storageRequest(
            "delete.php",
            "DELETE",
            {
                apiKey: STORAGE_KEY,
                key: key
            }
        );

    if (response.status === 401) {
        throw new Error("Server Storage: unauthorized");
    }

    if (
        !response.ok ||
        !data ||
        !data.success
    ) {
        throw new Error("Server Storage: delete failed");
    }

    return true;
}


// JSON helpers
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
    return storageSet(
        key,
        JSON.stringify(value)
    );
}


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function generateId() {
    return crypto.randomUUID();
}


function createToken(userId) {
    return jwt.sign(
        {
            sub: userId
        },
        JWT_SECRET,
        {
            expiresIn: "30d"
        }
    );
}


// Storage keys
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

        const token =
            header.substring(7);

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

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

// Server Storage doesn't provide an atomic
// balance increment operation through the API
// exposed by your extension.
//
// This prevents two simultaneous purchases
// from the SAME user being processed at once
// on this Render instance.

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

        if (
            locks.get(userId) === current
        ) {
            locks.delete(userId);
        }
    }
}


// --------------------------------------------------
// TRANSACTIONS
// --------------------------------------------------

async function addTransaction(
    userId,
    transaction
) {

    const key =
        transactionKey(userId);

    const transactions =
        await readJSON(
            key,
            []
        );

    transactions.unshift(
        transaction
    );

    // Keep the last 100 transactions
    if (transactions.length > 100) {
        transactions.length = 100;
    }

    await writeJSON(
        key,
        transactions
    );
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

        const {
            response,
            data
        } = await storageRequest(
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


        // Username validation
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


        // Password validation
        if (
            password.length < 6 ||
            password.length > 128
        ) {

            return res.status(400).json({
                error:
                    "Password must contain 6-128 characters"
            });

        }


        // Check username
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


        const userId =
            generateId();


        const passwordHash =
            await bcrypt.hash(
                password,
                12
            );


        const user = {

            id: userId,

            username: username,

            passwordHash:
                passwordHash,

            balance:
                STARTING_BALANCE,

            createdAt:
                new Date().toISOString()
        };


        // Username -> user ID
        await storageSet(
            usernameKey(username),
            userId
        );


        // User account
        await writeJSON(
            userKey(userId),
            user
        );


        // Initial transaction
        await writeJSON(
            transactionKey(userId),
            [
                {
                    id: generateId(),

                    type: "system",

                    amount:
                        STARTING_BALANCE,

                    description:
                        "Initial TorchCoin balance",

                    createdAt:
                        new Date().toISOString()
                }
            ]
        );


        res.status(201).json({

            token:
                createToken(userId),

            user: {

                id: userId,

                username: username,

                balance:
                    STARTING_BALANCE
            }

        });

    } catch (error) {

        console.error(
            "REGISTER ERROR:",
            error
        );

        res.status(500).json({
            error:
                "Registration failed"
        });

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
                createToken(
                    user.id
                ),

            user: {

                id: user.id,

                username:
                    user.username,

                balance:
                    user.balance
            }

        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error
        );

        res.status(500).json({
            error:
                "Login failed"
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
                    userKey(
                        req.userId
                    )
                );


            if (!user) {

                return res.status(404).json({
                    error:
                        "Account not found"
                });

            }


            res.json({

                id:
                    user.id,

                username:
                    user.username,

                balance:
                    user.balance,

                currency:
                    "TC"

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
                    userKey(
                        req.userId
                    )
                );


            if (!user) {

                return res.status(404).json({
                    error:
                        "Account not found"
                });

            }


            res.json({

                balance:
                    user.balance,

                currency:
                    "TC"

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
                transactions:
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
                    userKey(
                        req.userId
                    )
                );


            if (!user) {

                return res.status(404).json({
                    error:
                        "Account not found"
                });

            }


            if (
                user.balance < amount
            ) {

                return res.status(400).json({
                    error:
                        "Insufficient balance"
                });

            }


            const purchaseId =
                generateId();


            await writeJSON(
                purchaseKey(
                    purchaseId
                ),
                {

                    id:
                        purchaseId,

                    userId:
                        req.userId,

                    amount:
                        amount,

                    description:
                        description,

                    appId:
                        appId,

                    status:
                        "pending",

                    createdAt:
                        new Date().toISOString()

                }
            );


            res.status(201).json({

                purchaseId:
                    purchaseId,

                amount:
                    amount,

                description:
                    description,

                appId:
                    appId,

                status:
                    "pending"

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

                                status:
                                    404,

                                body: {
                                    error:
                                        "Purchase not found"
                                }

                            };

                        }


                        // Already processed
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

                                status:
                                    200,

                                body: {

                                    success:
                                        true,

                                    alreadyConfirmed:
                                        true,

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

                                status:
                                    400,

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

                                status:
                                    404,

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

                                status:
                                    400,

                                body: {
                                    error:
                                        "Insufficient balance"
                                }

                            };

                        }


                        // Charge
                        user.balance -=
                            purchase.amount;


                        await writeJSON(
                            userKey(
                                req.userId
                            ),
                            user
                        );


                        // Transaction
                        await addTransaction(
                            req.userId,
                            {

                                id:
                                    generateId(),

                                type:
                                    "purchase",

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


                        // Mark purchase confirmed
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

                            status:
                                200,

                            body: {

                                success:
                                    true,

                                purchaseId:
                                    purchase.id,

                                charged:
                                    purchase.amount,

                                balance:
                                    user.balance,

                                currency:
                                    "TC"

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
//
// POST /mint
// POST /set-balance
// POST /delete-balance
// POST /give-money
//
// A public project cannot directly
// create or modify arbitrary balances.
//
// --------------------------------------------------


app.listen(
    PORT,
    () => {

        console.log(
            `TorchBank running on port ${PORT}`
        );

    }
);
