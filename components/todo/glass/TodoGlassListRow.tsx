import { cn } from "@/lib/cn";

type TodoGlassListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  inSelection?: boolean;
  as?: "button";
};

export function TodoGlassListRow({
  selected,
  inSelection,
  className,
  type = "button",
  ...props
}: TodoGlassListRowProps) {
  return (
    <button
      type={type}
      className={cn(
        "tg-list-row mb-1.5",
        selected && "tg-list-row-selected",
        !selected && inSelection && "tg-list-row-selection",
        className
      )}
      {...props}
    />
  );
}

type TodoGlassListRowDivProps = React.HTMLAttributes<HTMLDivElement> & {
  selected?: boolean;
  draggable?: boolean;
};

export function TodoGlassListRowDiv({
  selected,
  className,
  ...props
}: TodoGlassListRowDivProps) {
  return (
    <div
      className={cn("tg-list-row mb-1.5", selected && "tg-list-row-selected", className)}
      {...props}
    />
  );
}
