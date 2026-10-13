'use strict';
const { Pool, types } = require('pg');
// Calendar dates (birthdays/session days) must not shift when the Node host timezone changes.
types.setTypeParser(1082, value => value);
const { AppError } = require('./domain');
let pool;
function getPool() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) throw new AppError('Chưa cấu hình database. Vui lòng liên hệ quản trị viên.', 503);
  if (!pool) {
    const sslMode = process.env.DATABASE_SSL;
    let ssl = false;
    if (sslMode !== 'disable') {
      const rejectUnauthorized = sslMode === 'no-verify'
        ? false
        : (sslMode === 'strict' ? true : Boolean(process.env.DATABASE_CA_CERT));
      ssl = {
        rejectUnauthorized,
        ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : {})
      };
    }
    pool = new Pool({
      connectionString: dbUrl,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl
    });
  }
  return pool;
}
async function transaction(db, fn) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
async function audit(client, actor, action, classId, details) {
  await client.query('INSERT INTO audit_logs(actor_id,action,class_id,details) VALUES ($1,$2,$3,$4)', [actor,action,classId,JSON.stringify(details)]);
}
module.exports = { getPool, transaction, audit };
