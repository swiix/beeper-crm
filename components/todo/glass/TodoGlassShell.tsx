import { cn } from "@/lib/cn";

type TodoGlassShellProps = {
  children: React.ReactNode;
  className?: string;
};

export function TodoGlassShell({ children, className }: TodoGlassShellProps) {
  return (
    <div className={cn("tg-shell-bg flex min-h-0 flex-1 gap-2 p-2", className)}>
      {children}
    </div>
  );
}
