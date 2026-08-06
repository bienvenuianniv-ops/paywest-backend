const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PayWest API',
      version: '1.0.0',
      description: `
## Bienvenue sur l'API PayWest 🌍

PayWest est une plateforme de paiement panafricaine permettant :
- 💸 Les transferts d'argent entre utilisateurs
- 📲 Les paiements via QR code marchand
- 💳 Les dépôts via Wave et Orange Money
- 👥 La gestion d'agents terrain

## Authentification
Toutes les routes protégées nécessitent un token JWT.
Ajoutez le token dans le header : \`Authorization: Bearer <token>\`

## Rôles disponibles
- **customer** : Client standard
- **merchant** : Marchand avec QR code
- **agent** : Agent terrain
- **admin** : Administrateur

## Contact
- Email : support@mayouservice.com
- Site : https://pay.mayouservice.com
      `,
      contact: {
        name: 'PayWest Support',
        email: 'support@mayouservice.com',
        url: 'https://pay.mayouservice.com'
      }
    },
    servers: [
      {
        url: 'https://paywest-backend-1.onrender.com',
        description: 'Serveur de production'
      },
      {
        url: 'http://localhost:5000',
        description: 'Serveur local de développement'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT obtenu lors de la connexion'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            full_name: { type: 'string', example: 'Bienvenu Ianniv' },
            email: { type: 'string', example: 'bienvenu@paywest.com' },
            phone: { type: 'string', example: '+221771234567' },
            role: { type: 'string', enum: ['customer', 'merchant', 'agent', 'admin'] }
          }
        },
        Wallet: {
          type: 'object',
          properties: {
            balance: { type: 'number', example: 48000 },
            currency: { type: 'string', example: 'XOF' }
          }
        },
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            sender_id: { type: 'integer', example: 1 },
            receiver_id: { type: 'integer', example: 2 },
            amount: { type: 'number', example: 5000 },
            type: { type: 'string', enum: ['transfer', 'credit', 'payment', 'deposit', 'withdraw'] },
            status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Erreur serveur' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Authentification', description: 'Inscription et connexion' },
      { name: 'Wallet', description: 'Gestion du portefeuille' },
      { name: 'Transactions', description: 'Transferts et historique' },
      { name: 'Marchand', description: 'QR code et tableau de bord marchand' },
      { name: 'Agent', description: 'Opérations terrain' },
      { name: 'Dépôts', description: 'Wave et Orange Money' },
      { name: 'Administration', description: 'Gestion globale (admin uniquement)' }
    ]
  },
  apis: ['./src/routes/*.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;