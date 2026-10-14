import { useEffect, useMemo, useRef, useState } from "react";
import {type CourseraSupervisorStatus} from '../src/domain/coursera-local-supervisor.ts';
import {getCourseraManagedRuntime} from '../src/domain/coursera-managed-runtime.ts';
import {createCourseraAssessmentProbeScript} from '../src/domain/coursera-assessment-probe.ts';
import {createCourseraResponseSampleScript} from '../src/domain/coursera-response-sample.ts';
import { parseCourseraShellUrl } from "../src/domain/coursera-background-extraction.ts";
import {
  inspectLocalCourseraCaptureFile,
  readLocalCourseraCaptureFile,
  createSavedCourseraResumeScript,
  createAutomaticLocalCourseraCommand,
  createSavedCourseraCheckpointExportCommand,
  type LocalCourseraCaptureInspection,
} from "../src/domain/coursera-local-extraction.ts";
import type { ExtractorDelivery } from "../src/domain/types.ts";
import { download } from "./workspace-ui";
import CourseraBookmarkSetup from "./CourseraBookmarkSetup.tsx";
import CourseraDirectCaptureSetup from "./CourseraDirectCaptureSetup.tsx";

function captureDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

export default function LocalCourseraExtraction({
  disabled = false,
  onUseCapture,
  initialUrl = "",
  onUrlChange,
  captureInputId = "local-coursera-capture",
}: {
  disabled?: boolean;
  onUseCapture?: (file: File) => void;
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
  captureInputId?: string;
}) {
  const managedRuntime=getCourseraManagedRuntime(window);
  const retainedManaged=managedRuntime.snapshot();
  const retainedActive=retainedManaged.status && ['WAITING','RUNNING','RECOVERING'].includes(retainedManaged.status.state);
  const [shellUrl, setShellUrl] = useState(retainedActive?retainedManaged.courseUrl:initialUrl);
  const [extractor, setExtractor] = useState<ExtractorDelivery | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [capture, setCapture] = useState<File | null>(null);
  const [inspection, setInspection] =
    useState<LocalCourseraCaptureInspection | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resumeSource, setResumeSource] = useState("");
  const [reviewSummarySource, setReviewSummarySource] = useState("");
  const [automaticCommand, setAutomaticCommand] = useState("");
  const [managedCommand,setManagedCommand]=useState(retainedManaged.command);
  const [managedFresh,setManagedFresh]=useState(false);
  const [legacyExpanded,setLegacyExpanded]=useState(Boolean(retainedActive));
  const [responseSampleSource,setResponseSampleSource]=useState('');
  const [managedStatus,setManagedStatus]=useState<CourseraSupervisorStatus|null>(retainedManaged.status);
  const managedTab=useRef<Window|null>(retainedManaged.child);
  const managedActive=!!managedStatus && ['WAITING','RUNNING','RECOVERING'].includes(managedStatus.state);

  useEffect(()=>managedRuntime.subscribe(saved=>{
    managedTab.current=saved.child;
    setManagedStatus(saved.status);setManagedCommand(saved.command);
    if(saved.courseUrl && saved.status && ['WAITING','RUNNING','RECOVERING'].includes(saved.status.state))
      setShellUrl(saved.courseUrl);
  }),[managedRuntime]);

  useEffect(() => {
    const state=managedRuntime.snapshot().status?.state;
    if (initialUrl && !['WAITING','RUNNING','RECOVERING'].includes(state || '')) setShellUrl(initialUrl);
  }, [initialUrl,managedRuntime]);

  const shellTarget = useMemo(() => {
    if (!shellUrl.trim()) return null;
    try {
      return parseCourseraShellUrl(shellUrl);
    } catch {
      return null;
    }
  }, [shellUrl]);

  const resumeRecommended = useMemo(()=>{
    if(managedStatus?.state!=='STOPPED' || managedStatus.phase!=='Extractor did not reconnect' || !shellTarget)return false;
    try{return parseCourseraShellUrl(retainedManaged.courseUrl).courseId===shellTarget.courseId;}catch{return false;}
  },[managedStatus,shellTarget,retainedManaged.courseUrl]);

  const directCapture = inspection?.captureMode === "BOUND_AUTHORING_DRAFT_API";
  const legacyResumeAvailable = !directCapture && inspection?.resumeAvailable;
  const reasons = inspection?.verdict.reasons || [];
  const courseMismatch = reasons.some((reason) =>
    reason.startsWith("COURSE_ID_MISMATCH:"),
  );

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function currentExtractor() {
    if (extractor) return extractor;
    const { getExtractor } = await import("../src/domain/capture-review.ts");
    const next = getExtractor("coursera");
    setExtractor(next);
    return next;
  }

  async function copyAutomaticCommand(freshRun = false, resumeExisting = false) {
    await act(resumeExisting ? "Preparing saved-run recovery" : freshRun ? "Preparing fresh full-course capture" : "Preparing automatic local capture", async () => {
      const current = await currentExtractor();
      const command = createAutomaticLocalCourseraCommand(shellUrl, current.script,
        crypto.randomUUID(), !freshRun && !resumeExisting && capture && inspection?.resumeAvailable ?
          await readLocalCourseraCaptureFile(capture) : undefined, { freshRun, resumeExisting });
      setAutomaticCommand(command);
      try {
        await navigator.clipboard.writeText(command);
        setCopyStatus(current.version + (resumeExisting ?
          " saved-run recovery command copied. In the matching Coursera tab’s Protocol monitor, select Main (the Coursera URL), then paste into its command input. This preserves the stopped run's checkpoint session and limits." : freshRun ?
          " fresh full-course command copied. Close DevTools, refresh Coursera, reopen Protocol monitor, select Main (the Coursera URL), paste into its bottom command input and press Enter. Keep DevTools open for automatic capture." :
          " automatic command copied. In Protocol monitor, select Main (the Coursera URL), paste into its bottom command input, press Enter, and keep DevTools open."));
      } catch {
        setCopyStatus(freshRun ?
          "Select and copy the full command below. Close DevTools, refresh Coursera, reopen Protocol monitor and paste into its bottom command input." :
          "Select the full automatic command in the fallback below, copy it, and paste into Protocol monitor.");
      }
    });
  }

  async function copySavedProgressCommand(consoleOnly=false) {
    await act("Preparing saved-progress export", async () => {
      const current = await currentExtractor();
      const protocolCommand = createSavedCourseraCheckpointExportCommand(shellUrl, current.script);
      const command=consoleOnly?JSON.parse(protocolCommand).args.expression:protocolCommand;
      setAutomaticCommand(command);
      try {
        await navigator.clipboard.writeText(command);
        setCopyStatus(consoleOnly?"Saved-progress Console script copied. Stop the managed run, then paste into the normal Console of the matching Coursera tab. It exports saved checkpoints without opening quizzes.":"Saved-progress export command copied. Close DevTools, reload the matching Coursera authoring shell, reopen Protocol monitor, turn Record off, clear its log and paste into the bottom command input. This exports saved observations without opening item editors.");
      } catch {
        setCopyStatus(consoleOnly?"Copy the complete script below and paste into the matching Coursera tab’s normal Console. This reads saved checkpoints without opening quizzes.":"Copy the complete command below. Close DevTools, reload Coursera and paste into Protocol monitor with Record off to export saved progress.");
      }
    });
  }

  async function copyCurrentQuizCheck(){
    await act('Preparing current quiz API check',async()=>{
      const current=await currentExtractor();
      const source=createCourseraAssessmentProbeScript(shellUrl,current.script);
      setAutomaticCommand(source);
      try{
        await navigator.clipboard.writeText(source);
        setCopyStatus('Current quiz API check copied. Stop the managed run, open one quiz normally, and paste into its normal Console. This check runs for up to two minutes and makes no question clicks or page reloads. Copy its diagnostic result when it finishes.');
      }catch{
        setCopyStatus('Copy the complete quiz-check script below. Paste into the normal Console of one open quiz in this course, with the full extractor stopped.');
      }
    });
  }

  async function copyResponseSample(){
    await act('Preparing one-quiz data check',async()=>{
      const source=createCourseraResponseSampleScript(shellUrl);setResponseSampleSource(source);
      try{await navigator.clipboard.writeText(source);setCopyStatus('Data-check script copied. Close DevTools, refresh the Coursera Content page, reopen Console and paste once. Open one quiz normally, then click Download response sample in Coursera.');}
      catch{setCopyStatus('Select and copy the complete data-check script below. Paste into Coursera Console after ending the earlier extractor registration.');}
    });
  }

  function openManagedCapture(resumeExisting=false){
    if(!shellTarget || managedActive)return;
    // Open synchronously from the click so Chrome's popup policy can allow it.
    const token=crypto.randomUUID(),child=window.open(shellTarget.shellUrl,'cti-local-'+token);
    if(!child){setError('Chrome blocked the Coursera tab. Allow this CTI site to open it, then try again.');return;}
    managedRuntime.start(child,shellUrl,token,{resumeExisting});
    if(resumeExisting)setManagedFresh(false);
    void act('Preparing managed capture',async()=>{
      try{
        const current=await currentExtractor();
        const command=createAutomaticLocalCourseraCommand(shellUrl,current.script,token,
          !resumeExisting && !managedFresh && capture && inspection?.resumeAvailable?await readLocalCourseraCaptureFile(capture):undefined,
          {controllerOrigin:window.location.origin,freshRun:!resumeExisting && managedFresh,resumeExisting});
        managedRuntime.setCommand(command);setAutomaticCommand(command);
        setCopyStatus(current.version+' managed command ready. Click Copy managed capture command, then in the Coursera tab’s Protocol monitor select Main (the Coursera URL) and paste into its command input. Keep this Extract page and Coursera DevTools open.');
      }catch(error){managedRuntime.stop();throw error;}
    });
  }

  async function copyManagedCommand(){
    await act('Copying managed command',async()=>{
      setAutomaticCommand(managedCommand);
      try{await navigator.clipboard.writeText(managedCommand);setCopyStatus('Managed command copied. In the Coursera tab opened by CTI, select Main (the Coursera URL) in Protocol monitor’s target dropdown. Tab () cannot run this Page command. Turn Record off, clear the log, paste into the bottom command input and press Enter. Keep both tabs and Coursera DevTools open.');}
      catch{setCopyStatus('Select and copy the complete managed command below, then paste into the managed Coursera tab’s Protocol monitor.');}
    });
  }

  function stopManagedCapture(){
    managedRuntime.stop();
  }

  const openManagedButton=<button className={resumeRecommended?'secondary':undefined}
    disabled={disabled || !!busy || !shellTarget || managedActive} onClick={()=>openManagedCapture()}>
    Open managed Coursera tab
  </button>;
  const resumeManagedButton=<button className={resumeRecommended?undefined:'secondary'}
    disabled={disabled || !!busy || !shellTarget || managedActive} onClick={()=>openManagedCapture(true)}>
    Resume saved managed run
  </button>;

  return (
    <section className="card local-extraction-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ZERO-COST CAPTURE</p>
          <h2>Extract Coursera in your own Chrome</h2>
          <p>
            Save CTI’s bookmark once, then run it from any signed-in Coursera
            authoring Content page. It reads course data directly and prepares
            one final JSON.
          </p>
        </div>
        <span className="badge">No extension · no fees</span>
      </div>

      <CourseraDirectCaptureSetup disabled={disabled || !!busy || managedActive} />

      <label>
        Coursera authoring-shell URL
        <input
          type="url"
          value={shellUrl}
          disabled={disabled || !!busy || managedActive}
          aria-invalid={!!shellUrl.trim() && !shellTarget}
          onChange={(event) => {
            const value = event.target.value;
            setResponseSampleSource('');
            setShellUrl(value);
            onUrlChange?.(value);
            setInspection(null);
            setCapture(null);
            setResumeSource("");
            setReviewSummarySource("");
            setAutomaticCommand("");
            setCopyStatus("");
          }}
          placeholder="https://www.coursera.org/teach/.../.../content/edit"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        The bookmark gets the course identity from Coursera. This optional URL
        checks the downloaded JSON against the intended course before Compare.
        If left empty, CTI uses the course identity recorded in your file.
      </p>
      {!shellTarget && shellUrl.trim() && (
        <p className="hint" role="alert">
          Enter a valid Coursera authoring URL containing
          <code> /teach/&lt;course&gt;/&lt;course-id&gt;/content </code>
          to bind the downloaded file check, or leave this field empty.
        </p>
      )}
      <details className="section-divider legacy-local-extraction"
        open={managedActive || legacyExpanded}
        onToggle={event=>setLegacyExpanded(event.currentTarget.open)}>
        <summary>Legacy editor capture and diagnostics</summary>
      <div className="section-divider managed-local-capture">
        <h3>Managed capture in local Chrome</h3>
        <p>CTI stays open as the controller while Coursera captures the course.
          Supported quizzes use direct question-definition reads after opening the editor once.
          CTI checks the full question inventory and keys before accepting that capture.
          It can reopen an unresponsive Coursera tab. Saved work resumes only if Chrome retains the registered command.
          CTI stops recovery if the extractor does not reconnect. Keep the connection between these tabs open.</p>
        <p className="hint">Close any earlier extraction tab first. Open the managed tab here,
          copy its command, select <strong>Main (the Coursera URL)</strong> in Protocol monitor’s target dropdown,
          and paste once with Record off and the log cleared. <strong>Tab ()</strong> cannot run the Page command.
          Keep this Extract page and Coursera DevTools open.</p>
        <label><input type="checkbox" checked={managedFresh} disabled={disabled || !!busy || managedActive}
          onChange={event=>setManagedFresh(event.target.checked)} /> Fresh full-course managed run</label>
        <p className="hint">Use <strong>Resume saved managed run</strong> after a lost connection.
          It preserves that run's checkpoint session and progress. A fresh run starts separate work.</p>
        {resumeRecommended && <p className="notice">The extractor did not start in Coursera’s reopened document.
          Resume the saved run to continue its checkpoints. CTI will close the stopped managed tab when it opens the replacement.</p>}
        <div className="action-links">
          {resumeRecommended?<>{resumeManagedButton}{openManagedButton}</>:<>{openManagedButton}{resumeManagedButton}</>}
          <button className="secondary" disabled={disabled || !!busy || !managedActive || !managedCommand} onClick={()=>void copyManagedCommand()}>
            Copy managed capture command
          </button>
          {managedActive && <button className="secondary" onClick={()=>managedTab.current?.focus()}>Show managed Coursera tab</button>}
          {managedActive && <button className="secondary" onClick={stopManagedCapture}>Stop managed run</button>}
        </div>
        {managedStatus && <div role="status" aria-live="polite" className="notice">
          <strong>{managedStatus.state==='RECOVERING'?'Recovering Coursera':managedStatus.phase}</strong>
          <p>{managedStatus.message}</p>
          {managedStatus.note && <p>{managedStatus.note}</p>}
          <p>{managedStatus.count || (managedStatus.completeItems+' items complete · '+managedStatus.savedQuestions+' question observations saved')} · {managedStatus.recoveries} automatic recoveries</p>
        </div>}
      </div>

      <div className="section-divider">
        <h3>Check one open quiz</h3>
        <p>Verify direct question reads before another full-course run. Stop the managed run,
          open one quiz normally in Coursera, and paste this check into its normal Console.
          It runs for up to two minutes without question clicks or reloads.
          Copy its small diagnostic result afterward; this is not a course capture.</p>
        <button className="secondary" disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={()=>void copyCurrentQuizCheck()}>Copy current quiz API check</button>
      </div>

      <details className="section-divider">
        <summary>Diagnostic one-quiz response sample</summary>
        <p>Use this when a full capture takes too long. It saves the quiz responses
          Coursera already receives, so we can check whether full questions and keys
          can be captured without opening each question.</p>
        <p className="hint">Close DevTools, refresh the Coursera Content page, reopen Console
          and paste this script once. Open one quiz normally, then click
          <strong> Download response sample</strong> in Coursera. This is a diagnostic sample.
          It stays local and does not start a full-course run.</p>
        <button className="secondary" disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={()=>void copyResponseSample()}>Copy one-quiz data check</button>
        {responseSampleSource && <details className="scope">
          <summary>Data-check script copy fallback</summary>
          <p className="hint">Select all of this script and paste into Coursera Console.</p>
          <textarea className="extractor-source" aria-label="One-quiz data-check script"
            readOnly value={responseSampleSource} onFocus={event=>event.currentTarget.select()} />
        </details>}
      </details>


      <h3>Standalone local capture</h3>
      <ol className="local-extraction-steps">
        <li>
          <strong>Open the authoring shell in normal Chrome.</strong>
          <span>Use the Chrome profile where Coursera/Okta already works.</span>
        </li>
        <li>
          <strong>Enable Protocol monitor once in Chrome.</strong>
          <span>
            In the Coursera tab, open DevTools → Settings → Experiments →
            Protocol Monitor. Reopen DevTools, then use its command menu
            (Ctrl+Shift+P; Mac: Command+Shift+P) to show Protocol monitor.
            Turn off Preserve log in Console and Network. This is built into
            Chrome; no extension or software install.
          </span>
        </li>
        <li>
          <strong>Copy the automatic local capture command.</strong>
          <span>
            In Protocol monitor, turn Record off and clear its log to avoid
            retaining browser traffic. Select the Coursera page in its target
            dropdown. Paste the command into the command input
            at the bottom and press Enter once. Keep that tab and DevTools open.
            Paste this command in Protocol monitor, not Console.
            A CTI progress card should appear in Coursera. If it does not,
            refresh Coursera once with DevTools open and check that the course
            matches the URL entered here.
          </span>
        </li>
        <li>
          <strong>Return the downloaded JSON to CTI.</strong>
          <span>
            CTI independently applies the strict no-silent-miss completion gate.
          </span>
        </li>
      </ol>
      <p className="hint">
        CTI checkpoints each item and reloads between short renderer batches.
        Quizzes without a complete supported API model use the editor fallback and
        pause at saved question boundaries, so one large
        item can continue across several reloads. It restores saved work
        without intermediate downloads or repeated pastes. Large assessments
        also save identified question observations during collection. The
        progress card shows the active item and its question count; a course
        visit finishes after the whole item has been read. A managed run keeps
        recovery in the CTI tab while DevTools stays attached. For a standalone
        run that shows “Aw, Snap!”, close DevTools and reload the authoring shell.
        Export saved progress first, then use the regular automatic command to
        resume. Reopen Protocol monitor with Record off and clear its log before
        pasting. Closing DevTools also requires a new command.
        {" "}<a href="https://developer.chrome.com/docs/devtools/protocol-monitor"
          target="_blank" rel="noopener noreferrer">Chrome's official instructions ↗</a>
      </p>

      <div className="action-links">
        {shellTarget ? (
          <a
            className="button-link secondary"
            href={shellTarget.shellUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Coursera authoring shell ↗
          </a>
        ) : (
          <button className="secondary" disabled>
            Open Coursera authoring shell
          </button>
        )}
        <button
          className="primary"
          disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() => void copyAutomaticCommand()}
        >
          {capture && inspection?.resumeAvailable ? "Copy automatic resume command" : "Copy automatic local capture command"}
        </button>
        <button
          className="secondary"
          disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() => void copyAutomaticCommand(true)}
        >
          Copy fresh full-course command
        </button>
        <button className="secondary" disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={()=>void copyAutomaticCommand(false,true)}>
          Copy saved-run recovery command
        </button>
        <button className="secondary" disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() => void copySavedProgressCommand()}>
          Copy saved-progress export command
        </button>
        <button className="secondary" disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() => void copySavedProgressCommand(true)}>
          Copy saved-progress Console script
        </button>
      </div>
      <p className="hint">
        To test the whole course again, use <strong>Copy fresh full-course command</strong>.
        It collects new observations without importing your selected JSON or
        earlier checkpoints, then continues its own progress across automatic
        reloads. Before pasting, close DevTools, refresh Coursera and reopen
        Protocol monitor to end any earlier registration. Keep your previous
        JSON files for comparison.
      </p>
      <p className="hint">
        After a crash, <strong>Copy saved-progress Console script</strong> runs in the refreshed Coursera tab’s normal Console and recovers
        this course's saved item and question observations into a JSON without
        opening editors. It keeps checkpoints available for the regular resume
        command. A saved-progress export shows unfinished items explicitly.
      </p>
      <details className="scope">
        <summary>Manual Console capture (requires reloads between batches)</summary>
      <div className="action-links">
        <button
          className="secondary"
          disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() =>
            void act("Preparing local extractor", async () => {
              const current = await currentExtractor();
              try {
                await navigator.clipboard.writeText(current.script);
                setCopyStatus(
                  current.version +
                    " copied. Paste in Coursera's DevTools Console, keep that tab open, and follow the reload instructions between batches.",
                );
              } catch {
                setCopyStatus(
                  "Clipboard access is unavailable. Download the extractor or expand the manual-copy fallback.",
                );
              }
            })
          }
        >
          Copy current Coursera extractor
        </button>
        <button
          className="secondary"
          disabled={disabled || !!busy || !shellTarget || managedActive}
          onClick={() =>
            void act("Preparing local extractor", async () => {
              const current = await currentExtractor();
              download(
                "CTI-coursera-" + current.version + ".js",
                current.script,
                "text/javascript",
              );
              setCopyStatus(current.version + " downloaded.");
            })
          }
        >
          Download extractor
        </button>
      </div>
      </details>

      {copyStatus && (
        <p className="success-notice" role="status">
          {copyStatus}
        </p>
      )}
      {automaticCommand && (
        <details className="scope">
          <summary>Automatic command copy fallback</summary>
          <p className="hint">Click inside, then Ctrl+A and Ctrl+C (Mac: Command+A and Command+C). Paste into Protocol monitor's command input.</p>
          <textarea className="extractor-source" aria-label="Automatic local capture command"
            readOnly value={automaticCommand} onFocus={event => event.currentTarget.select()} />
        </details>
      )}

      {extractor && (
        <details className="scope">
          <summary>Manual-copy fallback</summary>
          <p className="hint">
            This is the same generated {extractor.version} program. Use this
            only when clipboard permissions block the Copy button.
          </p>
          <textarea
            className="extractor-source"
            aria-label="Current Coursera extractor source"
            readOnly
            value={extractor.script}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}

      </details>

      <details className="section-divider">
        <summary>Diagnostic bookmark course data check</summary>
        <CourseraBookmarkSetup disabled={disabled || !!busy || managedActive} />
      </details>

      <div className="section-divider">
        <h3>Check the downloaded capture</h3>
        <label className="file-picker" htmlFor={captureInputId}>
          <span className="file-icon" aria-hidden="true">
            ↥
          </span>
          <strong>
            {capture
              ? capture.name
              : "Choose the Coursera JSON or .json.gz downloaded by the extractor"}
          </strong>
          <span id={captureInputId + "-help"}>
            {capture
              ? (capture.size / 1024 / 1024).toFixed(2) + " MiB"
              : shellTarget
                ? "Inspection happens in this browser before the file enters Compare."
                : "Choose your saved JSON. CTI can fill the authoring URL from its recorded course identity."}
          </span>
        </label>
        <input
          id={captureInputId}
          className="visually-hidden-file"
          type="file"
          accept=".json,.json.gz,application/json,application/gzip"
          disabled={disabled || !!busy}
          aria-describedby={captureInputId + "-help"}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            setCapture(file);
            setInspection(null);
            setResumeSource("");
            setReviewSummarySource("");
            setCopyStatus("");
            setError("");
            setNotice("");
            if (file)
              void act("Checking local Coursera capture", async () => {
                const checked = await inspectLocalCourseraCaptureFile(
                  file,
                  shellUrl,
                );
                if (!shellUrl.trim() && checked.authoringShellUrl) {
                  setShellUrl(checked.authoringShellUrl);
                  onUrlChange?.(checked.authoringShellUrl);
                }
                setInspection(checked);
                setNotice(
                  checked.verdict.complete
                    ? "Local capture passed CTI's strict no-miss completion gate."
                    : checked.pausedBatch
                      ? "This batch saved your progress. Resume from this JSON to capture the remaining items."
                      : "Local capture is usable evidence, but required evidence remains unresolved.",
                );
              });
          }}
        />
      </div>

      {error && (
        <div role="alert" className="error">
          <strong>Could not complete this step</strong>
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}

      {inspection && (
        <>
          <div className="metric-grid portfolio-counts">
            <div>
              <strong>{inspection.verdict.inventoryCount}</strong>
              <span>Inventory items</span>
            </div>
            <div>
              <strong>{inspection.verdict.completeCount}</strong>
              <span>Fully complete</span>
            </div>
            <div>
              <strong>{inspection.verdict.unresolvedCount}</strong>
              <span>Unresolved</span>
            </div>
            <div>
              <strong>{inspection.verdict.unvisitedCount}</strong>
              <span>Unvisited</span>
            </div>
          </div>

          {inspection.directSummary && (
            <div className="scope direct-capture-summary">
              <p>
                <strong>
                  {inspection.directSummary.coverage.inventory.read}/
                  {inspection.directSummary.coverage.inventory.total} inventory
                  {inspection.directSummary.mediaContinuation ? " entries retained" : " entries read"}
                </strong>
                {" · "}
                {inspection.directSummary.coverage.content.verified}/
                {inspection.directSummary.coverage.content.total} content items
                fully verified
              </p>
              <ul>
                <li>
                  Assessments: {inspection.directSummary.coverage.assessments.verified}/
                  {inspection.directSummary.coverage.assessments.total} verified
                  {" · "}{inspection.directSummary.coverage.questions.toLocaleString()} questions
                </li>
                <li>
                  Readings: {inspection.directSummary.coverage.readings.verified}/
                  {inspection.directSummary.coverage.readings.total} verified
                  {inspection.directSummary.coverage.readingMedia.items > 0 &&
                    " · " + inspection.directSummary.coverage.readingMedia.items +
                    " readings with media references"}
                </li>
                <li>
                  External widgets: {inspection.directSummary.coverage.widgets.verified}/
                  {inspection.directSummary.coverage.widgets.total} verified
                  {" · "}{inspection.directSummary.coverage.structures.verified} empty
                  structures accounted for separately
                </li>
              </ul>
              {inspection.directSummary.mediaContinuation && (
                <p className="hint">
                  Reading-media continuation. Inventory counts include saved
                  observations from the earlier capture.
                  {inspection.directSummary.mediaContinuation.retainedAssessmentObservations &&
                    " The assessment and widget observations keep their original timestamps; questions were not re-read in this attempt."}
                  {inspection.directSummary.mediaContinuation.baseSourceCapturedAt && (
                    <> Earlier source capture: <time dateTime={inspection.directSummary.mediaContinuation.baseSourceCapturedAt}>
                      {inspection.directSummary.mediaContinuation.baseSourceCapturedAt}
                    </time>.</>
                  )}
                </p>
              )}
              {inspection.directSummary.currentAttempt.elapsedMs !== null && (
                <p>
                  Latest attempt: {inspection.directSummary.timingSource === "RECEIPT_SPAN" ? "about " : ""}
                  {captureDuration(inspection.directSummary.currentAttempt.elapsedMs)}
                  {inspection.directSummary.currentAttempt.requests !== null &&
                    " · " + inspection.directSummary.currentAttempt.requests.toLocaleString() + " API reads"}
                  {inspection.directSummary.timingSource === "RECEIPT_SPAN" &&
                    " (from recorded read timestamps)"}
                </p>
              )}
              {inspection.directSummary.cumulativeBudget.elapsedMs !== null && (
                <p>
                  Total across saved attempts: {captureDuration(inspection.directSummary.cumulativeBudget.elapsedMs)}
                  {inspection.directSummary.cumulativeBudget.requests !== null &&
                    " · " + inspection.directSummary.cumulativeBudget.requests.toLocaleString() + " API reads"}
                </p>
              )}
              {inspection.directSummary.media?.currentAttempt.requests !== null &&
                inspection.directSummary.media?.currentAttempt.requests !== undefined && (
                  <p>
                    Media body requests this attempt: {inspection.directSummary.media.currentAttempt.requests.toLocaleString()}
                    {inspection.directSummary.media.currentAttempt.bytes !== null &&
                      " · " + (inspection.directSummary.media.currentAttempt.bytes / 1024 / 1024).toFixed(2) + " MiB received"}
                    {inspection.directSummary.media.cumulativeBudget.requests !== null &&
                      inspection.directSummary.media.cumulativeBudget.requests !== inspection.directSummary.media.currentAttempt.requests &&
                      " · " + inspection.directSummary.media.cumulativeBudget.requests.toLocaleString() + " body requests across saved attempts"}
                  </p>
                )}
              <p className="hint">
                Reading text and question capture are separate from verifying image,
                attachment and external-widget bodies. These counts retain the
                evidence gaps reported by the capture.
              </p>
            </div>
          )}

          <div
            className={
              inspection.verdict.complete
                ? "success-notice"
                : "migration-issues"
            }
            role="status"
          >
            <strong>
              {inspection.verdict.complete
                ? "COMPLETE — strict capture gate passed"
                : inspection.pausedBatch
                  ? "BATCH SAVED — continue capture"
                  : "INCOMPLETE — evidence retained, certification withheld"}
            </strong>
            <p>
              Course <code>{inspection.courseId}</code> · schema{" "}
              {inspection.schemaVersion} · {inspection.extractor}
            </p>
            {directCapture && <p>
              Authoring draft capture. Returned published versions remain separate;
              evidence gaps determine whether this file passes the capture gate.
              Click the same saved bookmark on this course’s Content page after an
              interruption. {inspection.directSummary?.mediaContinuation
                ? "This continuation preserves the earlier assessment observations and checks reading media."
                : "CTI checks current sources before reusing matching saved reads."}
            </p>}
            {legacyResumeAvailable && (
              <p>
                Use Copy automatic resume command above in Protocol monitor.
                CTI restores saved observations and continues missing evidence
                across automatic reloads. External content can still require review.
              </p>
            )}
            {!directCapture && !inspection.currentSchema && (
              <p className="hint">
                This is an older compatible schema. Existing evidence remains
                usable, but only the current extractor can satisfy the newest
                capture contract.
              </p>
            )}
            {!directCapture && !inspection.currentVersion && (
              <p className="hint" role="alert">
                This capture was not produced by the current Coursera extractor
                release. Keep the evidence, but rerun the current extractor when
                you need a fresh certification attempt.
              </p>
            )}
            {!!reasons.length && (
              <details>
                <summary>Evidence gaps ({reasons.length})</summary>
                <ul>
                  {reasons.slice(0, 30).map((reason) => (
                    <li key={reason}>
                      <code>{reason}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="action-links">
            <button
              className="secondary"
              disabled={disabled || !!busy}
              onClick={() => void act("Copying capture review summary", async () => {
                const summary = JSON.stringify(inspection.reviewSummary, null, 2);
                try {
                  await navigator.clipboard.writeText(summary);
                  setReviewSummarySource("");
                  setNotice("Capture review summary copied. It contains counts, source-check flags and failure codes, with no questions, answers, files, source URLs or credentials.");
                } catch {
                  setReviewSummarySource(summary);
                  setNotice("Clipboard access is unavailable. Select and copy the capture review summary below. This diagnostic contains no course content.");
                }
              })}
            >
              Copy capture review summary
            </button>
            {legacyResumeAvailable && capture && (
              <button
                className="secondary"
                disabled={disabled || !!busy || courseMismatch || !shellTarget}
                onClick={() =>
                  void act("Preparing saved capture resume", async () => {
                    const current = await currentExtractor();
                    const source = createSavedCourseraResumeScript(
                      await readLocalCourseraCaptureFile(capture),
                      shellUrl,
                      current.script,
                    );
                    try {
                      await navigator.clipboard.writeText(source);
                      setResumeSource("");
                      setCopyStatus(
                        current.version +
                          " resume script copied. Reload the matching Coursera tab, then paste in Console.",
                      );
                    } catch {
                      setResumeSource(source);
                      setCopyStatus(
                        "Clipboard access is unavailable. Select and copy the full resume script below.",
                      );
                    }
                  })
                }
              >
                Copy manual resume script
              </button>
            )}
            {onUseCapture && capture && (
              <button
                className="primary"
                disabled={disabled || !!busy || courseMismatch}
                onClick={() => onUseCapture(capture)}
              >
                Use this capture in Compare
              </button>
            )}
            {courseMismatch && (
              <p className="hint" role="alert">
                This capture belongs to a different Coursera course than the URL
                above. Select the matching JSON before continuing.
              </p>
            )}
          </div>
          {resumeSource && (
            <label>
              Resume script — click inside, select all, and copy
              <textarea
                className="extractor-source"
                aria-label="Saved Coursera resume script"
                readOnly
                value={resumeSource}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
          {reviewSummarySource && (
            <label>
              Capture review summary — click inside, select all, and copy
              <textarea
                className="extractor-source"
                aria-label="Coursera capture review summary"
                readOnly
                value={reviewSummarySource}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </>
      )}
    </section>
  );
}
