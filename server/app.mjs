import express from 'express';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { checkPassword, hashPassword } from '../shared/passwords.mjs';
import { STAGES, ROLES, today, available, good, orderSummary, stageQuantity } from '../shared/domain.mjs';

const managers=['director','assistant'];
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
const integer=(value,label,min=0,max=1000000)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`${label} phải là số nguyên từ ${min} đến ${max}.`);return n;};
const required=(value,label,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label} không hợp lệ.`);return value.trim();};
const isoDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Ngày không hợp lệ.');return value;};
const validImage=value=>{if(!value)return '';if(typeof value!=='string'||value.length>1400000)fail('Ảnh quá lớn (tối đa 1 MB).');if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&!/^\/products\/[a-z-]+\.svg$/.test(value)&&!/^https:\/\//.test(value))fail('Ảnh phải là PNG, JPG, WebP hoặc địa chỉ HTTPS.');return value;};

export function createApp(store) {
  const {db,tx,log}=store;
  const app=express();
  app.set('trust proxy',1);
  app.disable('x-powered-by');
  app.use(express.json({limit:'4mb'}));
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','same-origin');
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Nguồn yêu cầu không hợp lệ.'});
    next();
  });
  const userFields='id,name,username,role,line,stage,active';
  const auth=async (req,res,next)=>{
    const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('luuta_session='))?.slice(14);
    const session=token&&(await db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(token,new Date().toISOString()));
    req.user=session&&(await db.prepare(`SELECT ${userFields} FROM users WHERE id=? AND active=1`).get(session.user_id));
    if(!req.user)return res.status(401).json({error:'Vui lòng đăng nhập để tiếp tục.'});
    req.token=token;next();
  };
  const role=(req,roles)=>{if(!roles.includes(req.user.role))fail('Bạn không có quyền thực hiện thao tác này.',403);};
  const accessVariant=(req,v)=>{if(!v)fail('Không tìm thấy Size/Màu.',404);if(['leader','employee'].includes(req.user.role)&&v.line!==req.user.line)fail('Bạn chỉ được thao tác trên chuyền được phân công.',403);};
  const accessOrder=async (req,id)=>{const o=(await db.prepare('SELECT * FROM orders WHERE id=?').get(id));if(!o)fail('Không tìm thấy đơn hàng.',404);if(['leader','employee'].includes(req.user.role)&&!(await db.prepare('SELECT id FROM variants WHERE order_id=? AND line=?').get(id,req.user.line)))fail('Đơn hàng không thuộc chuyền của bạn.',403);return o;};
  const attempts=new Map();
  app.post('/api/login',async (req,res)=>{
    const ip=req.ip;const now=Date.now();const bucket=attempts.get(ip)||{start:now,count:0};
    if(now-bucket.start>600000){bucket.start=now;bucket.count=0;}bucket.count++;attempts.set(ip,bucket);
    if(bucket.count>15)fail('Đã thử quá nhiều lần. Vui lòng thử lại sau 10 phút.',429);
    const username=required(req.body.username,'Tài khoản');const password=required(req.body.password,'Mật khẩu');
    const u=(await db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username));
    if(!u||!(await checkPassword(password,u.password)))fail('Tài khoản hoặc mật khẩu chưa đúng.',401);
    attempts.delete(ip);
    const token=randomBytes(32).toString('hex');
    (await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,new Date(now+43200000).toISOString()));
    (await db.prepare('DELETE FROM sessions WHERE expires<?').run(new Date().toISOString()));
    res.cookie('luuta_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:43200000,path:'/'});
    (await log(u.id,'Đăng nhập','Hệ thống',ROLES[u.role]));res.json({user:(await db.prepare(`SELECT ${userFields} FROM users WHERE id=?`).get(u.id))});
  });
  app.post('/api/logout',auth,async (req,res)=>{(await db.prepare('DELETE FROM sessions WHERE token=?').run(req.token));res.clearCookie('luuta_session',{path:'/'});res.json({ok:true});});
  app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
  app.get('/api/state',auth,async (req,res)=>{
    const u=req.user;const limited=['leader','employee'].includes(u.role);
    const users=(await db.prepare(`SELECT ${userFields} FROM users WHERE active=1`).all());
    const allVariants=(await db.prepare('SELECT * FROM variants').all());
    const variants=allVariants.filter(v=>!limited||v.line===u.line);
    const ids=new Set(variants.map(v=>v.order_id));
    const orders=(await db.prepare('SELECT o.*,p.name product_name,p.code product_code,p.image FROM orders o JOIN products p ON p.id=o.product_id ORDER BY o.id DESC').all()).filter(o=>!limited||ids.has(o.id));
    const allEntries=(await db.prepare('SELECT * FROM entries ORDER BY date DESC,id DESC').all());
    const relevantEntries=allEntries.filter(e=>!limited||e.line===u.line);
    const summaries=orders.map(o=>({...o,code:`LU-${String(o.id).padStart(3,'0')}`,...orderSummary(o,allVariants.filter(v=>v.order_id===o.id),allEntries)}));
    const entries=relevantEntries.filter(e=>u.role!=='employee'||e.employee_id===u.id).map(e=>{if(u.role==='director'||e.employee_id===u.id)return e;const {rate,amount,...publicEntry}=e;return publicEntry;});
    const locks=(await db.prepare('SELECT * FROM payroll_locks').all());
    const logs=(await db.prepare('SELECT l.*,u.name user_name FROM logs l LEFT JOIN users u ON l.user_id=u.id ORDER BY l.id DESC LIMIT 300').all()).filter(l=>u.role==='director'||(l.action!=='Chốt lương'&&(!limited||l.user_id===u.id))).map(l=>u.role!=='director'&&l.action==='Sửa sản lượng'?{...l,detail:l.detail.replace(/đơn giá \d+ → \d+; /,'')}:l);
    res.json({user:u,users:u.role==='employee'?users.filter(p=>p.id===u.id):limited?users.filter(p=>p.line===u.line||p.id===u.id):users,products:(await db.prepare('SELECT * FROM products ORDER BY id').all()),colors:(await db.prepare('SELECT * FROM colors').all()),sizes:(await db.prepare('SELECT name FROM sizes').all()).map(s=>s.name),orders:summaries,variants,entries,locks,logs,stageMeta:(await db.prepare('SELECT * FROM stage_meta').all()).filter(m=>ids.has(m.order_id)),today:today()});
  });
  app.post('/api/orders',auth,async (req,res)=>{
    role(req,managers);const b=req.body;const customer=required(b.customer,'Tên khách hàng');
    const pid=integer(b.product_id,'Sản phẩm',1);if(!(await db.prepare('SELECT id FROM products WHERE id=?').get(pid)))fail('Sản phẩm không tồn tại.');
    const received=isoDate(b.received),deadline=isoDate(b.deadline);if(deadline<received)fail('Ngày giao phải bằng hoặc sau ngày nhận.');
    if(!Array.isArray(b.variants)||!b.variants.length)fail('Thêm ít nhất một tổ hợp Màu × Size có số lượng.');
    if(b.variants.length>120)fail('Tối đa 120 tổ hợp cho một đơn.');
    const owner=integer(b.owner_id,'Người phụ trách',1);if(!(await db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(owner)))fail('Người phụ trách không tồn tại.');
    const combinations=new Set();
    const colors=new Set((await db.prepare('SELECT name FROM colors').all()).map(c=>c.name));
    const sizes=new Set((await db.prepare('SELECT name FROM sizes').all()).map(s=>s.name));
    const variants=b.variants.map(v=>{const key=v.color+'/'+v.size;if(combinations.has(key))fail('Một tổ hợp Màu × Size chỉ được nhập một lần.');combinations.add(key);if(!colors.has(v.color)||!sizes.has(v.size))fail('Màu hoặc Size không tồn tại.');return {...v,qty:integer(v.qty,'Số lượng',1),line:integer(v.line,'Chuyền',1,5)};});
    const result=(await tx(async ()=>{
      const id=Number((await db.prepare('INSERT INTO orders(customer,product_id,received,deadline,priority,owner_id,notes) VALUES(?,?,?,?,?,?,?)').run(customer,pid,received,deadline,b.priority==='Cao'?'Cao':'Bình thường',owner,String(b.notes||'').slice(0,3000))).lastInsertRowid);
      for(const v of variants) (await db.prepare('INSERT INTO variants(order_id,color,size,qty,line) VALUES(?,?,?,?,?)').run(id,v.color,v.size,v.qty,v.line));
      const total=variants.reduce((n,v)=>n+v.qty,0);
      for(const s of STAGES) (await db.prepare('INSERT INTO stage_meta(order_id,stage,status,received_qty,received_at,completed_at,assignee_id) VALUES(?,?,?,?,?,?,?)').run(id,s.key,s.key==='received'?'Hoàn thành':'Chưa bắt đầu',s.key==='received'?total:0,new Date().toISOString(),s.key==='received'?new Date().toISOString():null,owner));
      (await log(req.user.id,'Tạo đơn',`LU-${String(id).padStart(3,'0')}`,`${customer} · ${total} sản phẩm · Hạn giao ${deadline}`));return id;
    }));res.status(201).json({id:result});
  });
  app.put('/api/orders/:id',auth,async (req,res)=>{
    role(req,managers);const o=(await accessOrder(req,integer(req.params.id,'Đơn',1)));const b=req.body;const deadline=isoDate(b.deadline);if(deadline<o.received)fail('Ngày giao phải bằng hoặc sau ngày nhận.');
    const customer=required(b.customer,'Tên khách hàng');const owner=integer(b.owner_id,'Người phụ trách',1);if(!(await db.prepare('SELECT id FROM users WHERE id=?').get(owner)))fail('Người phụ trách không tồn tại.');
    (await tx(async ()=>{(await db.prepare('UPDATE orders SET customer=?,deadline=?,priority=?,owner_id=?,notes=? WHERE id=?').run(customer,deadline,b.priority==='Cao'?'Cao':'Bình thường',owner,String(b.notes||'').slice(0,3000),o.id));(await log(req.user.id,'Sửa đơn',`LU-${String(o.id).padStart(3,'0')}`,`Deadline ${o.deadline} → ${deadline}; khách ${o.customer} → ${customer}; ưu tiên ${o.priority} → ${b.priority}; phụ trách ${o.owner_id} → ${owner}; ghi chú ${o.notes} → ${b.notes||''}`));}));res.json({ok:true});
  });
  app.put('/api/variants/:id/line',auth,async (req,res)=>{
    role(req,managers);const v=(await db.prepare('SELECT * FROM variants WHERE id=?').get(integer(req.params.id,'Tổ hợp',1)));accessVariant(req,v);const line=integer(req.body.line,'Chuyền',1,5);
    (await tx(async ()=>{(await db.prepare('UPDATE variants SET line=? WHERE id=?').run(line,v.id));(await log(req.user.id,'Phân chuyền',`LU-${String(v.order_id).padStart(3,'0')}`,`${v.color}/${v.size}: Chuyền ${v.line} → Chuyền ${line}`));}));res.json({ok:true});
  });
  app.post('/api/orders/:id/complete',auth,async (req,res)=>{
    role(req,managers);const o=(await accessOrder(req,integer(req.params.id,'Đơn',1)));const vv=(await db.prepare('SELECT * FROM variants WHERE order_id=?').all(o.id));
    if(!vv.length||vv.some(v=>v.ship!==v.qty))fail('Chỉ được hoàn thành khi giao đủ tất cả Size × Màu.');
    (await tx(async ()=>{const now=new Date().toISOString();(await db.prepare('UPDATE orders SET completed_at=? WHERE id=?').run(now,o.id));(await db.prepare("UPDATE stage_meta SET status='Hoàn thành',completed_at=? WHERE order_id=? AND stage='complete'").run(now,o.id));(await log(req.user.id,'Hoàn thành đơn',`LU-${String(o.id).padStart(3,'0')}`,'Đã giao đủ toàn bộ Size × Màu.'));}));res.json({ok:true});
  });
  app.put('/api/orders/:id/stages/:stage',auth,async (req,res)=>{
    const o=(await accessOrder(req,integer(req.params.id,'Đơn',1)));const stage=req.params.stage;const b=req.body;
    if(!STAGES.some(s=>s.key===stage)||['received','complete'].includes(stage))fail('Công đoạn không hợp lệ.');
    if(req.user.role==='qc'&&!['qc','recheck'].includes(stage))fail('QC chỉ cập nhật công đoạn QC và QC lại.',403);
    if(req.user.role==='employee'&&req.user.stage!==stage)fail('Công đoạn không được phân công.',403);
    if(o.completed_at)fail('Đơn đã hoàn thành.');
    const allowed=['Chưa bắt đầu','Đang thực hiện','Hoàn thành','Có vấn đề'];if(!allowed.includes(b.status))fail('Trạng thái không hợp lệ.');
    const vv=(await db.prepare('SELECT * FROM variants WHERE order_id=?').all(o.id));
    if(['leader','employee'].includes(req.user.role)&&vv.some(v=>v.line!==req.user.line))fail('Đơn có nhiều chuyền. Quản lý cập nhật trạng thái chung; bạn vẫn được cập nhật sản lượng chuyền mình.',403);
    const total=vv.reduce((n,v)=>n+v.qty,0);
    const pending=vv.reduce((n,v)=>n+available(v,stage),0);
    if(b.status==='Hoàn thành'&&(['repair','recheck'].includes(stage)?pending>0:vv.reduce((n,v)=>n+stageQuantity(v,stage),0)<total))fail('Công đoạn chưa đủ số lượng hoàn thành.');
    if(b.status==='Đang thực hiện'&&!pending&&vv.every(v=>stageQuantity(v,stage)===0))fail('Công đoạn trước chưa có hàng để nhận.');
    const assignee=integer(b.assignee_id,'Người nhận việc',1);const assigneeUser=(await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(assignee));if(!assigneeUser)fail('Người nhận việc không tồn tại.');
    if(['leader','employee'].includes(req.user.role)&&(assigneeUser.line!==req.user.line||req.user.role==='employee'&&assignee!==req.user.id))fail('Chỉ phân công nhân viên thuộc chuyền của bạn.',403);
    const receivedQty=integer(b.received_qty,'Số lượng nhận',0,total);
    (await tx(async ()=>{const now=new Date().toISOString();const previous=(await db.prepare('SELECT * FROM stage_meta WHERE order_id=? AND stage=?').get(o.id,stage));(await db.prepare('UPDATE stage_meta SET assignee_id=?,status=?,received_qty=?,received_at=COALESCE(received_at,?),started_at=COALESCE(started_at,?),completed_at=?,notes=? WHERE order_id=? AND stage=?').run(assignee,b.status,receivedQty,now,b.status==='Đang thực hiện'||b.status==='Hoàn thành'?now:null,b.status==='Hoàn thành'?now:null,String(b.notes||'').slice(0,3000),o.id,stage));(await log(req.user.id,'Cập nhật tiến độ',`LU-${String(o.id).padStart(3,'0')}`,`${STAGES.find(s=>s.key===stage).label}: ${previous.status} → ${b.status}; nhận ${receivedQty}; ${b.notes||''}`));}));res.json({ok:true});
  });

  function validateCounts(v) {
    if(Object.values(v).some((n)=>typeof n==='number'&&n<0))fail('Số lượng không thể âm.');
    if(v.npl>v.qty||v.pattern>v.npl||v.cut>v.pattern||v.sew>v.cut||v.qc_checked>v.sew||v.qc_pass+v.qc_fail!==v.qc_checked||v.repair>v.qc_fail+v.recheck_fail||v.recheck_checked>v.repair||v.recheck_pass+v.recheck_fail!==v.recheck_checked||v.pack>good(v)||v.ship>v.pack||good(v)>v.sew)fail('Số lượng không phù hợp với công đoạn trước hoặc đã được sử dụng ở công đoạn sau.');
  }
  async function applyEntry(e,sign=1) {
    const v=(await db.prepare('SELECT * FROM variants WHERE id=?').get(e.variant_id));
    if(e.stage==='qc'||e.stage==='recheck'){v[e.stage+'_checked']+=sign*e.qty;v[e.stage+'_pass']+=sign*e.passed;v[e.stage+'_fail']+=sign*e.failed;}
    else v[e.stage]+=sign*e.qty;
    validateCounts(v);
    (await db.prepare('UPDATE variants SET npl=?,pattern=?,cut=?,sew=?,qc_checked=?,qc_pass=?,qc_fail=?,repair=?,recheck_checked=?,recheck_pass=?,recheck_fail=?,pack=?,ship=? WHERE id=?').run(v.npl,v.pattern,v.cut,v.sew,v.qc_checked,v.qc_pass,v.qc_fail,v.repair,v.recheck_checked,v.recheck_pass,v.recheck_fail,v.pack,v.ship,v.id));
    return v;
  }
  app.post('/api/entries',auth,async (req,res)=>{
    const b=req.body;const v=(await db.prepare('SELECT * FROM variants WHERE id=?').get(integer(b.variant_id,'Size/Màu',1)));accessVariant(req,v);const o=(await accessOrder(req,v.order_id));if(o.completed_at)fail('Đơn hàng đã hoàn thành.');
    const stage=b.stage;if(!STAGES.some(s=>s.key===stage)||['received','complete'].includes(stage))fail('Công đoạn không hợp lệ.');
    if(req.user.role==='qc'&&!['qc','recheck'].includes(stage))fail('Tài khoản QC chỉ được nhập QC hoặc QC lại.',403);
    if(['qc','recheck'].includes(stage)&&!['director','assistant','qc'].includes(req.user.role))fail('Chỉ nhân viên QC hoặc quản lý được duyệt QC.',403);
    if(req.user.role==='employee'&&stage!==req.user.stage)fail('Công đoạn không được phân công.',403);
    const employee=integer(b.employee_id,'Nhân viên',1);const emp=(await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(employee));if(!emp)fail('Nhân viên không tồn tại.');
    if(req.user.role==='employee'&&employee!==req.user.id)fail('Chỉ được cập nhật công việc của chính bạn.',403);
    if(req.user.role==='leader'&&emp.line!==req.user.line)fail('Nhân viên không thuộc chuyền của bạn.',403);
    if(!managers.includes(req.user.role)&&!['qc','recheck'].includes(stage)&&emp.line!==v.line)fail('Nhân viên phải thuộc chuyền được phân công.',403);
    if(['qc','recheck'].includes(stage)&&!['qc','director','assistant'].includes(emp.role))fail('Người nhận công đoạn kiểm tra phải có vai trò QC hoặc quản lý.');
    if(!managers.includes(req.user.role)&&emp.role==='employee'&&emp.stage!==stage)fail('Nhân viên chưa được phân công công đoạn này.',403);
    const date=isoDate(b.date);if(date>today())fail('Không ghi nhận sản lượng cho ngày trong tương lai.');if(date<o.received)fail('Ngày sản lượng phải bằng hoặc sau ngày nhận đơn.');
    const lock=(await db.prepare('SELECT * FROM payroll_locks WHERE month=?').get(date.slice(0,7)));if(lock&&req.user.role!=='director')fail('Tháng đã chốt lương. Chỉ Giám đốc được điều chỉnh.',403);if(lock&&!String(b.reason||'').trim())fail('Cần ghi lý do điều chỉnh tháng đã khóa.');
    const qty=integer(b.qty,'Số lượng',1);if(qty>available(v,stage))fail(`Chỉ còn ${available(v,stage)} sản phẩm có thể nhận tại công đoạn này.`);
    const product=(await db.prepare('SELECT * FROM products WHERE id=?').get(o.product_id));
    const defaultRate=stage==='sew'?product.rate:stage==='cut'?5000:stage==='pack'?2000:0;
    const rate=managers.includes(req.user.role)?integer(b.rate??defaultRate,'Đơn giá',0,10000000):defaultRate;
    const qc=['qc','recheck'].includes(stage);const failed=qc?integer(b.failed||0,'Số lỗi',0,qty):0;const passed=qc?qty-failed:0;
    if(failed&&!String(b.defect||'').trim())fail('Vui lòng chọn loại lỗi cho hàng không đạt.');
    const entry={variant_id:v.id,order_id:o.id,product_id:o.product_id,employee_id:employee,line:v.line,stage,date,qty,rate,amount:qty*rate,passed,failed};
    const id=(await tx(async ()=>{
      const updatedVariant=(await applyEntry(entry));
      const now=new Date().toISOString();
      const id=Number((await db.prepare('INSERT INTO entries(variant_id,order_id,product_id,employee_id,line,stage,date,qty,rate,amount,passed,failed,defect,image,parcels,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.id,o.id,o.product_id,employee,v.line,stage,date,qty,rate,qty*rate,passed,failed,String(b.defect||'').slice(0,500),validImage(b.image),integer(b.parcels||0,'Số kiện',0,10000),String(b.notes||'').slice(0,3000),req.user.id,now)).lastInsertRowid);
      const vv=(await db.prepare('SELECT * FROM variants WHERE order_id=?').all(o.id)).map(w=>w.id===updatedVariant.id?updatedVariant:w);const done=vv.every(w=>stage==='qc'?w.qc_checked>=w.qty:stage==='recheck'?w.qc_checked>=w.qty&&w.recheck_checked>=w.repair&&available(w,'repair')===0:stage==='repair'?w.qc_checked>=w.qty&&available(w,'repair')===0:stageQuantity(w,stage)>=w.qty);
      (await db.prepare('UPDATE stage_meta SET started_at=COALESCE(started_at,?),status=?,completed_at=?,assignee_id=?,received_at=COALESCE(received_at,?),received_qty=MAX(received_qty,?) WHERE order_id=? AND stage=?').run(now,failed?'Có vấn đề':done?'Hoàn thành':'Đang thực hiện',done?now:null,employee,now,qty,o.id,stage));
      (await log(req.user.id,'Cập nhật sản lượng',`LU-${String(o.id).padStart(3,'0')}`,`${emp.name} · ${product.name} · ${STAGES.find(s=>s.key===stage).label} · ${v.color}/${v.size} · +${qty} sản phẩm${qc?` · Đạt ${passed}, lỗi ${failed} (${b.defect||'không'})`:''}${stage==='pack'?` · ${b.parcels||0} kiện`:''}${lock?` · Điều chỉnh sau chốt: ${b.reason}`:''}`));return id;
    }));res.status(201).json({id});
  });
  app.put('/api/entries/:id',auth,async (req,res)=>{
    const e=(await db.prepare('SELECT * FROM entries WHERE id=?').get(integer(req.params.id,'Bản ghi',1)));if(!e)fail('Không tìm thấy bản ghi.',404);
    if(!managers.includes(req.user.role)&&!(e.employee_id===req.user.id||e.created_by===req.user.id)&&!(req.user.role==='leader'&&e.line===req.user.line))fail('Không được sửa bản ghi của nhân viên khác.',403);
    if(['qc','recheck'].includes(e.stage)&&!['director','assistant','qc'].includes(req.user.role))fail('Chỉ QC hoặc quản lý được sửa kết quả QC.',403);
    const v=(await db.prepare('SELECT * FROM variants WHERE id=?').get(e.variant_id));accessVariant(req,v);
    const b=req.body;const lock=(await db.prepare('SELECT * FROM payroll_locks WHERE month=?').get(e.date.slice(0,7)));if(lock&&req.user.role!=='director')fail('Tháng đã khóa. Chỉ Giám đốc được điều chỉnh.',403);
    const reason=required(b.reason,'Lý do sửa',1000);const qty=integer(b.qty,'Số lượng',1);const rate=req.user.role==='director'?integer(b.rate??e.rate,'Đơn giá',0,10000000):e.rate;
    const failed=['qc','recheck'].includes(e.stage)?integer(b.failed??e.failed,'Số lỗi',0,qty):0;const passed=['qc','recheck'].includes(e.stage)?qty-failed:0;
    const changed={...e,qty,rate,amount:qty*rate,passed,failed};
    (await tx(async ()=>{(await applyEntry({...e,qty:qty-e.qty,passed:passed-e.passed,failed:failed-e.failed}));(await db.prepare('UPDATE entries SET qty=?,rate=?,amount=?,passed=?,failed=?,notes=?,updated_at=? WHERE id=?').run(qty,rate,qty*rate,passed,failed,String(b.notes??e.notes).slice(0,3000),new Date().toISOString(),e.id));(await log(req.user.id,'Sửa sản lượng',`LU-${String(e.order_id).padStart(3,'0')}`,`Bản ghi #${e.id} · ${e.stage} · ${v.color}/${v.size} · Số lượng ${e.qty} → ${qty}; đơn giá ${e.rate} → ${rate}; lỗi ${e.failed} → ${failed}; ghi chú ${e.notes} → ${b.notes??e.notes}; lý do: ${reason}${lock?' (sau chốt lương)':''}`));}));res.json({ok:true});
  });
  app.post('/api/payroll/lock',auth,async (req,res)=>{
    role(req,['director']);const month=required(req.body.month,'Tháng');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Tháng không hợp lệ.');if(month>today().slice(0,7))fail('Không thể chốt tháng trong tương lai.');if((await db.prepare('SELECT month FROM payroll_locks WHERE month=?').get(month)))fail('Tháng này đã chốt.');
    (await tx(async ()=>{(await db.prepare('INSERT INTO payroll_locks VALUES(?,?,?)').run(month,req.user.id,new Date().toISOString()));(await log(req.user.id,'Chốt lương',month,'Khóa toàn bộ sản lượng tháng. Chỉ Giám đốc được điều chỉnh kèm lý do.'));}));res.json({ok:true});
  });
  app.post('/api/products',auth,async (req,res)=>{
    role(req,managers);const b=req.body;const code=required(b.code,'Mã sản phẩm',40);const name=required(b.name,'Tên sản phẩm');const rate=integer(b.rate,'Đơn giá may',0,10000000);
    if((await db.prepare('SELECT id FROM products WHERE code=?').get(code)))fail('Mã sản phẩm đã tồn tại.');
    const id=(await tx(async ()=>{const id=Number((await db.prepare('INSERT INTO products(code,name,image,rate,notes) VALUES(?,?,?,?,?)').run(code,name,validImage(b.image),rate,String(b.notes||'').slice(0,3000))).lastInsertRowid);(await log(req.user.id,'Tạo sản phẩm',code,name));return id;}));res.status(201).json({id});
  });
  app.put('/api/products/:id',auth,async (req,res)=>{
    role(req,managers);const id=integer(req.params.id,'Sản phẩm',1);const previous=(await db.prepare('SELECT * FROM products WHERE id=?').get(id));if(!previous)fail('Không tìm thấy sản phẩm.',404);const b=req.body;
    const name=required(b.name,'Tên sản phẩm'),rate=integer(b.rate,'Đơn giá may',0,10000000);
    (await tx(async ()=>{(await db.prepare('UPDATE products SET name=?,image=?,rate=?,notes=? WHERE id=?').run(name,validImage(b.image),rate,String(b.notes||'').slice(0,3000),id));(await log(req.user.id,'Sửa sản phẩm',previous.code,`Tên ${previous.name} → ${name}; Đơn giá áp dụng từ lần nhập tiếp theo ${previous.rate} → ${rate}`));}));res.json({ok:true});
  });
  app.post('/api/catalog/:type',auth,async (req,res)=>{
    role(req,managers);const type=req.params.type;if(!['sizes','colors'].includes(type))fail('Danh mục không hợp lệ.');const name=required(req.body.name,'Tên',30);if((await db.prepare(`SELECT name FROM ${type} WHERE name=?`).get(name)))fail('Tên đã tồn tại.');
    (await tx(async ()=>{if(type==='sizes')(await db.prepare('INSERT INTO sizes VALUES(?)').run(name));else{if(!/^#[0-9a-f]{6}$/i.test(req.body.hex))fail('Mã màu không hợp lệ.');(await db.prepare('INSERT INTO colors VALUES(?,?)').run(name,req.body.hex));}(await log(req.user.id,'Thêm danh mục',type,name));}));res.status(201).json({ok:true});
  });
  app.post('/api/users',auth,async (req,res)=>{
    role(req,['director']);const b=req.body;const name=required(b.name,'Tên nhân viên');const username=required(b.username,'Tài khoản',40);if(!/^[a-z0-9_.-]+$/i.test(username))fail('Tài khoản dùng chữ không dấu, số, dấu chấm hoặc gạch.');if((await db.prepare('SELECT id FROM users WHERE username=?').get(username)))fail('Tài khoản đã tồn tại.');
    if(!Object.keys(ROLES).includes(b.role))fail('Vai trò không hợp lệ.');const line=['employee','leader'].includes(b.role)?integer(b.line,'Chuyền',1,5):null;const stage=b.role==='employee'?b.stage:null;if(b.role==='employee'&&!STAGES.some(s=>s.key===stage&&!['received','complete','qc','recheck'].includes(stage)))fail('Công đoạn không hợp lệ.');const password=required(b.password,'Mật khẩu');if(password.length<8)fail('Mật khẩu cần ít nhất 8 ký tự.');
    const id=(await tx(async ()=>{const id=Number((await db.prepare('INSERT INTO users(name,username,password,role,line,stage) VALUES(?,?,?,?,?,?)').run(name,username,(await hashPassword(password)),b.role,line,stage)).lastInsertRowid);(await log(req.user.id,'Thêm nhân viên',username,`${name} · ${ROLES[b.role]}${line?` · Chuyền ${line}`:''}`));return id;}));res.status(201).json({id});
  });
  app.get('/api/export/:type',auth,async(req,res)=>{
    const type=req.params.type;if(!['payroll','production','orders'].includes(type))fail('Báo cáo không hợp lệ.');
    const report={title:type==='payroll'?'Tiền công sản phẩm':type==='orders'?'Đơn hàng':'Sản xuất',filename:`LUUTA-${type}-${req.query.month||today()}.xlsx`,rows:[],total:type!=='orders',financial:type==='payroll'};
    if(type==='orders') {
      let orders=(await db.prepare('SELECT o.*,p.code product_code,p.name product_name FROM orders o JOIN products p ON p.id=o.product_id').all());
      const vv=(await db.prepare('SELECT * FROM variants').all()),ee=(await db.prepare('SELECT * FROM entries').all());
      if(['leader','employee'].includes(req.user.role))orders=orders.filter(o=>vv.some(v=>v.order_id===o.id&&v.line===req.user.line));
      report.columns=[['Mã đơn','code',14],['Khách hàng','customer',26],['Mã sản phẩm','product_code',18],['Sản phẩm','product_name',30],['Màu','color',14],['Size','size',10],['Chuyền','line',10],['SL yêu cầu','qty',16],['Đã giao','ship',14],['Còn thiếu','remaining',14],['Hạn giao','deadline',18],['Trạng thái','status',20]];
      orders.forEach(o=>{const vars=vv.filter(v=>v.order_id===o.id&&(!['leader','employee'].includes(req.user.role)||v.line===req.user.line));const summary=orderSummary(o,vars,ee);vars.forEach(v=>report.rows.push({...o,...v,code:`LU-${String(o.id).padStart(3,'0')}`,remaining:v.qty-v.ship,status:summary.status}));});
    } else {
      let entries=(await db.prepare('SELECT e.*,u.name employee,p.code product_code,p.name product,v.color,v.size FROM entries e JOIN users u ON u.id=e.employee_id JOIN products p ON p.id=e.product_id JOIN variants v ON v.id=e.variant_id').all());
      if(req.user.role==='employee')entries=entries.filter(e=>e.employee_id===req.user.id);
      if(req.user.role==='leader')entries=entries.filter(e=>e.line===req.user.line);
      if(type==='payroll'&&req.user.role!=='director')entries=entries.filter(e=>e.employee_id===req.user.id);
      const q=req.query;entries=entries.filter(e=>(!q.month||e.date.startsWith(q.month))&&(!q.employee||String(e.employee_id)===q.employee)&&(!q.line||String(e.line)===q.line)&&(!q.stage||e.stage===q.stage)&&(!q.product||String(e.product_id)===q.product)&&(!q.color||e.color===q.color)&&(!q.size||e.size===q.size));
      report.columns=[['Ngày','date',16],['Nhân viên','employee',24],['Chuyền','line',10],['Mã đơn','order_code',14],['Mã sản phẩm','product_code',18],['Sản phẩm','product',30],['Màu','color',14],['Size','size',10],['Công đoạn','stage_label',20],['Số lượng','qty',14]];
      if(type==='payroll')report.columns.push(['Đơn giá (VND)','rate',20],['Thành tiền (VND)','amount',22]);
      report.rows=entries.map(e=>({...e,order_code:`LU-${String(e.order_id).padStart(3,'0')}`,stage_label:STAGES.find(s=>s.key===e.stage)?.label}));
      if(type==='payroll')report.footer=`Tháng ${q.month||'tất cả'} · ${q.month&&(await db.prepare('SELECT month FROM payroll_locks WHERE month=?').get(q.month))?'Đã chốt':'Chưa chốt'}`;
    }
    report.columns=report.columns.map(([header,key,width])=>({header,key,width}));
    report.rows=report.rows.map(row=>Object.fromEntries(report.columns.map(({key})=>[key,row[key]??null])));
    if(req.query.format==='json'||!store.exportWorkbook)return res.json(report);
    res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition',`attachment; filename="${report.filename}"`);
    res.send(Buffer.from(await store.exportWorkbook(report)));
  });

  app.use('/api',(req,res)=>res.status(404).json({error:'Không tìm thấy chức năng.'}));
  app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||400).json({error:error.status?error.message:error.type==='entity.too.large'?'Tệp quá lớn.':error.message?.includes('UNIQUE')?'Dữ liệu đã tồn tại.':'Không thể lưu dữ liệu. Vui lòng kiểm tra và thử lại.'});});
  return app;
}
