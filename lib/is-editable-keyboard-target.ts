/** True when the event target is a field where single-key shortcuts should not fire. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const t = (target as HTMLInputElement).type?.toLowerCase() ?? "text";
    if (
      t === "checkbox" ||
      t === "radio" ||
      t === "button" ||
      t === "submit" ||
      t === "reset" ||
      t === "file" ||
      t === "hidden" ||
      t === "range" ||
      t === "color"
    ) {
      return false;
    }
    return true;
  }
  if (target.isContentEditable) return true;
  const role = target.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}
