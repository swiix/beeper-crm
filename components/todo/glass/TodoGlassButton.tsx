import { cn } from "@/lib/cn";

type TodoGlassButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

type TodoGlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TodoGlassButtonVariant;
  fullWidth?: boolean;
};

const variantClass: Record<TodoGlassButtonVariant, string> = {
  primary: "tg-btn-primary",
  secondary: "tg-btn-secondary",
  ghost: "tg-btn-ghost",
  destructive: "tg-btn-destructive",
};

export function TodoGlassButton({
  variant = "secondary",
  fullWidth,
  className,
  type = "button",
  ...props
}: TodoGlassButtonProps) {
  return (
    <button
      type={type}
      className={cn(variantClass[variant], fullWidth && "w-full", className)}
      {...props}
    />
  );
}
