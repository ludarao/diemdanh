'use strict';
const ExcelJS = require('exceljs');
const { AppError, normalizeName, dateOnly } = require('./domain');
function scalar(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0,10);
  if (typeof value === 'object') {
    if (value.formula || value.sharedFormula) throw new AppError('Mẫu danh sách không nhận ô công thức. Hãy dán giá trị trước khi tải lên.');
    if (value.richText) return value.richText.map(x=>x.text).join('');
    if (value.text) return value.text;
    return String(value.result ?? '');
  }
  return String(value);
}
function parseDelimited(text) {
  const delimiter = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
  const rows = []; let row=[],cell='',quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"') { if (quoted && text[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
    else if (!quoted && c===delimiter) {row.push(cell);cell='';}
    else if (!quoted && (c==='\n'||c==='\r')) { if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''; }
    else cell+=c;
  }
  if(quoted)throw new AppError('CSV có dấu ngoặc kép chưa đóng.');
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function birthDate(value) {
  const v=scalar(value).trim(); if(!v)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(v))return dateOnly(v);
  const m=v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if(m)return dateOnly(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  throw new AppError('Ngày sinh phải là ngày Excel, YYYY-MM-DD hoặc DD/MM/YYYY.');
}
function previewMatrix(matrix, sheet='') {
  const idx=matrix.findIndex(r=>r.some(v=>normalizeName(scalar(v))==='họ và tên'));
  if(idx<0)throw new AppError('Không tìm thấy cột “Họ và tên” theo mẫu.');
  const headers=matrix[idx].map(v=>normalizeName(scalar(v).replace(/^\uFEFF/,'')));
  const nameCol=headers.indexOf('họ và tên'),unitCol=headers.indexOf('đơn vị'),dobCol=headers.indexOf('ngày sinh'),ttCol=headers.indexOf('tt');
  const rows=[],errors=[],warnings=[],seen=new Map();
  for(let i=idx+1;i<matrix.length;i++){
    const r=matrix[i];if(r.every(v=>!scalar(v).trim()))continue;
    const name=scalar(r[nameCol]).trim(),unit=unitCol<0?'':scalar(r[unitCol]).trim();
    if(!name){errors.push(`Dòng ${i+1}: thiếu họ và tên.`);continue;}
    if(name.length>250||unit.length>500){errors.push(`Dòng ${i+1}: nội dung quá dài.`);continue;}
    let birth_date=null;
    try{birth_date=dobCol<0?null:birthDate(r[dobCol]);}catch(e){errors.push(`Dòng ${i+1}: ${e.message}`);continue;}
    const rawOrdinal=ttCol<0?'':scalar(r[ttCol]).trim(),ordinal=rawOrdinal?Number(rawOrdinal):rows.length+1;
    if(!Number.isInteger(ordinal)||ordinal<1){errors.push(`Dòng ${i+1}: TT không hợp lệ.`);continue;}
    const key=normalizeName(name);
    if(seen.has(key))warnings.push(`Dòng ${i+1}: tên trùng với dòng ${seen.get(key)}; cần đối chiếu thủ công khi điểm danh.`);
    else seen.set(key,i+1);
    rows.push({ordinal,name,birth_date,unit});
    if(rows.length>3000)throw new AppError('Tối đa 3000 người tham gia mỗi lần nhập.');
  }
  if(!rows.length&&!errors.length)errors.push('Danh sách chưa có người tham gia.');
  return {sheet,headers:['TT','Họ và tên','Ngày sinh','Đơn vị'],rows,errors,warnings,total:rows.length};
}
async function previewImport(input) {
  if(typeof input.paste==='string'){
    if(input.paste.length>2000000)throw new AppError('Danh sách quá lớn.');
    return previewMatrix(parseDelimited(input.paste),'Nội dung đã dán');
  }
  if(typeof input.base64!=='string'||input.base64.length>2800000)throw new AppError('File tối đa 2 MB.');
  const buffer=Buffer.from(input.base64,'base64');
  if(buffer.length>2*1024*1024)throw new AppError('File tối đa 2 MB.');
  if(String(input.filename).toLowerCase().endsWith('.csv'))return previewMatrix(parseDelimited(buffer.toString('utf8')),'CSV');
  if(!String(input.filename).toLowerCase().endsWith('.xlsx'))throw new AppError('Chọn file .xlsx hoặc .csv.');
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer);}catch{throw new AppError('Không đọc được file Excel. Hãy kiểm tra file .xlsx.');}
  for(const sheet of workbook.worksheets){
    if(sheet.rowCount>4000||sheet.columnCount>50)continue;
    const matrix=[];sheet.eachRow({includeEmpty:true},row=>matrix.push(row.values.slice(1)));
    if(matrix.some(r=>r.some(v=>normalizeName(scalar(v))==='họ và tên')))return previewMatrix(matrix,sheet.name);
  }
  throw new AppError('Không tìm thấy sheet có cột “Họ và tên”, hoặc file vượt giới hạn 4000 dòng/50 cột.');
}
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function csv(rows){return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
module.exports={previewImport,previewMatrix,parseDelimited,csv};
