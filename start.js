// ==========================================
// START ALL — Roda API (server.js) + Bot (bot.js) juntos
// ------------------------------------------
// Usado no Render como startCommand: node start.js
// - Mantém os dois processos vivos (reinicia se um cair)
// - Envia SIGTERM para ambos no shutdown
// ==========================================
require('dotenv').config();

const { spawn } = require('node:child_process');

const PROCS = [
  { name: 'server', file: 'server.js' },
  { name: 'bot',    file: 'bot.js' }
];

function startProc({ name, file }) {
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[${name}] ${d}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[${name}] ${d}`);
  });

  child.on('exit', (code, signal) => {
    console.log(`[${name}] saiu (code=${code} signal=${signal}). Reiniciando em 3s...`);
    setTimeout(() => startProc({ name, file }), 3000);
  });

  child.on('error', (err) => {
    console.error(`[${name}] erro ao iniciar:`, err.message);
  });

  return child;
}

const children = PROCS.map(startProc);

function shutdown(signal) {
  console.log(`\n[supervisor] ${signal} recebido, encerrando processos...`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch (e) { /* ignore */ }
  }
  // Sai só depois que os filhos encerrarem (ou 5s no máximo)
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('🚀 Supervisor iniciado: API + Bot rodando juntos.');