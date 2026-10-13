import {startCourseraLocalSupervisor, type CourseraSupervisorStatus} from './coursera-local-supervisor.ts';
import {parseCourseraShellUrl} from './coursera-background-extraction.ts';

type SupervisorManager = ReturnType<typeof startCourseraLocalSupervisor>;

export interface CourseraManagedSnapshot {
  child: Window | null;
  manager: SupervisorManager | null;
  command: string;
  courseUrl: string;
  status: CourseraSupervisorStatus | null;
}

export interface CourseraManagedRuntime {
  snapshot(): CourseraManagedSnapshot;
  start(child: Window, courseUrl: string, token: string, options?: {resumeExisting?:boolean}): void;
  setCommand(command: string): void;
  stop(): void;
  subscribe(listener: (snapshot: CourseraManagedSnapshot) => void): () => void;
}

// React subscribers may come and go while this browser window owns its run.
// A real page reload creates a new realm and still requires explicit recovery.
const runtimes = new WeakMap<Window, CourseraManagedRuntime>();

export function getCourseraManagedRuntime(host: Window): CourseraManagedRuntime {
  const existing = runtimes.get(host);
  if (existing) return existing;
  let child: Window | null = null;
  let manager: SupervisorManager | null = null;
  let command = '', courseUrl = '';
  let status: CourseraSupervisorStatus | null = null;
  const listeners = new Set<(snapshot: CourseraManagedSnapshot) => void>();
  const snapshot = (): CourseraManagedSnapshot => ({
    child, manager, command, courseUrl, status: status ? {...status} : null,
  });
  function notify(listener: (value: CourseraManagedSnapshot) => void) {
    // A failed UI observer must not interrupt controller acknowledgement.
    try { listener(snapshot()); } catch {}
  }
  function publish() { for (const listener of listeners) notify(listener); }
  const runtime: CourseraManagedRuntime = {
    snapshot,
    start(nextChild, nextCourseUrl, token, options = {}) {
      let savedProgress:Pick<CourseraSupervisorStatus,'completeItems'|'savedQuestions'>|null=null;
      if(options.resumeExisting===true && status?.state==='STOPPED'){
        try{
          if(parseCourseraShellUrl(courseUrl).courseId===parseCourseraShellUrl(nextCourseUrl).courseId)
            savedProgress={completeItems:status.completeItems,savedQuestions:status.savedQuestions};
        }catch{/* Invalid or different courses cannot supply saved counts. */}
      }
      manager?.dispose();
      manager = null;
      // A stopped managed popup is owned by this controller. Explicitly
      // replacing it should not leave another unused Coursera editor running.
      // Finished tabs retain their final download for the operator.
      if(child && child!==nextChild && status?.state==='STOPPED'){
        try{if(!child.closed)child.close();}catch{}
      }
      child = nextChild;
      courseUrl = nextCourseUrl;
      command = '';
      status = null;
      manager = startCourseraLocalSupervisor(host, nextChild, nextCourseUrl, token, nextStatus => {
        status = {...nextStatus};
        if(savedProgress){
          status.completeItems=Math.max(savedProgress.completeItems,status.completeItems);
          status.savedQuestions=Math.max(savedProgress.savedQuestions,status.savedQuestions);
        }
        publish();
      });
      publish();
    },
    setCommand(nextCommand) {
      command = nextCommand;
      publish();
    },
    stop() {
      manager?.dispose();
      manager = null;
      try { if (child && !child.closed) child.close(); } catch {}
      child = null;
      command = '';
      status = {
        recoveries: 0, failuresWithoutProgress: 0,
        completeItems: 0, savedQuestions: 0, count: '', note: '',
        ...status,
        state: 'STOPPED', phase: 'Capture stopped',
        message: 'Managed run stopped. Browser checkpoints remain available for resuming.',
      };
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      notify(listener);
      return () => { listeners.delete(listener); };
    },
  };
  runtimes.set(host, runtime);
  return runtime;
}
