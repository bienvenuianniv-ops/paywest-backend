# PayWest API 🌍

> Plateforme de paiement panafricaine — Transferts sans frontières

[![Node.js](https://img.shields.io/badge/Node.js-24.x-green)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-blue)](https://neon.tech)
[![Deployed on Render](https://img.shields.io/badge/Deployed-Render-purple)](https://render.com)

## 📖 Description

PayWest est une API REST complète pour la gestion de paiements mobiles en Afrique. Elle permet les transferts d'argent, les paiements via QR code, les dépôts/retraits Wave et Orange Money, avec une gestion multi-rôles et multi-devises.

## 🌐 Production

- **API** : https://paywest-backend-1.onrender.com
- **Frontend** : https://pay.mayouservice.com
- **Documentation** : https://paywest-backend-1.onrender.com/api-docs

## 🚀 Fonctionnalités

- ✅ Authentification JWT avec Refresh Token
- ✅ Gestion des wallets (solde, recharge, historique)
- ✅ Transferts d'argent entre utilisateurs
- ✅ QR Code marchand pour les paiements
- ✅ Dépôts et retraits Wave / Orange Money
- ✅ Gestion des agents terrain
- ✅ Tableau de bord admin avancé
- ✅ KYC — vérification d'identité
- ✅ Notifications email (Resend) et SMS (Africa's Talking)
- ✅ Multi-devises (XOF, XAF, EUR, GNF, USD)
- ✅ Limites de transaction BCEAO
- ✅ Webhooks sécurisés (HMAC SHA256)
- ✅ Rate limiting et validation des données
- ✅ Logs Winston et historique d'audit
- ✅ Rapport financier Excel
- ✅ Documentation Swagger
- ✅ 23 tests automatisés

## 🏗️ Stack technique

| Couche | Technologie |
|--------|------------|
| Runtime | Node.js 24 |
| Framework | Express.js |
| Base de données | PostgreSQL (Neon) |
| Authentification | JWT + Refresh Token |
| Email | Resend |
| SMS | Africa's Talking |
| Déploiement | Render |
| Tests | Jest + Supertest |
| Documentation | Swagger UI |

## 📁 Structure du projet

```
paywest-backend/
├── src/
│   ├── config/          # DB, Swagger, Logger, SMS, Mailer
│   ├── controllers/     # Auth, Wallet, Transaction, Admin...
│   ├── middleware/      # Auth, Rate Limit, Validators, Audit
│   ├── routes/          # Toutes les routes API
│   ├── tests/           # Tests Jest
│   └── utils/           # Helpers (téléphone...)
├── .env                 # Variables d'environnement
└── package.json
```

## 🔑 Variables d'environnement

```env
PORT=5000
DATABASE_URL=postgresql://...
JWT_SECRET=...
RESEND_API_KEY=...
AFRICASTALKING_API_KEY=...
AFRICASTALKING_USERNAME=sandbox
WAVE_WEBHOOK_SECRET=...
ORANGE_WEBHOOK_SECRET=...
NODE_ENV=production
```

## 📡 Endpoints principaux

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/auth/register | Inscription |
| POST | /api/auth/login | Connexion |
| POST | /api/auth/refresh | Renouveler le token |
| GET | /api/wallet | Consulter son solde |
| POST | /api/transactions/send | Envoyer de l'argent |
| GET | /api/transactions | Historique |
| GET | /api/merchant/qrcode | Générer un QR code |
| POST | /api/deposit/wave | Dépôt Wave |
| POST | /api/withdraw/wave | Retrait Wave |
| GET | /api/admin/stats | Statistiques admin |
| GET | /api/reports/export | Export Excel |

## 👥 Rôles

| Rôle | Description |
|------|-------------|
| `customer` | Client standard |
| `merchant` | Marchand avec QR code |
| `agent` | Agent terrain |
| `admin` | Administrateur |

## 🧪 Tests

```bash
npm test
```

23 tests automatisés couvrant auth, wallet, transactions, KYC et agents.

## 📄 Licence

Propriété de **GCB — Global Congo Business** | **Mayou Service**

© 2026 — Tous droits réservés