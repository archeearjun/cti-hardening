import {startCourseraLocalSupervisor, type CourseraSupervisorStatus} from './coursera-local-supervisor.ts';

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
  start(child: Window, courseUrl: string, token: string): void;
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
    start(nextChild, nextCourseUrl, token) {
      manager?.dispose();
      manager = null;
      child = nextChild;
      courseUrl = nextCourseUrl;
      command = '';
      status = null;
      manager = startCourseraLocalSupervisor(host, nextChild, nextCourseUrl, token, nextStatus => {
        status = {...nextStatus};
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
