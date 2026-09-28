import { useState } from "react";

/** Large payloads are formatted only when requested, without reducing the export. */
export default function EvidenceDetails({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {open && (
        <pre className="evidence-json">{JSON.stringify(value, null, 2)}</pre>
      )}
    </details>
  );
}
