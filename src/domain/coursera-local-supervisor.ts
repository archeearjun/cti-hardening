import {parseCourseraShellUrl} from './coursera-background-extraction.ts';

export interface CourseraSupervisorStatus {
  state:'WAITING'|'RUNNING'|'RECOVERING'|'FINISHED'|'STOPPED';
  message:string;
  recoveries:number;
  failuresWithoutProgress:number;
  completeItems:number;
  savedQuestions:number;
  phase:string;
  count:string;
  note:string;
}

// Own only the browser control link and small progress receipts. Coursera's
// authenticated content and checkpoint database remain in its own origin.
export function startCourseraLocalSupervisor(
  host:Window, child:Window, courseUrl:string, token:string,
  onStatus:(status:CourseraSupervisorStatus)=>void,
  options:{timeoutMs?:number;reconnectTimeoutMs?:number;intervalMs?:number;now?:()=>number}={},
) {
  const target=parseCourseraShellUrl(courseUrl);
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(token))throw Error('Invalid supervisor identifier.');
  const now=options.now || Date.now;
  let status:CourseraSupervisorStatus={state:'WAITING',message:'Paste the copied command in this Coursera tab’s Protocol monitor. Keep both tabs open.',
    recoveries:0,failuresWithoutProgress:0,completeItems:0,savedQuestions:0,phase:'Waiting for command',count:'',note:''};
  let lastHeard=0,paired=false,hidden=false,live=true,recoveryStartedAt:number|null=null;
  const questions=new Map<string,number>();
  function publish(){onStatus({...status});}
  function stop(message:string){status={...status,state:'STOPPED',message};dispose();publish();}
  function receive(event:MessageEvent){
    if(!live || event.source!==child)return;
    const data=event.data;
    if(data?.kind==='CTI_LOCAL_CAPTURE_OUTSIDE_COURSE_V1' && data.token===token && data.courseId===target.courseId && event.origin.startsWith('https://')){
      stop('The Coursera tab left the selected authoring course. Check sign-in or navigation before starting a new managed command.');return;
    }
    if(event.origin!=='https://www.coursera.org')return;
    if(!data || data.kind!=='CTI_LOCAL_CAPTURE_STATUS_V1' || data.token!==token || data.courseId!==target.courseId ||
      !['READY','HEARTBEAT','PROGRESS','YIELD','FINISHED','ERROR'].includes(data.event))return;
    paired=true;lastHeard=now();hidden=data.visibility==='hidden';
    if(data.event==='READY'){
      recoveryStartedAt=null;
      const retainedRecoveries=Number(data.recoveries);
      if(Number.isInteger(retainedRecoveries) && retainedRecoveries>=0 && retainedRecoveries<=30)
        status.recoveries=Math.max(status.recoveries,retainedRecoveries);
      try{child.postMessage({kind:'CTI_LOCAL_CAPTURE_ACK_V1',token,courseId:target.courseId,recoveries:status.recoveries},'https://www.coursera.org');}
      catch{stop('The Coursera controller connection could not be acknowledged. Keep saved checkpoints.');return;}
    }
    const complete=Number(data.completeItems),saved=Number(data.savedQuestions),id=String(data.itemId || '').slice(0,160);
    const courseSaved=Number(data.savedQuestionsTotal),hasCourseSaved=Number.isInteger(courseSaved) && courseSaved>=0 && courseSaved<=400000000;
    let advanced=false;
    if(Number.isInteger(complete) && complete>status.completeItems && complete<=20000){status.completeItems=complete;advanced=true;}
    if(hasCourseSaved && courseSaved>status.savedQuestions){status.savedQuestions=courseSaved;advanced=true;}
    if(id && Number.isInteger(saved) && saved>0 && saved<=20000 && saved>(questions.get(id) || 0)){
      if(!hasCourseSaved)status.savedQuestions+=saved-(questions.get(id)||0);
      questions.set(id,saved);advanced=true;
    }
    if(advanced)status.failuresWithoutProgress=0;
    status.note=String(data.note || '').slice(0,350);
    status.phase=String(data.phase || status.phase).slice(0,180);status.count=String(data.count || status.count).slice(0,300);
    if(data.event==='FINISHED'){
      status.state='FINISHED';status.message=data.complete===true?'Capture finished. The final JSON is available in Coursera.':'Capture finished with explicit evidence gaps. Check the final JSON in Coursera.';
      dispose();publish();return;
    }
    if(data.event==='ERROR'){stop('Coursera reported an extraction error. Saved checkpoints remain available. '+String(data.message || '').slice(0,250));return;}
    if(recoveryStartedAt!==null){publish();return;}
    status.state='RUNNING';status.message='Connected to Coursera. Recovery requires Chrome to retain the registered command.';publish();
  }
  function tick(){
    if(!live)return;
    if(child.closed){stop('The Coursera tab closed or the browser severed its connection. Keep checkpoints and use the regular local command.');return;}
    if(!paired)return; // Never navigate a login screen or an unstarted run.
    if(recoveryStartedAt!==null){
      const reconnectTimeout=options.reconnectTimeoutMs || (hidden?180000:60000);
      if(now()-recoveryStartedAt>=reconnectTimeout){
        status.phase='Extractor did not reconnect';
        stop('Coursera reopened, but the extractor did not reconnect. Chrome may have lost its registered command. '+status.savedQuestions+' saved question observations remain in browser checkpoints. Use Resume saved managed run to install a new command, or export saved progress.');
      }
      return;
    }
    const timeout=options.timeoutMs || (hidden?180000:45000);
    if(now()-lastHeard<timeout)return;
    if(status.failuresWithoutProgress>=3 || status.recoveries>=30){
      stop('Automatic recovery stopped after repeated failures. Export saved progress; this course needs investigation before another run.');return;
    }
    status.recoveries++;status.failuresWithoutProgress++;lastHeard=now();recoveryStartedAt=now();status.state='RECOVERING';
    status.message='Coursera stopped responding. Reopening the course and waiting for the registered extractor to reconnect (recovery '+status.recoveries+').' ;
    try{child.location.href=target.shellUrl;}catch{stop('Chrome blocked navigation of the Coursera tab. Use saved-progress export.');return;}
    publish();
  }
  function dispose(){if(!live)return;live=false;host.removeEventListener('message',receive);host.clearInterval(timer);}
  host.addEventListener('message',receive);
  const timer=host.setInterval(tick,options.intervalMs || 5000);
  publish();
  return {getStatus:()=>({...status}),dispose};
}
