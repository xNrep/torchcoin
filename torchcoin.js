class TorchCoin {
    constructor() {
        this.api = "https://torchcoin.onrender.com";
        this.token = "";
        this.lastError = "";
        this.onlineState = false;
    }

    getInfo() {
        return {
            id: "torchcoin",
            name: "TorchCoin",
            blocks: [
                { opcode: "connect", blockType: Scratch.BlockType.COMMAND, text: "connect to TorchCoin API" },
                { opcode: "online", blockType: Scratch.BlockType.BOOLEAN, text: "is TorchCoin server online?" },
                {
                    opcode: "register",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "create TorchCoin account username [USERNAME] password [PASSWORD]",
                    arguments: {
                        USERNAME: {type: Scratch.ArgumentType.STRING, defaultValue:"player"},
                        PASSWORD: {type:Scratch.ArgumentType.STRING, defaultValue:"password123"}
                    }
                },
                {
                    opcode: "login",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "login to TorchCoin username [USERNAME] password [PASSWORD]",
                    arguments: {
                        USERNAME:{type:Scratch.ArgumentType.STRING, defaultValue:"player"},
                        PASSWORD:{type:Scratch.ArgumentType.STRING, defaultValue:"password123"}
                    }
                },
                { opcode: "logout", blockType: Scratch.BlockType.COMMAND, text: "logout from TorchCoin" },
                { opcode: "valid", blockType: Scratch.BlockType.BOOLEAN, text: "TorchCoin user token is valid?" },
                { opcode: "balance", blockType: Scratch.BlockType.REPORTER, text: "TorchCoin balance" },
                { opcode: "userid", blockType: Scratch.BlockType.REPORTER, text: "my TorchCoin user ID" },
                {
                    opcode: "send",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "send [AMOUNT] TC to [USERNAME]",
                    arguments: {
                        AMOUNT: {type: Scratch.ArgumentType.NUMBER, defaultValue:10},
                        USERNAME: {type: Scratch.ArgumentType.STRING, defaultValue:"player2"}
                    }
                },
                {
                    opcode: "sendWithDescription",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "send [AMOUNT] TC to [USERNAME] description [DESCRIPTION]",
                    arguments: {
                        AMOUNT: {type: Scratch.ArgumentType.NUMBER, defaultValue:10},
                        USERNAME: {type: Scratch.ArgumentType.STRING, defaultValue:"player2"},
                        DESCRIPTION: {type: Scratch.ArgumentType.STRING, defaultValue:"Payment"}
                    }
                },
                { opcode: "transactions", blockType: Scratch.BlockType.REPORTER, text: "my TorchCoin transactions (JSON)" },
                {
                    opcode: "transaction",
                    blockType: Scratch.BlockType.REPORTER,
                    text: "TorchCoin transaction [ID] (JSON)",
                    arguments: { ID: {type: Scratch.ArgumentType.NUMBER, defaultValue:1} }
                },
                { opcode: "error", blockType: Scratch.BlockType.REPORTER, text: "TorchCoin last error" }
            ]
        };
    }

    async request(path, options={}) {
        this.lastError = "";
        const headers = Object.assign({"Content-Type":"application/json"}, options.headers || {});
        if (this.token) headers.Authorization = "Bearer " + this.token;

        try {
            const response = await fetch(this.api + path, Object.assign({}, options, {headers}));
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                this.lastError = data.error || ("HTTP " + response.status);
                if (response.status === 401) this.token = "";
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

    online() {
        return this.onlineState;
    }

    async register(args) {
        const data = await this.request("/v1/auth/register", {
            method:"POST",
            body:JSON.stringify({
                username:String(args.USERNAME || ""),
                password:String(args.PASSWORD || "")
            })
        });
        if (data && data.token) {
            this.token = data.token;
            this.onlineState = true;
        }
    }

    async login(args) {
        const data = await this.request("/v1/auth/login", {
            method:"POST",
            body:JSON.stringify({
                username:String(args.USERNAME || ""),
                password:String(args.PASSWORD || "")
            })
        });
        if (data && data.token) {
            this.token = data.token;
            this.onlineState = true;
        }
    }

    logout() {
        this.token = "";
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

    async send(args) {
        return this.sendWithDescription({
            AMOUNT: args.AMOUNT,
            USERNAME: args.USERNAME,
            DESCRIPTION: ""
        });
    }

    async sendWithDescription(args) {
        const amount = Number(args.AMOUNT);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            this.lastError = "Amount must be a positive whole number";
            return;
        }

        await this.request("/v1/transactions", {
            method:"POST",
            body:JSON.stringify({
                recipient:String(args.USERNAME || ""),
                amount,
                description:String(args.DESCRIPTION || "")
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

    error() {
        return this.lastError;
    }
}

Scratch.extensions.register(new TorchCoin());