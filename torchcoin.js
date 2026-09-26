(function(Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) {
    throw new Error("TorchCoin doit être exécutée en mode non sandboxé.");
  }

  const API = "https://torchcoin.onrender.com";
  let userToken = "";
  let connected = false;
  let lastError = "";
  let lastResponse = null;

  async function request(path, options = {}) {
    lastError = "";
    try {
      const headers = Object.assign(
        {"Content-Type": "application/json"},
        options.headers || {}
      );
      if (userToken) headers.Authorization = "Bearer " + userToken;

      const res = await fetch(API + path, Object.assign({}, options, {headers}));
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) {}

      if (!res.ok) {
        lastError = data.error || data.message || ("HTTP " + res.status);
        throw new Error(lastError);
      }
      lastResponse = data;
      return data;
    } catch (e) {
      lastError = e.message || String(e);
      throw e;
    }
  }

  class TorchCoin {
    getInfo() {
      return {
        id: "torchcoin",
        name: "TorchCoin",
        color1: "#ff8a00",
        color2: "#e66f00",
        color3: "#c85d00",
        blocks: [
          {opcode:"connect", blockType:Scratch.BlockType.COMMAND, text:"connect to TorchCoin API"},
          {opcode:"online", blockType:Scratch.BlockType.BOOLEAN, text:"is server online?"},
          "---",
          {opcode:"register", blockType:Scratch.BlockType.BOOLEAN, text:"create TorchCoin account username [USERNAME] password [PASSWORD]",
            arguments:{USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player"},PASSWORD:{type:Scratch.ArgumentType.STRING,defaultValue:"password"}}},
          {opcode:"login", blockType:Scratch.BlockType.BOOLEAN, text:"login to TorchCoin username [USERNAME] password [PASSWORD]",
            arguments:{USERNAME:{type:Scratch.ArgumentType.STRING,defaultValue:"player"},PASSWORD:{type:Scratch.ArgumentType.STRING,defaultValue:"password"}}},
          {opcode:"logout", blockType:Scratch.BlockType.COMMAND, text:"logout from TorchCoin"},
          {opcode:"valid", blockType:Scratch.BlockType.BOOLEAN, text:"user token is valid?"},
          "---",
          {opcode:"balance", blockType:Scratch.BlockType.REPORTER, text:"TorchCoin balance"},
          {opcode:"userid", blockType:Scratch.BlockType.REPORTER, text:"my TorchCoin user ID"},
          {opcode:"transactions", blockType:Scratch.BlockType.REPORTER, text:"my transactions (JSON)"},
          {opcode:"error", blockType:Scratch.BlockType.REPORTER, text:"TorchCoin last error"}
        ]
      };
    }

    async connect() {
      try { await request("/health"); connected = true; }
      catch (_) { connected = false; }
    }

    async online() {
      try { await request("/health"); connected = true; return true; }
      catch (_) { connected = false; return false; }
    }

    async register(args) {
      try {
        const data = await request("/v1/auth/register", {
          method:"POST",
          body:JSON.stringify({username:String(args.USERNAME),password:String(args.PASSWORD)})
        });
        userToken = data.token || "";
        connected = true;
        return true;
      } catch (_) { return false; }
    }

    async login(args) {
      try {
        const data = await request("/v1/auth/login", {
          method:"POST",
          body:JSON.stringify({username:String(args.USERNAME),password:String(args.PASSWORD)})
        });
        userToken = data.token || "";
        connected = true;
        return true;
      } catch (_) { return false; }
    }

    logout() {
      userToken = "";
      connected = false;
      lastResponse = null;
    }

    async valid() {
      if (!userToken) return false;
      try { await request("/v1/me"); return true; }
      catch (_) { return false; }
    }

    async balance() {
      try {
        const data = await request("/v1/wallet");
        return data.balance ?? 0;
      } catch (_) { return 0; }
    }

    async userid() {
      try {
        const data = await request("/v1/me");
        return data.id || "";
      } catch (_) { return ""; }
    }

    async transactions() {
      try {
        const data = await request("/v1/transactions");
        return JSON.stringify(data);
      } catch (_) { return "[]"; }
    }

    error() { return lastError; }
  }

  Scratch.extensions.register(new TorchCoin());
})(Scratch);
