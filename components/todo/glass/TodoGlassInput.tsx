import { cn } from "@/lib/cn";

type TodoGlassInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function TodoGlassInput({ label, className, id, ...props }: TodoGlassInputProps) {
  const inputId = id ?? (label ? `tg-input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className="block">
      {label ? (
        <span className="mb-1 block text-xs font-medium text-wa-text-secondary">{label}</span>
      ) : null}
      <input id={inputId} className={cn("tg-input", className)} {...props} />
    </label>
  );
}

type TodoGlassSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
};

export function TodoGlassSelect({ label, className, id, children, ...props }: TodoGlassSelectProps) {
  const selectId = id ?? (label ? `tg-select-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className="block">
      {label ? (
        <span className="mb-1 block text-xs font-medium text-wa-text-secondary">{label}</span>
      ) : null}
      <select id={selectId} className={cn("tg-input", className)} {...props}>
        {children}
      </select>
    </label>
  );
}
