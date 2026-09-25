/* ===== 多用户管理 · 数据隔离核心 =====
   每个用户拥有独立的:
   - 数据存储键:  fxdb_v1_{uid}      (答题记录/错题/能力/设置)
   - API token:   fsgf_token_{uid}
   - 离线会话:    fsgf_offline_auth_{uid}
   用户列表存于 fxdb_users (仅用户名册，不含使用数据)
*/
const User=(()=>{
  const USERS_KEY='fxdb_users';      // [{id,name,createdAt}]
  const CURRENT_KEY='fxdb_current_user';
  const MIGRATED_KEY='fsgf_migrated_v1';

  function all(){
    try{return JSON.parse(localStorage.getItem(USERS_KEY))||[]}catch(e){return []}
  }
  function saveUsers(list){localStorage.setItem(USERS_KEY,JSON.stringify(list))}

  // 旧版单用户数据迁移：仅当检测到旧数据且从未迁移过时执行一次
  function migrateLegacy(){
    if(localStorage.getItem(MIGRATED_KEY)) return;
    localStorage.setItem(MIGRATED_KEY,'1');
    if(all().length>0) return;
    const legacy=localStorage.getItem('fxdb_v1');
    if(legacy){
      const users=[{id:'u1',name:'默认用户',createdAt:Date.now()}];
      saveUsers(users);
      localStorage.setItem('fxdb_v1_u1',legacy);
      try{localStorage.removeItem('fxdb_v1')}catch(e){}
      localStorage.setItem(CURRENT_KEY,'u1');
    }
  }

  function list(){migrateLegacy();return all()}
  function current(){
    migrateLegacy();
    const c=localStorage.getItem(CURRENT_KEY);
    if(c && get(c)) return c;
    // 无当前用户或已失效：若有用户则取第一个，否则 null
    const users=all();
    if(users.length>0){return users[0].id}
    return null;
  }
  function setCurrent(id){localStorage.setItem(CURRENT_KEY,id)}
  function get(id){return all().find(u=>u.id===id)||null}
  function getName(){const c=current();const u=c?get(c):null;return u?u.name:'未登录'}

  function create(name){
    migrateLegacy();
    const list=all();
    const id='u'+(Date.now().toString(36))+Math.random().toString(36).slice(2,6);
    list.push({id,name:name||('用户'+(list.length+1)),createdAt:Date.now()});
    saveUsers(list);
    return id;
  }
  function remove(id){
    let list=all().filter(u=>u.id!==id);
    if(list.length===0) list=[{id:'u1',name:'默认用户',createdAt:Date.now()}];
    saveUsers(list);
    // 清除该用户数据
    try{localStorage.removeItem('fxdb_v1_'+id)}catch(e){}
    try{localStorage.removeItem('fsgf_token_'+id)}catch(e){}
    try{sessionStorage.removeItem('fsgf_offline_auth_'+id)}catch(e){}
    if(current()===id) setCurrent(list[0].id);
  }
  function switchTo(id){
    if(get(id)){setCurrent(id);return true}
    return false;
  }
  // 会话键（按用户隔离；无用户时用 fallback 避免异常）
  function _uid(){return current()||'u1'}
  function dataKey(){return 'fxdb_v1_'+_uid()}
  function tokenKey(){return 'fsgf_token_'+_uid()}
  function sessionKey(){return 'fsgf_offline_auth_'+_uid()}

  return {list,current,setCurrent,get,getName,create,remove,switchTo,dataKey,tokenKey,sessionKey};
})();

// ★ 顶层 const 不会成为 window 属性；显式挂载，
//   供其它模块的 `window.User && ...` 兼容判断与内联 onclick 使用。
window.User=User;
