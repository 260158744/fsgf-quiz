/* ===== 学情报告 · 雷达图/成长曲线/用时/高频错题 ===== */
const Report=(()=>{
  const UNITS=[
    ['一','人体断面影像解剖'],['二','医学物理基础'],['三','医学影像设备与成像原理'],
    ['四','对比剂'],['五','影像质量管理'],['六','数字X线成像基础'],
    ['七','影像诊断学基础'],['八','普通X线检查技术'],['九','CT检查技术'],
    ['十','MR检查技术'],['十一','DSA检查技术'],['十二','PACS技术'],
    ['十三','图像打印技术'],['十四','数字X线技术进展'],['十五','DSA技术进展'],
    ['十六','CT技术进展'],['十七','MR技术进展']
  ];
  const COGS=['记忆','理解','应用','分析'];
  const COLORS=['#0e7c7b','#d97706','#2563eb','#16a34a'];

  // 雷达图:按17单元的平均能力分
  function radarData(){
    const ab=DB.getAbility();
    const data=UNITS.map(([u,name])=>{
      let sum=0,n=0;
      for(const c of COGS){const a=ab[u+'|'+c];if(a&&a.attempts>0){sum+=a.score;n++}}
      return {u,name,score:n?sum/n:0,hasData:n>0};
    });
    return data;
  }
  function radarSVG(){
    const data=radarData();
    const cx=210,cy=210,R=150;
    const n=data.length;
    const pts=i=>{const a=-Math.PI/2+i*2*Math.PI/n;return [cx+R*Math.cos(a),cy+R*Math.sin(a)]};
    let grid='';
    for(const r of [0.25,0.5,0.75,1]){
      const poly=[];for(let i=0;i<n;i++){const[x,y]=pts(i);poly.push(`${cx+(x-cx)*r},${cy+(y-cy)*r}`)}
      grid+=`<polygon points="${poly.join(' ')}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
    }
    let axes='',labels='';
    for(let i=0;i<n;i++){
      const[x,y]=pts(i);
      axes+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
      const lx=cx+(x-cx)*1.15,ly=cy+(y-cy)*1.15;
      labels+=`<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="var(--text-2)">${data[i].u}</text>`;
    }
    const poly=[];const dots='';
    let polyStr='';
    let dotsStr='';
    data.forEach((d,i)=>{
      const r=(d.score/100)*1;const[x,y]=pts(i);
      const px=cx+(x-cx)*r,py=cy+(y-cy)*r;
      polyStr+=(i?',':'')+px+','+py;
      dotsStr+=`<circle cx="${px}" cy="${py}" r="3" fill="${d.score<40?'#dc2626':d.score<60?'#ca8a04':'#0e7c7b'}"/>`;
    });
    const avg=data.filter(d=>d.hasData).reduce((s,d)=>s+d.score,0)/(data.filter(d=>d.hasData).length||1);
    return {svg:`<svg class="radar-svg" viewBox="0 0 420 420">
      ${grid}${axes}
      <polygon points="${polyStr}" fill="rgba(14,124,123,.15)" stroke="#0e7c7b" stroke-width="2"/>
      ${dotsStr}
      ${labels}
      <text x="210" y="20" text-anchor="middle" font-size="12" fill="var(--text)" font-weight="700">综合能力 ${Math.round(avg)}/100</text>
    </svg>`,data,avg};
  }
  // 成长曲线:近30天每日正确率
  function growthData(days=30){
    const recs=DB.getRecords();
    const map={};
    const now=Date.now();
    for(const r of recs){
      const t=new Date(r.at).getTime();
      if(now-t>days*86400000)continue;
      const d=r.at.slice(0,10);
      if(!map[d])map[d]={total:0,correct:0};
      map[d].total++;if(r.ok)map[d].correct++;
    }
    const out=[];for(let i=days-1;i>=0;i--){
      const d=new Date(now-i*86400000).toISOString().slice(0,10);
      const m=map[d]||{total:0,correct:0};
      out.push({date:d.slice(5),acc:m.total?Math.round(m.correct/m.total*100):null,total:m.total});
    }
    return out;
  }
  function growthSVG(){
    const data=growthData(30);
    const W=600,H=200,P=30;
    const hasData=data.filter(d=>d.acc!==null);
    if(!hasData.length)return {svg:`<div class="empty-state"><div class="es-ico">📈</div>暂无数据，开始答题后这里会显示你的成长曲线</div>`,data};
    const pts=data.map((d,i)=>{
      const x=P+i*(W-2*P)/(data.length-1);
      const y=d.acc===null?null:H-P-(d.acc/100*(H-2*P));
      return {x,y,d};
    });
    let path='';let area='';
    let first=true;
    for(const p of pts){if(p.y===null){first=true;continue}path+=(first?'M':'L')+p.x+','+p.y;first=false}
    const valid=pts.filter(p=>p.y!==null);
    area=`M${valid[0].x},${H-P} L${valid.map(p=>p.x+','+p.y).join(' L')} L${valid[valid.length-1].x},${H-P} Z`;
    let grid='';
    for(const v of [0,50,100]){
      const y=H-P-(v/100*(H-2*P));
      grid+=`<line x1="${P}" y1="${y}" x2="${W-P}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/><text x="${P-6}" y="${y+3}" text-anchor="end" font-size="9" fill="var(--text-3)">${v}</text>`;
    }
    const dots=valid.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#0e7c7b"/>`).join('');
    const avg7=valid.slice(-7).reduce((s,p)=>s+p.d.acc,0)/Math.min(7,valid.length);
    return {svg:`<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${grid}<path d="${area}" fill="rgba(14,124,123,.1)"/><path d="${path}" fill="none" stroke="#0e7c7b" stroke-width="2"/>${dots}</svg>`,avg7:Math.round(avg7),data};
  }
  // 各认知维度正确率
  function cogStats(){
    const recs=DB.getRecords();const map={};
    for(const c of COGS)map[c]={total:0,correct:0};
    for(const r of recs){map[r.c].total++;if(r.ok)map[r.c].correct++}
    return COGS.map(c=>({c,...map[c],acc:map[c].total?Math.round(map[c].correct/map[c].total*100):0}));
  }
  // 高频错题
  function topWrong(n=10){
    const wrong=DB.getWrong();const Q=window.QUESTIONS;
    const arr=Object.entries(wrong).filter(([k,w])=>!w.mastered).map(([id,w])=>{
      const q=Q.find(x=>x.id===id);return q?{q,w}:null;
    }).filter(Boolean).sort((a,b)=>b.w.count-a.w.count).slice(0,n);
    return arr;
  }
  // 薄弱点
  function weakList(){
    const ab=DB.getAbility();const out=[];
    for(const k in ab){const a=ab[k];if(a.attempts>=3){const[u,c]=k.split('|');out.push({u,c,score:a.score,att:a.attempts})}}
    out.sort((a,b)=>a.score-b.score);return out.slice(0,8);
  }
  return {radarSVG,growthSVG,cogStats,topWrong,weakList,radarData};
})();

// ★ 顶层 const 不会成为 window 属性；显式挂载，
//   供其它模块的 `window.Report && ...` 兼容判断与内联 onclick 使用。
window.Report=Report;
