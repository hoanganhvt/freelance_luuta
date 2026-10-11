import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { STAGES, SIZES, today } from '../shared/domain.mjs';
import { createWorkbook } from '../shared/excel.mjs';

export function hashPassword(password, salt=randomBytes(16).toString('hex')) { return salt+':'+scryptSync(password,salt,64).toString('hex'); }
export function checkPassword(password, hash) { const [salt,value]=hash.split(':'); const actual=scryptSync(password,salt,64); return timingSafeEqual(actual,Buffer.from(value,'hex')); }
export function openStore(filename=process.env.LUUTA_DB || resolve('data/luuta.sqlite')) {
  if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,line INTEGER,stage TEXT,active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,image TEXT DEFAULT '',rate INTEGER NOT NULL DEFAULT 35000,notes TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS sizes(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS colors(name TEXT PRIMARY KEY,hex TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,customer TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),received TEXT NOT NULL,deadline TEXT NOT NULL,priority TEXT NOT NULL,owner_id INTEGER NOT NULL REFERENCES users(id),notes TEXT DEFAULT '',completed_at TEXT);
    CREATE TABLE IF NOT EXISTS variants(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),color TEXT NOT NULL REFERENCES colors(name),size TEXT NOT NULL REFERENCES sizes(name),qty INTEGER NOT NULL CHECK(qty>0),line INTEGER NOT NULL CHECK(line BETWEEN 1 AND 5),npl INTEGER DEFAULT 0,pattern INTEGER DEFAULT 0,cut INTEGER DEFAULT 0,sew INTEGER DEFAULT 0,qc_checked INTEGER DEFAULT 0,qc_pass INTEGER DEFAULT 0,qc_fail INTEGER DEFAULT 0,repair INTEGER DEFAULT 0,recheck_checked INTEGER DEFAULT 0,recheck_pass INTEGER DEFAULT 0,recheck_fail INTEGER DEFAULT 0,pack INTEGER DEFAULT 0,ship INTEGER DEFAULT 0,UNIQUE(order_id,color,size));
    CREATE TABLE IF NOT EXISTS stage_meta(order_id INTEGER REFERENCES orders(id),stage TEXT NOT NULL,assignee_id INTEGER REFERENCES users(id),received_at TEXT,started_at TEXT,completed_at TEXT,status TEXT DEFAULT 'Chưa bắt đầu',received_qty INTEGER DEFAULT 0,notes TEXT DEFAULT '',PRIMARY KEY(order_id,stage));
    CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY,variant_id INTEGER NOT NULL REFERENCES variants(id),order_id INTEGER NOT NULL REFERENCES orders(id),product_id INTEGER NOT NULL REFERENCES products(id),employee_id INTEGER NOT NULL REFERENCES users(id),line INTEGER NOT NULL,stage TEXT NOT NULL,date TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),rate INTEGER NOT NULL CHECK(rate>=0),amount INTEGER NOT NULL,passed INTEGER DEFAULT 0,failed INTEGER DEFAULT 0,defect TEXT DEFAULT '',image TEXT DEFAULT '',parcels INTEGER DEFAULT 0,notes TEXT DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS payroll_locks(month TEXT PRIMARY KEY,locked_by INTEGER NOT NULL REFERENCES users(id),locked_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_entries_date_employee ON entries(date,employee_id);
    CREATE INDEX IF NOT EXISTS idx_entries_order_stage ON entries(order_id,stage);
    CREATE INDEX IF NOT EXISTS idx_variants_order ON variants(order_id);
    CREATE TRIGGER IF NOT EXISTS logs_no_delete BEFORE DELETE ON logs BEGIN SELECT RAISE(ABORT,'Không được xóa nhật ký'); END;
    CREATE TRIGGER IF NOT EXISTS logs_no_update BEFORE UPDATE ON logs BEGIN SELECT RAISE(ABORT,'Không được sửa nhật ký'); END;
    PRAGMA optimize;
  `);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const log=(user,action,entity,detail)=>db.prepare('INSERT INTO logs(user_id,action,entity,detail,created_at) VALUES(?,?,?,?,?)').run(user,action,entity,detail,new Date().toISOString());
  if(!db.prepare('SELECT COUNT(*) n FROM users').get().n) tx(()=>seed(db,log));
  const asyncTx=async fn=>{db.exec('BEGIN IMMEDIATE');try{const result=await fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  return {db,tx:asyncTx,log,exportWorkbook:createWorkbook};
}

function seed(db,log) {
  const password=hashPassword('Luuta@2026');
  const people=[['Minh Anh','giamdoc','director',null,null],['Ngọc Linh','troly','assistant',null,null],['Trần Thu Hà','totruong','leader',1,null],['Phạm Thảo','qc','qc',null,null],['Nguyễn Mai','nhanvien','employee',1,'sew'],['Trần Lan','lan','employee',1,'sew'],['Lê Hương','huong','leader',2,null],['Nguyễn An','an','employee',2,'sew'],['Hoàng Yến','yen','leader',3,null],['Đỗ Hạnh','hanh','employee',3,'sew'],['Vũ Thủy','thuy','leader',4,null],['Lê Ngọc','ngoc','employee',4,'sew'],['Mai Chi','chi','leader',5,null],['Nguyễn Vy','vy','employee',5,'sew'],['Trần Tâm','tam','employee',1,'cut'],['Phạm Hoa','hoa','employee',1,'pack']];
  const insertUser=db.prepare('INSERT INTO users(name,username,password,role,line,stage) VALUES(?,?,?,?,?,?)');
  people.forEach(p=>insertUser.run(p[0],p[1],password,p[2],p[3],p[4]));
  SIZES.forEach(s=>db.prepare('INSERT INTO sizes VALUES(?)').run(s));
  [['Đen','#252525'],['Trắng','#f8f7f3'],['Kem','#ddceb8'],['Hồng','#d4aaa8'],['Đỏ','#934747'],['Nâu','#857163']].forEach(c=>db.prepare('INSERT INTO colors VALUES(?,?)').run(...c));
  [['DA-001','Đầm draping lệch vai','/products/dress-black.svg',35000],['DA-002','Đầm lụa đính hoa','/products/dress-cream.svg',40000],['AO-001','Áo sơ mi cổ đứng','/products/shirt.svg',22000],['DA-003','Đầm vây cá hồng','/products/dress-pink.svg',42000],['QU-001','Quần suông thanh lịch','/products/trousers.svg',28000],['DA-004','Đầm kim sa tầng','/products/dress-cream.svg',45000]].forEach(p=>db.prepare('INSERT INTO products(code,name,image,rate) VALUES(?,?,?,?)').run(...p));
  const base=today(); const day=offset=>{const d=new Date(base+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
  const plans=[['Maison Hà Nội',1,2,1,0.66,120],['Studio Linh',2,-1,2,0.48,150],['The Muse',3,5,3,0.42,160],['An Nhiên Boutique',4,1,4,0.8,90],['Nắng Atelier',5,8,5,0.28,120],['Lê Thanh',6,6,1,0.52,100],['Maison Hà Nội',2,9,2,0.3,80],['Coco Studio',1,4,3,0.74,110],['The Muse',5,12,4,0.16,120],['Hạ Boutique',3,7,5,0.62,140],['Studio Linh',4,3,1,0.9,100],['Thảo Nguyễn',6,-2,2,0.96,60],['An Nhiên Boutique',1,-3,3,1,50],['Nắng Atelier',2,-4,4,1,60]];
  const makeEntry=db.prepare('INSERT INTO entries(variant_id,order_id,product_id,employee_id,line,stage,date,qty,rate,amount,passed,failed,created_by,created_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  plans.forEach((p,index)=>{
    const [customer,pid,due,line,progress,total]=p;
    const id=Number(db.prepare('INSERT INTO orders(customer,product_id,received,deadline,priority,owner_id,notes,completed_at) VALUES(?,?,?,?,?,?,?,?)').run(customer,pid,day(-12+index%4),day(due),index<2?'Cao':'Bình thường',2,'Kiểm tra đường may và nhãn size trước khi đóng gói.',index===13?new Date().toISOString():null).lastInsertRowid);
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(pid);
    const colors=pid===4?['Hồng','Kem']:pid===2?['Kem','Trắng']:['Đen','Trắng'];
    const sizes=['S','M','L'];
    let left=total;
    const emp={1:5,2:8,3:10,4:12,5:14}[line];
    const records=[];
    colors.forEach((color,ci)=>sizes.forEach((size,si)=>{
      const qty=ci===1&&si===2?left:Math.floor(total/6);left-=qty;
      const done=progress===1;
      const sew=done?qty:Math.floor(qty*progress);
      const checked=done?qty:Math.max(0,sew-2);
      const fail=done?0:Math.floor(checked*0.12);
      const pass=checked-fail;
      const pack=done?qty:Math.max(0,pass-2);
      const ship=done?qty:Math.max(0,pack-3);
      const vid=Number(db.prepare('INSERT INTO variants(order_id,color,size,qty,line,npl,pattern,cut,sew,qc_checked,qc_pass,qc_fail,pack,ship) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,color,size,qty,line,qty,qty,qty,sew,checked,pass,fail,pack,ship).lastInsertRowid);
      const v=db.prepare('SELECT * FROM variants WHERE id=?').get(vid);records.push(v);
      for(const [stage,count,rate,passed,failed] of [['npl',qty,0,0,0],['pattern',qty,0,0,0],['cut',qty,5000,0,0],['sew',sew,product.rate,0,0],['qc',checked,0,pass,fail],['pack',pack,2000,0,0],['ship',ship,0,0,0]]) {
        if(!count)continue;
        if(stage==='sew') {
          const first=Math.floor(count/2);const second=count-first;
          if(first)makeEntry.run(vid,id,pid,emp,line,stage,day(-3-index%3),first,rate,first*rate,0,0,3,day(-3-index%3)+'T09:20:00.000Z','Dữ liệu minh họa');
          if(second)makeEntry.run(vid,id,pid,emp,line,stage,day(-1),second,rate,second*rate,0,0,3,day(-1)+'T10:30:00.000Z','Dữ liệu minh họa');
        } else makeEntry.run(vid,id,pid,stage==='qc'?4:stage==='cut'?15:stage==='pack'?16:emp,line,stage,day(-2),count,rate,count*rate,passed,failed,2,day(-2)+'T08:00:00.000Z','Dữ liệu minh họa');
      }
    }));
    STAGES.forEach(s=>{
      const count=records.reduce((n,v)=>n+(s.key==='received'?v.qty:s.key==='qc'?v.qc_pass:s.key==='recheck'?v.recheck_pass:s.key==='complete'?v.ship:v[s.key]||0),0);
      const status=s.key==='complete'?(index===13?'Hoàn thành':'Chưa bắt đầu'):count>=total?'Hoàn thành':count>0?'Đang thực hiện':'Chưa bắt đầu';
      db.prepare('INSERT INTO stage_meta(order_id,stage,assignee_id,received_at,started_at,completed_at,status,received_qty,notes) VALUES(?,?,?,?,?,?,?,?,?)').run(id,s.key,s.key==='qc'||s.key==='recheck'?4:emp,day(-12+index%4)+'T02:00:00.000Z',count>0?day(-11+index%4)+'T02:00:00.000Z':null,status==='Hoàn thành'?day(-2)+'T10:00:00.000Z':null,status,['repair','recheck'].includes(s.key)?records.reduce((n,v)=>n+v.qc_fail,0):total,'');
    });
    log(2,'Tạo đơn',`LU-${String(id).padStart(3,'0')}`,`${customer} · ${product.name} · ${total} sản phẩm (dữ liệu minh họa)`);
  });
  log(3,'Cập nhật sản lượng','LU-001','Nguyễn Mai · May · Đen/M · +6 sản phẩm (dữ liệu minh họa)');
}
