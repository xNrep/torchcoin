# TorchCoin Extension + Server

TorchCoin is a fictional CodeTorch/PenguinMod-oriented currency system.
Every new account receives 100 TC. There is deliberately no public minting
endpoint and no "set balance" extension block.

## Files
- `torchcoin.js` — Scratch/PenguinMod-compatible extension.
- `server.js` — authoritative API server.
- `package.json` — server dependencies.

## Demo server
1. Install Node.js 18+.
2. In this folder run:
   npm install
3. Set a strong JWT_SECRET.
4. Run:
   npm start
5. The API is at:
   http://localhost:8787

## Demo account
The development endpoint can create a test account:
POST /v1/dev/create-user
JSON: {"username":"alice"}

It returns a user token and gives the account 100 TC.

IMPORTANT: `/v1/dev/*` endpoints are for local development only.
Remove/disable them before public deployment.

## Demo project
POST /v1/dev/create-project
JSON:
{"name":"MyGame","ownerUserId":"<returned userId>"}

Then create a shop/item:
POST /v1/dev/create-shop
JSON:
{"projectId":"<projectId>","name":"My Shop","itemId":"sword","itemName":"Sword","price":25}

The returned project token is used by the extension.

## Security model
- Server owns the balance.
- Clients cannot mint coins.
- Clients cannot set balances.
- Projects do not receive user passwords.
- Project token and user token are separate.
- Purchases are two-step: create intent -> user confirms -> server commits.
- Price is read from the server's item database, not trusted from the client.
- Confirmation tokens expire after 2 minutes.
- Transaction and balance update happen in one SQLite transaction.

## Production notes
For a real public service:
- Replace development endpoints with an authenticated account-management service.
- Put the API behind HTTPS.
- Use a strong random JWT secret stored as an environment secret.
- Add rate limiting, audit logging, CSRF/CORS restrictions appropriate to your deployment,
  backups, account recovery, and project revocation.
- Never embed a project secret in client-side code if it is meant to be confidential.
- The extension's confirmation UI should be implemented by CodeTorch itself, outside the
  untrusted project, and should confirm the server-created purchase intent.
