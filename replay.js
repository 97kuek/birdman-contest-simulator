import {pullupLog} from './pullup-data.js';
import {WEATHER} from './weather.js';
import {poseAt} from './flight.js';

const byId=id=>document.getElementById(id);
const windowSeconds=10;
const plotLeft=31, plotRight=306, plotTop=8, plotBottom=96;
const x=time=>plotLeft+(plotRight-plotLeft)*time/windowSeconds;
const signals=[
  {key:'height',label:'高度',unit:'m'},
  {key:'speed',label:'対気速度',unit:'m/s'},
  {key:'pitchDeg',label:'ピッチ',unit:'°'}
];

export function openingTrace(run){
  const end=Math.min(run.duration,windowSeconds);
  const samples=run.samples.filter(p=>p.t<end);
  samples.push(poseAt(run,end));
  return samples.map(s=>({t:s.t,height:s.bottomHeight,speed:s.speed,pitchDeg:s.pitch*180/Math.PI}));
}

function chart({key,label,unit},pilot,base,intervals){
  const values=[...pilot,...base,...pullupLog].map(p=>p[key]);
  const low=Math.floor(Math.min(...values)), high=Math.max(low+1,Math.ceil(Math.max(...values)));
  const y=value=>plotBottom-(plotBottom-plotTop)*(value-low)/(high-low);
  const bands=intervals.map(i=>{
    const side=i.direction===1?'aft':'forward';
    return '<rect class="band '+side+'" x="'+x(i.start)+'" y="'+plotTop+'" width="'+(x(Math.min(i.end,windowSeconds))-x(i.start))+'" height="'+(plotBottom-plotTop)+'"><title>'+inputText(i)+'</title></rect>';
  });
  const guides=[low,(low+high)/2,high].map(v=>'<path d="M'+plotLeft+' '+y(v)+'H'+plotRight+'"/><text x="26" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>');
  const ticks=[0,2,4,6,8,10].map(t=>'<text x="'+x(t)+'" y="113" text-anchor="middle">'+t+' s</text>');
  const line=(id,data)=>'<polyline class="'+id+'" points="'+data.map(p=>x(p.t).toFixed(2)+','+y(p[key]).toFixed(2)).join(' ')+'"/>';
  const dots=pullupLog.map(p=>'<circle cx="'+x(p.t)+'" cy="'+y(p[key])+'" r="1.9"/>');
  return '<figure><figcaption>'+label+'（'+unit+'）</figcaption><svg role="img" aria-label="離台後10秒の'+label+'" viewBox="0 0 318 120">'+
    bands.join('')+'<g class="grid">'+guides.join('')+ticks.join('')+'</g>'+line('manual-trace',pilot)+line('base-trace',base)+dots.join('')+
    '<line class="replay-cursor" x1="0" x2="0" y1="'+plotTop+'" y2="'+plotBottom+'"/></svg></figure>';
}

function inputText(interval){
  return (interval.direction===1?'後方':'前方')+' '+interval.start.toFixed(2)+'–'+interval.end.toFixed(2)+'秒';
}

export function setupReplay({showPose,onClose}){
  const panel=byId('replay-panel'), play=byId('replay-play'), seek=byId('replay-seek'), speed=byId('replay-speed');
  const compare=byId('replay-compare'), analysis=byId('replay-analysis');
  const rates=[1,2,0.5];
  let rateIndex=0, run=null, reference=null, time=0, last=0, playing=false, cursors=[];
  function setRate(index){
    rateIndex=index;
    speed.textContent=rates[index]+'×';
    speed.title='再生速度 '+rates[index]+'倍（押すと'+rates[(index+1)%rates.length]+'倍）';
    speed.setAttribute('aria-label',speed.title);
  }
  function buildComparison(){
    const pilot=openingTrace(run), base=openingTrace(reference);
    const intervals=run.inputs.filter(i=>i.start<windowSeconds);
    byId('replay-charts').innerHTML=signals.map(signal=>chart(signal,pilot,base,intervals)).join('');
    cursors=[...panel.querySelectorAll('.replay-cursor')];
    const summary=byId('replay-inputs');
    summary.replaceChildren(document.createTextNode('体重移動　'));
    for(const i of intervals){
      const tag=document.createElement('span');
      tag.className=i.direction===1?'aft':'forward';
      tag.textContent=inputText(i);
      summary.append(tag);
    }
    if(!intervals.length)summary.append('離台後10秒間の入力なし');
    for(const command of run.turnInputs.filter(i=>i.start<windowSeconds)){
      const tag=document.createElement('span');
      tag.textContent=(command.direction>0?'右ラダー ':'左ラダー ')+command.start.toFixed(2)+'–'+command.end.toFixed(2)+'秒';
      summary.append(tag);
    }
  }
  function showComparison(open){
    if(open && !cursors.length)buildComparison();
    analysis.hidden=!open;
    compare.setAttribute('aria-expanded',String(open));
  }
  compare.onclick=()=>{showComparison(analysis.hidden);display();};
  speed.onclick=()=>{
    tick(performance.now());
    setRate((rateIndex+1)%rates.length);
  };
  function display(){
    seek.value=String(time);
    byId('replay-time').textContent=time.toFixed(2)+' / '+run.duration.toFixed(2)+' s';
    if(!analysis.hidden)for(const cursor of cursors){
      cursor.style.display=time>windowSeconds?'none':'';
      cursor.setAttribute('transform','translate('+x(time)+' 0)');
    }
    showPose(poseAt(run,time));
    play.dataset.state=playing?'pause':time>=run.duration?'restart':'play';
    play.title=playing?'一時停止':time>=run.duration?'最初から再生':'再生';
    play.setAttribute('aria-label',play.title);
  }
  function tick(now){
    if(!playing || now<=last)return;
    if(!document.hidden)time=Math.min(run.duration,time+(now-last)*rates[rateIndex]/1000);
    last=now;
    if(time>=run.duration)playing=false;
    display();
  }
  document.addEventListener('visibilitychange',()=>{last=performance.now();});
  play.onclick=()=>{
    if(playing){tick(performance.now());playing=false;}
    else{if(time>=run.duration)time=0;last=performance.now();playing=true;}
    display();
  };
  seek.oninput=()=>{
    const selected=Number(seek.value);
    time=run.duration-selected<0.01 ? run.duration : selected;
    playing=false;
    display();
  };
  byId('replay-close').onclick=()=>{
    playing=false;run=null;reference=null;cursors=[];
    byId('replay-charts').replaceChildren();
    panel.hidden=true;onClose();
  };
  return {
    tick,
    get time(){return run?time:null;},
    open(record,baseline){
      reference=baseline;
      cursors=[];
      run=record.run;
      time=0;last=performance.now();playing=true;
      setRate(0);
      seek.max=String(run.duration);
      showComparison(false);
      byId('replay-log').open=false;
      byId('replay-title').textContent=record.label;
      byId('replay-condition').textContent=WEATHER[run.weather].label+' · 離台時の対地速度 '+run.launch.speed.toFixed(2)+' m/s';
      panel.hidden=false;
      display();
      play.focus({preventScroll:true});
    }
  };
}
