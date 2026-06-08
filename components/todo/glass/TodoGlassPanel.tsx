import { cn } from "@/lib/cn";
import { forwardRef } from "react";

type TodoGlassPanelProps = {
  children: React.ReactNode;
  header?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bodyClassName?: string;
};

export function TodoGlassPanel({ children, header, className, style, bodyClassName }: TodoGlassPanelProps) {
  return (
    <div className={cn("tg-panel shrink-0", className)} style={style}>
      {header ? (
        <div className="shrink-0 border-b border-white/10 p-3">{header}</div>
      ) : null}
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", bodyClassName)}>
        {children}
      </div>
    </div>
  );
}

export const TodoGlassPanelScroll = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  function TodoGlassPanelScroll({ children, className }, ref) {
    return (
      <div ref={ref} className={cn("scroll-thin min-h-0 flex-1 overflow-y-auto p-3", className)}>
        {children}
      </div>
    );
  }
);

export function TodoGlassResizeHandle({
  onMouseDown,
  className,
  "aria-label": ariaLabel,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className={cn("tg-divider", className)}
      onMouseDown={onMouseDown}
    />
  );
}
