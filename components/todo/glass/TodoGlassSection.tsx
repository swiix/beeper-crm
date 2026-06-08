import { cn } from "@/lib/cn";

type TodoGlassSectionProps = {
  label?: string;
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
};

export function TodoGlassSection({ label, children, className, muted }: TodoGlassSectionProps) {
  return (
    <section className={cn("mb-3", className)}>
      {label ? <h3 className="tg-section-label">{label}</h3> : null}
      <div className={cn(muted ? "tg-surface-muted p-2.5" : "tg-surface p-2.5")}>{children}</div>
    </section>
  );
}
