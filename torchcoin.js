class TorchCoin {
    constructor() {
        this.api = "https://torchcoin.onrender.com";
        this.token = "";
        this.lastError = "";
        this.onlineState = false;
        this.storageKey = "torchcoin_user_token_v1";

        try {
            this.token = localStorage.getItem(this.storageKey) || "";
        } catch (_) {}
    }

    getInfo() {
        return {
            id: "torchcoin",
            name: "TorchCoin",
            blocks: [
                { opcode: "connect", blockType: Scratch.BlockType.COMMAND, text: "connect to TorchCoin API" },
                { opcode: "online", blockType: Scratch.BlockType.BOOLEAN, text: "is TorchCoin server online?" },
                {
                    opcode: "register", blockType: Scratch.BlockType.COMMAND,
                    text: "create TorchCoin account username [USERNAME] password [PASSWORD]",
                    arguments: {
                        USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player"},
                        PASSWORD:{type:Scratch.ArgumentType.STRING,defaultValue:"password123"}
                    }
                },
                {
                    opcode: "login", blockType: Scratch.BlockType.COMMAND,
                    text: "login to TorchCoin username [USERNAME] password [PASSWORD]",
                    arguments: {
                        USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player"},
                        PASSWORD:{type:Scratch.ArgumentType.STRING,defaultValue:"password123"}
                    }
                },
                { opcode:"logout", blockType:Scratch.BlockType.COMMAND, text:"logout from TorchCoin" },
                { opcode:"valid", blockType:Scratch.BlockType.BOOLEAN, text:"TorchCoin user token is valid?" },
                { opcode:"balance", blockType:Scratch.BlockType.REPORTER, text:"TorchCoin balance" },
                { opcode:"userid", blockType:Scratch.BlockType.REPORTER, text:"my TorchCoin user ID" },
                {
                    opcode:"send", blockType:Scratch.BlockType.COMMAND,
                    text:"send [AMOUNT] TC to [USERNAME]",
                    arguments:{
                        AMOUNT:{type:Scratch.ArgumentType.NUMBER,defaultValue:10},
                        USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player2"}
                    }
                },
                {
                    opcode:"sendWithDescription", blockType:Scratch.BlockType.COMMAND,
                    text:"send [AMOUNT] TC to [USERNAME] description [DESCRIPTION]",
                    arguments:{
                        AMOUNT:{type:Scratch.ArgumentType.NUMBER,defaultValue:10},
                        USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player2"},
                        DESCRIPTION:{type:Scratch.ArgumentType.STRING,defaultValue:"Payment"}
                    }
                },
                { opcode:"transactions",blockType:Scratch.BlockType.REPORTER,text:"my TorchCoin transactions (JSON)" },
                {
                    opcode:"transaction",blockType:Scratch.BlockType.REPORTER,
                    text:"TorchCoin transaction [ID] (JSON)",
                    arguments:{ID:{type:Scratch.ArgumentType.NUMBER,defaultValue:1}}
                },
                { opcode:"error",blockType:Scratch.BlockType.REPORTER,text:"TorchCoin last error" }
            ]
        };
    }

    setToken(token) {
        this.token = String(token || "");
        try {
            if (this.token) localStorage.setItem(this.storageKey, this.token);
            else localStorage.removeItem(this.storageKey);
        } catch (_) {}
    }

    async request(path, options={}) {
        this.lastError = "";
        const headers = Object.assign({}, options.headers || {});
        if (options.body !== undefined) headers["Content-Type"] = "application/json";
        if (this.token) headers.Authorization = "Bearer " + this.token;

        try {
            const response = await fetch(this.api + path, Object.assign({}, options, {headers}));
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                this.lastError = data.error || ("HTTP " + response.status);
                if (response.status === 401) this.setToken("");
                return null;
            }
            return data;
        } catch (e) {
            this.lastError = String(e.message || e);
            this.onlineState = false;
            return null;
        }
    }

    async connect() {
        const data = await this.request("/health");
        this.onlineState = !!(data && data.status === "ok" && data.database === "ok");
    }

    online() { return this.onlineState; }

    async register(args) {
        const data = await this.request("/v1/auth/register", {
            method:"POST",
            body:JSON.stringify({
                username:String(args.USERNAME || ""),
                password:String(args.PASSWORD || "")
            })
        });

        if (data && data.token) {
            this.setToken(data.token);
            this.onlineState = true;
            return;
        }

        if (data && !data.token) this.lastError = "Server login response did not contain a user token";
    }

    async login(args) {
        // Clear a stale session before starting a new login.
        this.setToken("");

        const username = String(args.USERNAME || "").trim();
        const password = String(args.PASSWORD || "");

        const data = await this.request("/v1/auth/login", {
            method:"POST",
            body:JSON.stringify({username,password})
        });

        if (!data) return;

        const token = data.token || data.access_token;
        if (!token) {
            this.lastError = "Login succeeded but the server did not return a user token";
            return;
        }

        this.setToken(token);
        this.onlineState = true;

        // Verify the token immediately so the next Scratch block never runs
        // with a silently broken session.
        const me = await this.request("/v1/me");
        if (!me) {
            this.setToken("");
            if (!this.lastError) this.lastError = "Login token could not be verified";
            return;
        }

        this.onlineState = true;
    }

    logout() {
        this.setToken("");
        this.lastError = "";
    }

    async valid() {
        if (!this.token) return false;
        return !!(await this.request("/v1/me"));
    }

    async balance() {
        const data = await this.request("/v1/wallet");
        return data ? data.balance : "";
    }

    async userid() {
        const data = await this.request("/v1/me");
        return data ? data.id : "";
    }

    async confirmTransfer(amount, username, description) {
        const text = "Confirmer le transfert ?\\n\\n" +
            amount + " TC → " + username +
            (description ? "\\n\\nMotif : " + description : "");

        // Scratch/PenguinMod can run extensions in an iframe/sandbox.
        // Use a small integrated modal when DOM is available, with confirm()
        // as a compatibility fallback.
        if (typeof document === "undefined" || !document.body) {
            return typeof window !== "undefined" && typeof window.confirm === "function"
                ? window.confirm(text)
                : false;
        }

        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.style.cssText = [
                "position:fixed","inset:0","z-index:2147483647",
                "display:flex","align-items:center","justify-content:center",
                "background:rgba(0,0,0,.45)","font-family:Arial,sans-serif"
            ].join(";");

            const box = document.createElement("div");
            box.style.cssText = [
                "width:320px","max-width:calc(100vw - 32px)","padding:20px",
                "border-radius:14px","background:#fff","box-shadow:0 8px 40px rgba(0,0,0,.3)",
                "color:#222","box-sizing:border-box","text-align:center"
            ].join(";");

            const title = document.createElement("div");
            title.textContent = "Confirmer le transfert";
            title.style.cssText = "font-size:19px;font-weight:700;margin-bottom:12px";

            const details = document.createElement("div");
            details.textContent = amount + " TC → " + username +
                (description ? "\\nMotif : " + description : "");
            details.style.cssText = "white-space:pre-line;font-size:16px;line-height:1.5;margin-bottom:20px";

            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;gap:10px;justify-content:center";

            const cancel = document.createElement("button");
            cancel.textContent = "Annuler";
            cancel.style.cssText = "padding:9px 16px;border:0;border-radius:8px;cursor:pointer";

            const confirm = document.createElement("button");
            confirm.textContent = "Confirmer";
            confirm.style.cssText = "padding:9px 16px;border:0;border-radius:8px;cursor:pointer;background:#4c97ff;color:#fff;font-weight:700";

            const finish = value => {
                overlay.remove();
                resolve(value);
            };

            cancel.onclick = () => finish(false);
            confirm.onclick = () => finish(true);
            overlay.onclick = e => { if (e.target === overlay) finish(false); };

            actions.append(cancel, confirm);
            box.append(title, details, actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            confirm.focus();
        });
    }

    async send(args) {
        return this.sendWithDescription({
            AMOUNT:args.AMOUNT,
            USERNAME:args.USERNAME,
            DESCRIPTION:""
        });
    }

    async sendWithDescription(args) {
        const amount = Number(args.AMOUNT);
        const username = String(args.USERNAME || "").trim();
        const description = String(args.DESCRIPTION || "").trim();

        if (!Number.isSafeInteger(amount) || amount <= 0) {
            this.lastError = "Amount must be a positive whole number";
            return;
        }

        if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
            this.lastError = "Invalid recipient username";
            return;
        }

        if (!this.token) {
            this.lastError = "You must log in before sending TC";
            return;
        }

        const confirmed = await this.confirmTransfer(amount, username, description);
        if (!confirmed) {
            this.lastError = "Transfer cancelled";
            return;
        }

        await this.request("/v1/transactions", {
            method:"POST",
            body:JSON.stringify({
                recipient:username,
                amount,
                description
            })
        });
    }

    async transactions() {
        const data = await this.request("/v1/transactions");
        return data ? JSON.stringify(data) : "";
    }

    async transaction(args) {
        const id = Number(args.ID);
        if (!Number.isSafeInteger(id) || id <= 0) {
            this.lastError = "Invalid transaction ID";
            return "";
        }
        const data = await this.request("/v1/transactions/" + encodeURIComponent(id));
        return data ? JSON.stringify(data) : "";
    }

    error() { return this.lastError; }
}

Scratch.extensions.register(new TorchCoin());
