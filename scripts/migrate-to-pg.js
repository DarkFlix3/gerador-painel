// ==========================================
// MIGRAÇÃO SQLite -> PostgreSQL (Neon/Supabase)
// ------------------------------------------
// Uso:
//   1. Configure DATABASE_URL no .env (string de conexão do Neon)
//   2. npm run migrate            (executa a migração)
//      npm run migrate -- --dry-run  (apenas mostra o que seria migrado)
//
// O script:
//   • Cria o schema no Postgres (mesmo DDL do db.js)
//   • Copia TODAS as tabelas preservando os ids originais
//   • É idempotente: rodar de novo não duplica nada (ON CONFLICT DO NOTHING)
//   • Ajusta as sequences (próximo id continua de onde parou)
// ==========================================

require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DATABASE_URL) {
  console.error('\n❌ DATABASE_URL não encontrada no .env!');
  console.error('👉 Crie um banco no Neon (https://neon.tech) e adicione no .env:');
  console.error('   DATABASE_URL=postgresql://user:senha@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require\n');
  process.exit(1);
}

const TABLES = ['settings', 'admins', 'resellers', 'sales', 'recharges', 'generations', 'error_logs'];

async function main() {
  // --- Abre o SQLite local em modo LEITURA (via db.js, sem DATABASE_URL) ---
  const savedDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const dbHelpers = require('../db'); // backend = sqlite (lê database.sqlite)
  process.env.DATABASE_URL = savedDbUrl;

  // --- Conecta no Postgres alvo ---
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 15000,
    ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false }
  });

  console.log(`\n🔀 Migração SQLite -> PostgreSQL${DRY_RUN ? ' (DRY-RUN, nada será gravado)' : ''}\n`);

  if (!DRY_RUN) {
    console.log('🗄️  Criando schema no Postgres...');
    await pool.query(dbHelpers.POSTGRES_DDL);
    console.log('   Schema OK.\n');
  }

  const report = [];
  for (const table of TABLES) {
    const rows = await dbHelpers.db.prepare(`SELECT * FROM ${table}`).all();
    const total = rows.length;

    if (DRY_RUN) {
      report.push({ table, total, inserted: 0, skipped: 0 });
      console.log(`📋 ${table.padEnd(12)} ${String(total).padStart(5)} linhas (dry-run)`);
      continue;
    }

    if (total === 0) {
      report.push({ table, total: 0, inserted: 0, skipped: 0 });
      console.log(`📋 ${table.padEnd(12)}     0 linhas (vazio)`);
      continue;
    }

    // Colunas = chaves da primeira linha (preserva a ordem do SELECT *)
    const columns = Object.keys(rows[0]);

    const client = await pool.connect();
    let inserted = 0;
    let skipped = 0;
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        const res = await client.query(sql, columns.map((c) => row[c]));
        if (res.rowCount > 0) inserted += 1;
        else skipped += 1;
      }
      // Ajusta a sequence para continuar do maior id existente
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falha ao migrar tabela ${table}: ${err.message}`);
    } finally {
      client.release();
    }

    report.push({ table, total, inserted, skipped });
    console.log(`✅ ${table.padEnd(12)} ${String(total).padStart(5)} linhas -> ${inserted} inseridas, ${skipped} já existiam`);
  }

  console.log('\n📊 Resumo:');
  const sumTotal = report.reduce((a, r) => a + r.total, 0);
  const sumIns = report.reduce((a, r) => a + r.inserted, 0);
  console.log(`   Total lido do SQLite: ${sumTotal} linhas`);
  console.log(`   Inseridas no Postgres: ${sumIns} linhas`);

  if (DRY_RUN) {
    console.log('\nℹ️  Rodando sem --dry-run, os dados serão copiados de verdade.');
  } else {
    console.log('\n🎉 Migração concluída! Agora é só colocar a mesma DATABASE_URL no Render.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('\n❌ Erro na migração:', err.message || err);
  process.exit(1);
});