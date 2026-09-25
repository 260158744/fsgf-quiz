/* ===== 激励体系 · 段位/XP/勋章 ===== */
const Gamify=(()=>{
  const TIERS=[
    {min:0,name:'青铜',max:499},
    {min:500,name:'白银',max:1499},
    {min:1500,name:'黄金',max:3499},
    {min:3500,name:'铂金',max:6999},
    {min:7000,name:'钻石',max:13999},
    {min:14000,name:'王者',max:Infinity}
  ];
  function level(xp){
    for(const t of TIERS){
      if(xp<=t.max){
        if(t.name==='王者') return {name:'王者',sub:'',display:'王者',progress:100,xpCur:xp,xpNext:null};
        const range=t.max-t.min+1,pos=xp-t.min,seg=Math.floor(range/3);
        const sub=pos<seg?'III':pos<seg*2?'II':'I';
        const segPos=pos%seg,prog=Math.round(segPos/seg*100);
        return {name:t.name,sub,display:t.name+' '+sub,progress:prog,xpCur:xp,xpNext:t.max+1};
      }
    }
    return {name:'王者',sub:'',display:'王者',progress:100,xpCur:xp,xpNext:null};
  }
  // XP规则
  function xpFor(ok,streak,qtype,isReview,firstFull,dailyDone){
    let xp=0;
    if(ok){
      xp+=10;
      if(streak>=2) xp+=2*streak;
      if(qtype==='案例分析题') xp+=5;
      if(isReview) xp+=5;
    }
    return xp;
  }
  // 勋章定义
  const BADGES=[
    {code:'FIRST_100',name:'首战告捷',desc:'完成第一次答题',ico:'🎯',xp:20},
    {code:'CONQUER_100',name:'攻克百题',desc:'累计答对100题',ico:'💯',xp:80},
    {code:'CONQUER_500',name:'攻克五百',desc:'累计答对500题',ico:'🏆',xp:200},
    {code:'STREAK_7',name:'坚持一周',desc:'连续打卡7天',ico:'📅',xp:50},
    {code:'STREAK_30',name:'月度坚持',desc:'连续打卡30天',ico:'🗓️',xp:200},
    {code:'PERFECT_STREAK',name:'完美连胜',desc:'连续答对20题',ico:'🔥',xp:150},
    {code:'ALL_UNITS',name:'全单元覆盖',desc:'17个单元均有作答',ico:'🗺️',xp:300},
    {code:'FIRST_FULL',name:'模考通关',desc:'全真模考正确率≥60%',ico:'🎖️',xp:50},
    {code:'EXAM_EXCEL',name:'模考优秀',desc:'全真模考正确率≥85%',ico:'🌟',xp:100},
    {code:'CONQUER_WEAK',name:'攻克薄弱',desc:'某维度从<40提升到≥60',ico:'📈',xp:25},
    {code:'NIGHT_OWL',name:'夜猫子',desc:'22:00-02:00完成学习',ico:'🦉',xp:30},
    {code:'SPEED_DEMON',name:'速度之星',desc:'单场均用时<30s且正确率>80%',ico:'⚡',xp:100},
    {code:'REVIEW_MASTER',name:'复习达人',desc:'复习答对累计30题',ico:'🔁',xp:60},
    {code:'EXPLORER',name:'探索者',desc:'完成所有4种练习模式',ico:'🧭',xp:80},
  ];
  // 检查并授予勋章
  function checkBadges(ctx){
    const earned=[];
    const records=DB.getRecords();
    const correct=records.filter(r=>r.ok).length;
    const total=records.length;
    const units=new Set(records.map(r=>r.u));
    const modes=new Set(DB.getSessions().map(s=>s.mode));
    const streak=DB.getStreak();
    const tryEarn=(code)=>{
      if(DB.earnBadge(code)){const b=BADGES.find(x=>x.code===code);if(b){DB.addXP(b.xp);earned.push(b)}}
    };
    if(total>=1) tryEarn('FIRST_100');
    if(correct>=100) tryEarn('CONQUER_100');
    if(correct>=500) tryEarn('CONQUER_500');
    if(streak>=7) tryEarn('STREAK_7');
    if(streak>=30) tryEarn('STREAK_30');
    if(ctx.maxStreak>=20) tryEarn('PERFECT_STREAK');
    if(units.size>=17) tryEarn('ALL_UNITS');
    if(ctx.examPass) tryEarn('FIRST_FULL');
    if(ctx.examExcellent) tryEarn('EXAM_EXCEL');
    if(ctx.weakConquered) tryEarn('CONQUER_WEAK');
    if(ctx.nightOwl) tryEarn('NIGHT_OWL');
    if(ctx.speedDemon) tryEarn('SPEED_DEMON');
    if(ctx.reviewCorrect>=30) tryEarn('REVIEW_MASTER');
    if(modes.size>=4) tryEarn('EXPLORER');
    return earned;
  }
  return {level,xpFor,BADGES,checkBadges};
})();

// ★ 顶层 const 不会成为 window 属性；显式挂载，
//   供其它模块的 `window.Gamify && ...` 兼容判断与内联 onclick 使用。
window.Gamify=Gamify;
