require('dotenv').config();
const { init } = require('./config/database');
const app = require('./app');
const { startScheduler } = require('./services/scheduler');

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`
  ╔══════════════════════════════════════╗
  ║       payt Tracker iniciado!         ║
  ╠══════════════════════════════════════╣
  ║  Dashboard: http://localhost:${PORT}    ║
  ║  Webhook:   POST /webhook             ║
  ║  API:       GET  /api/tracking/:code  ║
  ╚══════════════════════════════════════╝
      `);
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('[Servidor] Falha ao inicializar banco:', err.message);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  console.error('[Servidor] Erro não tratado:', err.message);
});
