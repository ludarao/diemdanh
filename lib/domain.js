'use strict';
class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const normalizeName = value => String(value || '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi');
function text(value, label, max = 250, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new AppError(`${label} không hợp lệ.`);
  return value.trim();
}
function finite(value, label, min, max) {
  if (value === null || value === '' || value === undefined || typeof value === 'boolean') throw new AppError(`${label} không hợp lệ.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`${label} không hợp lệ.`);
  return n;
}
function vnDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type,x.value])); return `${p.year}-${p.month}-${p.day}`;
}
function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new AppError('Ngày không hợp lệ.');
  return value;
}
function clock(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new AppError('Giờ không hợp lệ.');
  return value;
}
function atVN(day, time) { return new Date(`${dateOnly(day)}T${clock(time)}:00+07:00`); }
function scheduleTimes(day, input) {
  const mo = clock(input.morning_open || '07:00'), md = clock(input.morning_deadline || '08:00');
  const ao = clock(input.afternoon_open || '13:30'), ad = clock(input.afternoon_deadline || '14:00');
  if (!(mo < md && md < ao && ao < ad)) throw new AppError('Giờ phải theo thứ tự: mở sáng < hết giờ sáng < mở chiều < hết giờ chiều.');
  const next = new Date(`${dateOnly(day)}T00:00:00+07:00`); next.setUTCDate(next.getUTCDate() + 1);
  return [
    { name: 'Sáng', opens_at: atVN(day, mo), deadline_at: atVN(day, md), accepts_until: atVN(day, ao) },
    { name: 'Chiều', opens_at: atVN(day, ao), deadline_at: atVN(day, ad), accepts_until: next }
  ];
}
function selectSession(sessions, time) {
  const t = new Date(time).getTime();
  return sessions.find(s => s.state !== 'cancelled' && t >= new Date(s.opens_at).getTime() && t < new Date(s.accepts_until).getTime()) || null;
}
function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(a, 1)), Math.sqrt(Math.max(0, 1 - a)));
}
function validateGps(payload, settings) {
  const lat = finite(payload.latitude, 'Vĩ độ', -90, 90), lng = finite(payload.longitude, 'Kinh độ', -180, 180);
  const accuracy = finite(payload.accuracy, 'Sai số GPS', 0, 100000);
  const distance = distanceMeters(lat, lng, Number(settings.latitude), Number(settings.longitude));
  if (accuracy > Number(settings.max_accuracy)) throw new AppError(`Sai số GPS vượt ${settings.max_accuracy}m. Hãy quét lại vị trí.`);
  if (distance > Number(settings.radius)) throw new AppError(`Bạn ở ngoài bán kính ${settings.radius}m của nhóm. Hãy quét lại vị trí.`);
  return { latitude: lat, longitude: lng, accuracy, distance };
}
function sessionPhase(session, now) {
  if (session.state === 'cancelled') return 'Đã hủy';
  const t = new Date(now).getTime();
  if (t < new Date(session.opens_at).getTime()) return 'Chưa mở';
  if (t <= new Date(session.deadline_at).getTime()) return 'Đang nhận đúng giờ';
  return t < new Date(session.accepts_until).getTime() ? 'Đang nhận muộn' : 'Đã kết thúc';
}
function summarize(session, roster, attempts, now = new Date()) {
  const identity = a => a.student_id || `name:${a.normalized_name}`;
  const devices = new Map();
  for (const a of attempts) {
    if (a.kind !== 'present' || !a.device_id) continue;
    if (!devices.has(a.device_id)) devices.set(a.device_id, new Map());
    devices.get(a.device_id).set(identity(a), a);
  }
  const duplicateGroups = [...devices].filter(([, people]) => people.size > 1).map(([device_id, people]) => ({ device_id, attempts: [...people.values()] }));
  const flagged = new Set(duplicateGroups.flatMap(g => g.attempts.map(identity)));
  const resolutions = new Map(attempts.filter(a => a.device_resolution).map(a => [a.device_id,a.device_resolution]));
  for (const g of duplicateGroups) g.resolution = resolutions.get(g.device_id) || '';
  const rows = roster.map(student => {
    const history = attempts.filter(a => a.student_id === student.student_id).sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
    const present = history.find(a => a.kind === 'present');
    const reason = [...history].reverse().find(a => a.reason);
    const approvedAbsence = [...history].reverse().find(a => a.kind === 'reason' && a.reason_status === 'approved');
    const late = present && new Date(present.received_at) > new Date(session.deadline_at);
    let status = present ? (late ? 'late' : 'present') : approvedAbsence ? 'excused' : new Date(now) > new Date(session.deadline_at) ? 'absent' : 'pending';
    if (session.state === 'cancelled') status = 'cancelled';
    return { ...student, status, received_at: present?.received_at || null, entered_name: (present || reason)?.entered_name || '',
      late_minutes: late ? Math.ceil((new Date(present.received_at) - new Date(session.deadline_at)) / 60000) : 0,
      reason: reason?.reason || '', reason_status: reason?.reason_status || '', reason_id: reason?.id || null,
      duplicate_device: flagged.has(student.student_id), device_id: present?.device_id || '', history };
  });
  const counts = { total: rows.length, present: 0, late: 0, pending: 0, excused: 0, absent: 0, cancelled: 0 };
  for (const r of rows) counts[r.status]++;
  const unmatched = attempts.filter(a => !a.student_id).map(a => ({ ...a, duplicate_device: flagged.has(identity(a)) }));
  return { session, phase: sessionPhase(session, now), server_time: new Date(now).toISOString(), counts, rows, unmatched, duplicateGroups };
}
module.exports = { AppError, normalizeName, text, finite, vnDate, dateOnly, clock, atVN, scheduleTimes, selectSession, distanceMeters, validateGps, summarize };
