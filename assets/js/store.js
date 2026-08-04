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
    if(!cache.settings) cache.settings={theme:'light',dailyTarget:30,autoNext:false,examDate:null};
    if(!cache.reviewMap) cache.reviewMap={}; // qid -> {count,nextAt}
    if(!cache.seen) cache.seen=[]; // 最近7天答过的qid
    return cache;
  }
  function save(){localStorage.setItem(K(),JSON.stringify(cache))}
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
        const w=d.wrong[rec.qid]||{count:0,first:Date.now(),last:Date.now(),mastered:0,mastery:0,notes:''};
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
    }
  };
})();
