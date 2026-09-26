# TorchCoin v4 — CodeTorch / PenguinMod

## Render deployment

This project is designed to be deployed as a Render Blueprint.

`render.yaml` creates:
- a Node web service named `torchcoin`
- a Render Postgres database named `torchcoin-db`
- `DATABASE_URL` automatically connected to the database
- a generated `JWT_SECRET`

### Important

The Blueprint must be deployed/synced from a repository containing this project.
If you create the web service manually instead, you must create a Render Postgres database and add its internal connection string as `DATABASE_URL`.

### API

GET `/health`

The health endpoint checks both the API and PostgreSQL.

POST `/v1/auth/register`
```json
{"username":"player","password":"password123"}
```

POST `/v1/auth/login`
```json
{"username":"player","password":"password123"}
```

Authenticated endpoints:
- GET `/v1/me`
- GET `/v1/wallet`
- GET `/v1/transactions`
- GET `/v1/transactions/:id`

Every new account starts with exactly 100 TC.

There is intentionally no public mint/set-balance endpoint.
