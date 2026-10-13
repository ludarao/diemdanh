// One refresh scheduler for Realtime events, fallback polling and clock boundaries.
// Injecting the clock makes request rates and background behavior testable without sleeping.
export function createDashboardUpdater({refresh,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>{}}){
  let active=false,connected=false,inFlight=false,lastLoaded=-Infinity;
  let periodic=null,boundary=null,batch=null,pending=false,sessions=[],serverOffset=0;
  const clear=key=>{if(key!=null)clearTimer(key);};
  function clearTimers(){clear(periodic);clear(boundary);clear(batch);periodic=boundary=batch=null;}
  function schedulePeriodic(){
    clear(periodic);periodic=null;if(!active)return;
    const delay=connected?60000:15000;
    periodic=setTimer(()=>{periodic=null;requestRefresh();},delay);
  }
  function scheduleBoundary(){
    clear(boundary);boundary=null;if(!active)return;
    const serverNow=now()+serverOffset;
    const upcoming=sessions.filter(s=>s.state!=='cancelled').flatMap(s=>[
      Date.parse(s.opens_at),Date.parse(s.deadline_at)+1,Date.parse(s.accepts_until)
    ]).filter(t=>Number.isFinite(t)&&t>serverNow);
    if(!upcoming.length)return;
    const delay=Math.min(...upcoming)-serverNow;
    if(delay>2147483647)return;
    boundary=setTimer(()=>{boundary=null;requestRefresh();},Math.max(1,delay));
  }
  async function requestRefresh(){
    if(!active)return;
    if(inFlight){pending=true;return;}
    inFlight=true;pending=false;
    // A clock boundary or periodic check subsumes any event waiting in the batch.
    clear(batch);batch=null;
    try{await refresh();lastLoaded=now();}catch(error){onError(error);}
    finally{
      inFlight=false;
      if(active){schedulePeriodic();scheduleBoundary();if(pending)notifyChange();}
    }
  }
  function notifyChange(){
    pending=true;
    if(!active||batch!=null)return;
    // Coalesce a class arriving together; at most one event refresh per two seconds.
    const delay=Math.max(500,2000-(now()-lastLoaded));
    batch=setTimer(()=>{batch=null;requestRefresh();},delay);
  }
  return {
    resume({refreshNow=true}={}){
      if(active)return;active=true;
      if(refreshNow)requestRefresh();else{schedulePeriodic();scheduleBoundary();}
    },
    pause(){active=false;pending=false;clearTimers();},
    setRealtimeConnected(value){connected=!!value;schedulePeriodic();},
    loaded(nextSessions,serverTime){
      sessions=nextSessions||[];
      const server=Date.parse(serverTime);if(Number.isFinite(server))serverOffset=server-now();
      lastLoaded=now();schedulePeriodic();scheduleBoundary();
    },
    notifyChange,
    get active(){return active;}
  };
}

export function isRelevantDashboardChange(payload,{classId,day,sessionId}){
  const row=payload.new?.class_id?payload.new:payload.old;
  if(!row?.class_id||row.class_id!==classId)return false;
  if(payload.table==='sessions')return String(row.day||'').slice(0,10)===day;
  if(payload.table==='attendance_attempts'){
    if(!row.received_at)return false;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(row.received_at)).map(x=>[x.type,x.value]));
    const receivedDay=`${parts.year}-${parts.month}-${parts.day}`;
    // UPDATE can move a record away from the selected session. The old row may
    // contain only its primary key, so reload same-day updates conservatively.
    return receivedDay===day&&(payload.eventType==='UPDATE'||!sessionId||!row.session_id||row.session_id===sessionId);
  }
  return false;
}
