export function download(
  name: string,
  value: string | Uint8Array,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([value as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const json = (value: unknown) => JSON.stringify(value, null, 2);
export async function inputFile(file: File | null) {
  return file
    ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
    : undefined;
}
export function Evidence({ value }: { value: unknown }) {
  return <pre className="evidence-json">{json(value)}</pre>;
}
export function FileField({
  label,
  accept,
  onChange,
  disabled = false,
  file,
}: {
  label: string;
  accept: string;
  onChange: (f: File | null) => void;
  disabled?: boolean;
  file?: File | null;
}) {
  return (
    <label>
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {file && (
        <small className="selected-file">
          Selected: {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
        </small>
      )}
    </label>
  );
}
