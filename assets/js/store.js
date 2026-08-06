/* ===== 数据层 · localStorage 持久化（按用户隔离） ===== */
const DB=(()=>{
  const K=()=>User.dataKey();
  const decay=lambda=>Math.exp(-Math.log(2)/30*lambda);
  let cache=null;
  let cacheUid=null;
  function load(){
    const uid=User.current();
    // 用户切换后强制重新加载
    if(cache && cacheUid===uid) return cache;
    cacheUid=uid;
    try{cache=JSON.parse(localStorage.getItem(K()))||{}}catch(e){cache={}}
    const d=new Date().toISOString().slice(0,10);
    if(!cache.records) cache.records=[];
    if(!cache.wrong) cache.wrong={}; // qid -> {count,first,last,mastered,mastery,notes}
    if(!cache.ability) cache.ability={}; // `${unit}|${cog}` -> {attempts,correct,wr,score,ts}
    if(!cache.sessions) cache.sessions=[];
    if(!cache.badges) cache.badges=[]; // badge codes earned
    if(!cache.daily) cache.daily={}; // date -> {target,done}
    if(!cache.xp) cache.xp=0;
    if(!cache.streak){cache.streak=0;cache.lastCheckin=null;}
    if(!cache.settings) cache.settings={theme:'light',dailyTarget:30,autoNext:false,examDate:null,
      fontSize:'md',bgTone:'default',showTimer:true,reduceMotion:false,shuffleOpts:false,breathingGuide:true,ttsEnabled:false};
    if(!cache.goals) cache.goals=[]; // 学习目标列表
    if(!cache.feynman) cache.feynman={}; // qid -> {text,ts,keywords}
    if(!cache.reviewMap) cache.reviewMap={}; // qid -> {count,nextAt}
    if(!cache.seen) cache.seen=[]; // 最近7天答过的qid
    if(!cache.notes) cache.notes=[]; // ★ 笔记：[{id,qid,text,tags,ts,upd}]
    if(!cache.imported) cache.imported=[]; // ★ 自动出题导入的题目
    if(!cache.favorites) cache.favorites=[]; // ★ 收藏夹：qid 数组
    return cache;
  }
  function save(){
    try{localStorage.setItem(K(),JSON.stringify(cache))}
    catch(e){
      // localStorage 配额溢出（通常>5MB），清理旧记录后重试
      if(e.name==='QuotaExceededError'||e.code===22||e.message.includes('quota')){
        const d=load();
        // 保留最近2000条记录，清空其余
        if(d.records&&d.records.length>2000){
          d.records=d.records.slice(-2000);
          cache=d;
          try{localStorage.setItem(K(),JSON.stringify(cache))}catch(e2){}
        }
      }
    }
  }
  // 能力图谱: 17单元×4认知维度=68维
  function keyAble(unit,cog){return unit+'|'+cog}
  function updAbility(unit,cog,correct){
    const k=keyAble(unit,cog);
    const a=cache.ability[k]||{attempts:0,correct:0,wr:0,score:0,ts:0};
    a.attempts++; if(correct)a.correct++;
    // 加权正确率(时间衰减,半衰期30天)
    let sw=0,w=0;
    for(const r of cache.records){
      if(r.u===unit&&r.c===cog){
        const days=(Date.now()-new Date(r.at).getTime())/86400000;
        const wt=Math.exp(-Math.log(2)/30*days);
        sw+=wt*(r.ok?1:0); w+=wt;
      }
    }
    a.wr=w?sw/w:0;
    a.score=a.attempts<3?a.wr*60:a.wr*100;
    a.ts=Date.now();
    cache.ability[k]=a;
  }
  return {
    load,save,
    // 答题记录
    addRecord(rec){
      const d=load();
      d.records.push(rec);
      // 维护seen(7天)
      d.seen=d.seen.filter(s=>Date.now()-s.t<7*86400000);
      d.seen.push({id:rec.qid,t:Date.now()});
      // 更新能力
      updAbility(rec.u,rec.c,rec.ok);
      // 错题本
      if(!rec.ok){
        const w=d.wrong[rec.qid]||{count:0,first:Date.now(),last:Date.now(),mastered:0,mastery:0,notes:'',reason:'',draft:'',confused:false};
        w.count++;w.last=Date.now();w.mastered=0;
        d.wrong[rec.qid]=w;
        d.reviewMap[rec.qid]={count:0,nextAt:Date.now()+86400000};
      }else{
        // 答对:若在错题本,提升mastery
        if(d.wrong[rec.qid]){
          const w=d.wrong[rec.qid];
          w.mastery=Math.min(0.95,w.mastery+0.16);
          const rv=d.reviewMap[rec.qid]||{count:0,nextAt:Date.now()};
          rv.count++;
          const iv=[1,2,4,7,15,30][Math.min(rv.count,5)];
          rv.nextAt=Date.now()+iv*86400000;
          d.reviewMap[rec.qid]=rv;
          if(rv.count>=5&&w.mastery>=0.95){w.mastered=1}
        }
      }
      save();
    },
    getWrong(){const d=load();return d.wrong},
    getReview(){const d=load();const now=Date.now();const out=[];for(const qid in d.reviewMap){if(d.reviewMap[qid].nextAt<=now&&!d.wrong[qid]?.mastered)out.push(qid)}return out},
    getAbility(){const d=load();return d.ability},
    getRecords(){const d=load();return d.records},
    addSession(s){const d=load();d.sessions.push(s);save()},
    getSessions(){const d=load();return d.sessions},
    // XP/段位
    addXP(n){const d=load();d.xp+=n;save();return d.xp},
    getXP(){const d=load();return d.xp},
    // 打卡
    checkin(){
      const d=load();const today=new Date().toISOString().slice(0,10);
      if(d.lastCheckin===today) return false;
      const y=new Date(Date.now()-86400000).toISOString().slice(0,10);
      d.streak = d.lastCheckin===y ? d.streak+1 : 1;
      d.lastCheckin=today;
      save();return true;
    },
    getStreak(){const d=load();return d.streak},
    // 每日目标
    getDaily(){
      const d=load();const today=new Date().toISOString().slice(0,10);
      if(!d.daily[today]) d.daily[today]={target:d.settings.dailyTarget,done:0};save();
      return d.daily[today];
    },
    incDaily(){const d=load();const t=new Date().toISOString().slice(0,10);if(!d.daily[t])d.daily[t]={target:d.settings.dailyTarget,done:0};d.daily[t].done++;save();return d.daily[t]},
    // 勋章
    earnBadge(code){const d=load();if(!d.badges.includes(code)){d.badges.push(code);save();return true}return false},
    getBadges(){const d=load();return d.badges},
    // 设置
    getSettings(){const d=load();return d.settings},
    setSetting(k,v){const d=load();d.settings[k]=v;save()},
    // 导出/导入/重置
    exportAll(){const d=load();return JSON.stringify(d)},
    importAll(json){cache=JSON.parse(json);save()},
    reset(){cache={};localStorage.removeItem(K());load();save()},
    // 是否答过/最近答对
    isRecentCorrect(qid){
      const d=load();
      for(let i=d.records.length-1;i>=0;i--){if(d.records[i].qid===qid&&d.records[i].ok)return true}
      return false;
    },
    seenIds(){
      const d=load();const set=new Set();
      for(const s of d.seen) set.add(s.id);
      return set;
    },
    // ★ 错因归因
    setWrongReason(qid,reason){const d=load();if(d.wrong[qid]){d.wrong[qid].reason=reason;save()}},
    getWrongByReason(reason){const d=load();const out=[];for(const id in d.wrong){if(!d.wrong[id].mastered&&d.wrong[id].reason===reason)out.push(id)}return out},
    getReasonStats(){const d=load();const stats={careless:0,concept:0,misread:0,unknown:0,unlabeled:0};for(const id in d.wrong){if(d.wrong[id].mastered)continue;const r=d.wrong[id].reason||'unlabeled';stats[r]=(stats[r]||0)+1}return stats},
    // ★ 草稿存储
    setDraft(qid,draft){const d=load();if(d.wrong[qid]){d.wrong[qid].draft=draft;save()}},
    getDraft(qid){const d=load();return d.wrong[qid]?.draft||''},
    // ★ 困惑标记
    setConfused(qid){const d=load();if(d.wrong[qid]){d.wrong[qid].confused=true;save()}},
    getConfused(){const d=load();const out=[];for(const id in d.wrong){if(d.wrong[id].confused)out.push(id)}return out},
    // ★ 费曼记录
    saveFeynman(qid,text){const d=load();d.feynman[qid]={text,ts:Date.now()};save()},
    getFeynman(qid){const d=load();return d.feynman[qid]||null},
    // ★ 学习目标
    addGoal(goal){const d=load();goal.id='g'+Date.now().toString(36);goal.startDate=Date.now();goal.done=false;d.goals.push(goal);save();return goal.id},
    updateGoal(id,patch){const d=load();const g=d.goals.find(x=>x.id===id);if(g){Object.assign(g,patch);save()}},
    removeGoal(id){const d=load();d.goals=d.goals.filter(g=>g.id!==id);save()},
    getGoals(){const d=load();return d.goals.filter(g=>!g.done).sort((a,b)=>b.startDate-a.startDate)},
    getActiveGoal(){const d=load();return d.goals.find(g=>!g.done&&g.startDate<=Date.now())},
    // ★★ 笔记 CRUD（独立数组，支持按题目关联 + 全文检索）★★
    addNote(qid,text,tags){
      const d=load();
      const n={id:'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
               qid:qid||'',text:text||'',tags:Array.isArray(tags)?tags:(tags?String(tags).split(/[,，\s]+/).filter(Boolean):[]),
               ts:Date.now(),upd:Date.now()};
      d.notes.push(n);save();return n.id;
    },
    updateNote(id,text,tags){
      const d=load();const n=d.notes.find(x=>x.id===id);
      if(!n)return false;
      if(text!==undefined&&text!==null)n.text=text;
      if(tags!==undefined&&tags!==null)n.tags=Array.isArray(tags)?tags:String(tags).split(/[,，\s]+/).filter(Boolean);
      n.upd=Date.now();save();return true;
    },
    deleteNote(id){const d=load();const before=d.notes.length;d.notes=d.notes.filter(x=>x.id!==id);save();return d.notes.length<before},
    getNote(id){const d=load();return d.notes.find(x=>x.id===id)||null},
    getNotesByQ(qid){const d=load();return d.notes.filter(x=>x.qid===qid).sort((a,b)=>b.upd-a.upd)},
    getAllNotes(){const d=load();return d.notes.slice().sort((a,b)=>b.upd-a.upd)},
    searchNotes(kw){
      const d=load();if(!kw)return d.notes.slice().sort((a,b)=>b.upd-a.upd);
      const k=String(kw).toLowerCase();
      return d.notes.filter(n=>(n.text||'').toLowerCase().includes(k)||(n.tags||[]).some(t=>t.toLowerCase().includes(k))||(n.qid||'').toLowerCase().includes(k))
                    .sort((a,b)=>b.upd-a.upd);
    },
    // ★★ 自动出题导入 ★★
    addImported(q){const d=load();if(!d.imported.find(x=>x.id===q.id)){d.imported.push(q);save();return true}return false},
    getImported(){const d=load();return d.imported||[]},
    clearImported(){const d=load();d.imported=[];save()},
    // ★★ 收藏夹 ★★
    toggleFav(qid){const d=load();const i=d.favorites.indexOf(qid);if(i>=0){d.favorites.splice(i,1);save();return false}d.favorites.push(qid);save();return true},
    isFav(qid){const d=load();return d.favorites.indexOf(qid)>=0},
    getFavs(){const d=load();return d.favorites.slice()},
    removeFav(qid){const d=load();d.favorites=d.favorites.filter(x=>x!==qid);save()},
    favCount(){const d=load();return d.favorites.length}
  };
})();
