# TorchCoin v3

## Extension
`torchcoin.js` est une extension Scratch/PenguinMod/CodeTorch non sandboxée.
Le serveur par défaut est :
https://torchcoin.onrender.com

Blocs principaux :
- connect to TorchCoin API
- is server online?
- create TorchCoin account username [ ] password [ ]
- login to TorchCoin username [ ] password [ ]
- logout from TorchCoin
- user token is valid?
- TorchCoin balance
- my TorchCoin user ID
- my transactions (JSON)
- TorchCoin last error

## Serveur
Le serveur utilise PostgreSQL et crée automatiquement les tables au démarrage.

Variables Render :
- DATABASE_URL : URL PostgreSQL
- JWT_SECRET : secret aléatoire long
- NODE_ENV=production

## Important
Le token utilisateur est généré côté serveur. L'extension le garde uniquement en mémoire pendant la session.
Les mots de passe sont hashés avec bcrypt.
Pour une vraie mise en production : HTTPS, rate limiting, sauvegardes PostgreSQL, logs/audit et récupération de compte.
