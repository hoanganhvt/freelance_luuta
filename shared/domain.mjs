export const STAGES = [
  { key: 'received', label: 'Nhận đơn', short: 'Nhận đơn' },
  { key: 'npl', label: 'Kiểm NPL/Vải', short: 'NPL/Vải' },
  { key: 'pattern', label: 'Kiểm rập', short: 'Rập' },
  { key: 'cut', label: 'Cắt', short: 'Cắt' },
  { key: 'sew', label: 'May', short: 'May' },
  { key: 'qc', label: 'QC', short: 'QC' },
  { key: 'repair', label: 'Sửa hàng', short: 'Sửa hàng' },
  { key: 'recheck', label: 'QC lại', short: 'QC lại' },
  { key: 'pack', label: 'Đóng gói', short: 'Đóng gói' },
  { key: 'ship', label: 'Giao hàng', short: 'Giao hàng' },
  { key: 'complete', label: 'Hoàn thành', short: 'Hoàn thành' },
];
export const ROLES = { director: 'Giám đốc', assistant: 'Trợ lý sản xuất', leader: 'Tổ trưởng', qc: 'QC', employee: 'Nhân viên' };
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const money = n => new Intl.NumberFormat('vi-VN').format(n || 0) + ' ₫';
export const num = n => new Intl.NumberFormat('vi-VN').format(n || 0);
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateLabel = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '—';
export const sum = (items, key) => items.reduce((a, x) => a + Number(x[key] || 0), 0);
export const good = v => Number(v.qc_pass || 0) + Number(v.recheck_pass || 0);
export function available(v, stage) {
  const limits = {
    npl: v.qty - v.npl, pattern: v.npl - v.pattern, cut: v.pattern - v.cut,
    sew: v.cut - v.sew, qc: v.sew - v.qc_checked,
    repair: v.qc_fail + v.recheck_fail - v.repair,
    recheck: v.repair - v.recheck_checked, pack: good(v) - v.pack, ship: v.pack - v.ship,
  };
  return Math.max(0, limits[stage] || 0);
}
export function stageQuantity(v, key) {
  if (key === 'received') return v.qty;
  if (key === 'qc') return v.qc_pass;
  if (key === 'recheck') return v.recheck_pass;
  if (key === 'complete') return v.ship;
  return Number(v[key] || 0);
}
export function orderSummary(order, variants, entries = [], now = today()) {
  const total = sum(variants, 'qty');
  const delivered = sum(variants, 'ship');
  const sewn = sum(variants, 'sew');
  const packed = sum(variants, 'pack');
  const qcPending = variants.reduce((n,v)=>n+available(v,'qc')+available(v,'recheck'),0);
  const repairPending = variants.reduce((n,v)=>n+available(v,'repair'),0);
  const remaining = total-delivered;
  const daysLeft = Math.ceil((new Date(order.deadline+'T00:00:00+07:00')-new Date(now+'T00:00:00+07:00'))/86400000);
  const recent = entries.filter(e=>e.order_id===order.id && e.stage==='sew' && e.date <= now && (new Date(now+'T00:00:00Z')-new Date(e.date+'T00:00:00Z'))/86400000 < 7);
  const daily = recent.length ? sum(recent,'qty') / Math.max(1,new Set(recent.map(e=>e.date)).size) : 0;
  const workRemaining = total-sewn;
  const requiredDays = daily ? Math.ceil(workRemaining/daily) + (remaining > 0 ? 1 : 0) : null;
  let risk = 'ontrack';
  if (remaining>0 && daysLeft<0) risk='late';
  else if (remaining>0 && (daysLeft<=1 || (requiredDays!==null && requiredDays>daysLeft) || (!daily && workRemaining>0 && daysLeft<=3))) risk='risk';
  let status = 'Đang sản xuất';
  if (order.completed_at) status='Hoàn thành';
  else if (total>0 && variants.every(v=>v.ship===v.qty)) status='Đã giao đủ';
  else if (packed>delivered) status='Chờ giao';
  else if (variants.some(v=>available(v,'pack')>0)) status='Chờ đóng gói';
  else if (repairPending>0) status='Sửa hàng';
  else if (qcPending>0) status='Chờ QC';
  let stage = STAGES.find(s=>!['received','complete'].includes(s.key) && variants.some(v=>available(v,s.key)>0))?.label || 'Nhận đơn';
  if (status==='Hoàn thành' || status==='Đã giao đủ') stage=status;
  const progress = total ? Math.round(variants.reduce((a,v)=>a+v.npl+v.pattern+v.cut+v.sew+good(v)+v.pack+v.ship,0)/(total*7)*100) : 0;
  return {total,delivered,sewn,packed,qcPending,repairPending,remaining,daysLeft,daily:Math.round(daily),requiredDays,risk,status,stage,progress};
}
