'use strict';
const { Pool, types } = require('pg');
// Calendar dates (birthdays/session days) must not shift when the Node host timezone changes.
types.setTypeParser(1082, value => value);
const { AppError } = require('./domain');
let pool;
function getPool() {
  if (!process.env.DATABASE_URL) throw new AppError('Chưa cấu hình database. Vui lòng liên hệ quản trị viên.', 503);
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : {}) } });
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
