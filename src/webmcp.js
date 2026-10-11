import {useEffect} from 'react';
export function useWebMCP(data){
  useEffect(()=>{
    const context=document.modelContext;if(!context?.registerTool||!data)return;
    const lifecycle=new AbortController();
    const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{ /* Ordinary browsers continue to use the UI. */ }};
    register({name:'luuta_list_orders',title:'Tìm đơn LUUTA',description:'Đọc và tìm đơn hàng trong phạm vi quyền của tài khoản đang đăng nhập. Không thay đổi dữ liệu.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:200}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input={}){if(typeof input!=='object'||input===null||input.query!==undefined&&typeof input.query!=='string'||Object.keys(input).some(k=>k!=='query'))throw new Error('query phải là chuỗi.');const q=(input.query||'').toLocaleLowerCase('vi');return data.orders.filter(o=>`${o.code} ${o.customer} ${o.product_code} ${o.product_name}`.toLocaleLowerCase('vi').includes(q)).map(o=>({id:o.id,code:o.code,customer:o.customer,product:o.product_name,quantity:o.total,deadline:o.deadline,status:o.status,risk:o.risk,remaining:o.remaining}));}});
    register({name:'luuta_get_order',title:'Đọc tiến độ đơn LUUTA',description:'Đọc chi tiết tiến độ Size × Màu của một đơn được phép xem. Không thay đổi dữ liệu.',inputSchema:{type:'object',properties:{order_id:{type:'integer',minimum:1}},required:['order_id'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||!Number.isSafeInteger(input.order_id)||input.order_id<1||Object.keys(input).some(k=>k!=='order_id'))throw new Error('order_id phải là số nguyên dương.');const order=data.orders.find(o=>o.id===input.order_id);if(!order)throw new Error('Không tìm thấy đơn hoặc không có quyền xem.');return {order,variants:data.variants.filter(v=>v.order_id===order.id)};}});
    return()=>lifecycle.abort();
  },[data]);
}
