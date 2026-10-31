class TorchCoin {
    constructor() {
        this.api = "https://torchcoin.onrender.com";
        this.token = "";
        this.lastError = "";
        this.onlineState = false;
        this.storageKey = "torchcoin_user_token_v1";
        try { this.token = localStorage.getItem(this.storageKey) || ""; } catch (_) {}
    }
    getInfo() {
        return { id: "torchcoin", name: "TorchCoin", blocks: [
            { opcode: "connect", blockType: Scratch.BlockType.COMMAND, text: "connect to TorchCoin API" },
            { opcode: "online", blockType: Scratch.BlockType.BOOLEAN, text: "is TorchCoin server online?" },
            { opcode: "generateRecoveryCode", blockType: Scratch.BlockType.REPORTER, text: "generate TorchBank recovery code" },
            { opcode: "recoverAccount", blockType: Scratch.BlockType.COMMAND, text: "recover TorchBank account from code [CODE]", arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: "" } } },
            { opcode: "error", blockType: Scratch.BlockType.REPORTER, text: "TorchCoin last error" }
        ]};
    }
    setToken(token) {
        this.token = String(token || "");
        try { if (this.token) localStorage.setItem(this.storageKey, this.token); else localStorage.removeItem(this.storageKey); } catch (_) {}
    }
    async request(path, options = {}) {
        this.lastError = "";
        const headers = Object.assign({}, options.headers || {});
        if (options.body !== undefined) headers["Content-Type"] = "application/json";
        if (this.token) headers.Authorization = "Bearer " + this.token;
        try {
            const response = await fetch(this.api + path, Object.assign({}, options, { headers }));
            const data = await response.json().catch(() => ({}));
            if (!response.ok) { this.lastError = data.error || ("HTTP " + response.status); return null; }
            return data;
        } catch (error) { this.lastError = String(error.message || error); this.onlineState = false; return null; }
    }
    async connect() { const data = await this.request("/health"); this.onlineState = !!(data && data.ok === true && data.storage === "online"); }
    online() { return this.onlineState; }
    async generateRecoveryCode() {
        if (!this.token) { this.lastError = "Log in before generating a recovery code"; return ""; }
        const data = await this.request("/recovery/create", { method: "POST", body: JSON.stringify({}) });
        return data && data.recoveryCode ? data.recoveryCode : "";
    }
    async recoverAccount(args) {
        const code = String(args.CODE || "").trim();
        if (!code) { this.lastError = "Enter a recovery code"; return; }
        this.setToken("");
        const data = await this.request("/recovery/restore", { method: "POST", body: JSON.stringify({ code }) });
        if (data && data.token) { this.setToken(data.token); this.onlineState = true; this.lastError = ""; }
    }
    error() { return this.lastError; }
}
Scratch.extensions.register(new TorchCoin());