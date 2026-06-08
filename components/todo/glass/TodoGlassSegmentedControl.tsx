import { cn } from "@/lib/cn";

export type TodoGlassSegmentOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

type TodoGlassSegmentedControlProps<T extends string> = {
  value: T;
  options: TodoGlassSegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
};

export function TodoGlassSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: TodoGlassSegmentedControlProps<T>) {
  return (
    <div className={cn("tg-segmented", className)} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          title={opt.title ?? opt.label}
          onClick={() => onChange(opt.value)}
          className={cn(
            "tg-segmented-item",
            value === opt.value ? "tg-segmented-item-active" : "tg-segmented-item-inactive"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
