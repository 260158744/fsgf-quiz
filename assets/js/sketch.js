/* ===== 屏幕草稿纸 · Canvas 手写画板 ===== */
const Sketch=(()=>{
  let canvas=null,ctx=null;
  let drawing=false;
  let strokes=[]; // [{points:[{x,y}],color,width}]
  let currentStroke=null;
  let color='#0e7c7b';
  let width=2;
  let visible=false;
  let history=[]; // 用于撤销

  function init(){
    if(canvas)return;
    canvas=document.getElementById('sketchCanvas');
    if(!canvas)return;
    ctx=canvas.getContext('2d');
    // 设置画布大小
    resize();
    window.addEventListener('resize',resize);
    // 绑定事件
    canvas.addEventListener('pointerdown',onDown);
    canvas.addEventListener('pointermove',onMove);
    canvas.addEventListener('pointerup',onUp);
    canvas.addEventListener('pointerleave',onUp);
    // 触摸事件阻止默认行为（防止滚动）
    canvas.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
    canvas.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  }

  function resize(){
    if(!canvas)return;
    const dpr=window.devicePixelRatio||1;
    const rect=canvas.getBoundingClientRect();
    canvas.width=rect.width*dpr;
    canvas.height=rect.height*dpr;
    ctx.scale(dpr,dpr);
    redraw();
  }

  function onDown(e){
    drawing=true;
    const pos=getPos(e);
    currentStroke={points:[pos],color,width};
    canvas.style.cursor='crosshair';
  }

  function onMove(e){
    if(!drawing||!currentStroke)return;
    const pos=getPos(e);
    currentStroke.points.push(pos);
    // 实时绘制
    ctx.strokeStyle=currentStroke.color;
    ctx.lineWidth=currentStroke.width;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    const pts=currentStroke.points;
    if(pts.length>=2){
      ctx.beginPath();
      ctx.moveTo(pts[pts.length-2].x,pts[pts.length-2].y);
      ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
      ctx.stroke();
    }
  }

  function onUp(){
    if(!drawing)return;
    drawing=false;
    if(currentStroke&&currentStroke.points.length>1){
      strokes.push(currentStroke);
    }
    currentStroke=null;
    canvas.style.cursor='';
  }

  function getPos(e){
    const rect=canvas.getBoundingClientRect();
    return{x:e.clientX-rect.left,y:e.clientY-rect.top};
  }

  function redraw(){
    if(!ctx)return;
    const rect=canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);
    for(const s of strokes){
      ctx.strokeStyle=s.color;
      ctx.lineWidth=s.width;
      ctx.lineCap='round';
      ctx.lineJoin='round';
      ctx.beginPath();
      for(let i=0;i<s.points.length;i++){
        const p=s.points[i];
        if(i===0)ctx.moveTo(p.x,p.y);
        else ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
    }
  }

  function undo(){
    if(strokes.length){
      history.push(strokes.pop());
      redraw();
    }
  }

  function clear(){
    strokes=[];history=[];
    redraw();
  }

  function setColor(c){color=c}
  function setWidth(w){width=w}

  function show(){
    init();
    if(!canvas)return;
    const panel=document.getElementById('sketchPanel');
    if(panel){
      panel.classList.add('show');
      visible=true;
      setTimeout(resize,100);
    }
  }

  function hide(){
    const panel=document.getElementById('sketchPanel');
    if(panel){
      panel.classList.remove('show');
      visible=false;
    }
  }

  function toggle(){
    if(visible)hide();
    else show();
    return visible;
  }

  function saveStrokes(qid){
    if(!strokes.length)return null;
    // 压缩存储：只保留关键点
    const compact=strokes.map(s=>({
      c:s.color,w:s.width,
      p:s.points.map(p=>[Math.round(p.x),Math.round(p.y)])
    }));
    return JSON.stringify(compact);
  }

  function loadStrokes(qid,json){
    try{
      const data=JSON.parse(json);
      strokes=data.map(d=>({
        color:d.c,width:d.w,
        points:d.p.map(p=>({x:p[0],y:p[1]}))
      }));
      redraw();
    }catch(e){}
  }

  return {init,show,hide,toggle,undo,clear,setColor,setWidth,saveStrokes,loadStrokes,resize};
})();
