import { useId, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  searchText?: string;
}
export function matchesSearch(query: string, ...values: unknown[]) {
  const normalize = (value: string) =>
    value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const text = normalize(values.map((v) => String(v ?? "")).join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word));
}
/** A labelled search plus a native select keeps the browser's keyboard and
 * assistive-technology behaviour. Filtering never changes the selected value. */
export default function SearchableSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  emptyLabel = "Choose an option",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const matches = options.filter(
    (option) =>
      query.trim().toLowerCase() === option.value.toLowerCase() ||
      matchesSearch(query, option.label, option.searchText),
  );
  const selected = options.find((option) => option.value === value);
  const retained =
    selected && !matches.some((option) => option.value === value);
  const shown = retained ? [selected, ...matches] : matches;
  return (
    <div className="searchable-select">
      <label htmlFor={`${id}-search`}>Search {label.toLocaleLowerCase()}</label>
      <div className="search-controls">
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          disabled={disabled}
          aria-describedby={`${id}-results`}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.preventDefault();
            }
          }}
        />
      </div>
      <label htmlFor={`${id}-select`}>{label}</label>
      <select
        id={`${id}-select`}
        aria-label={label}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-results`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {shown.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <small id={`${id}-results`} role="status">
        {matches.length} of {options.length} options
        {retained ? "; current selection retained" : ""}
        {query && !matches.length
          ? ". No matching options. Clear search to see all."
          : ""}
      </small>
    </div>
  );
}
