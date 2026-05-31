/**
 * Unified Cmd/Ctrl+Z undo: completed todos, todo-list suggestion reject/accept, and batch accept.
 */
import { mutate } from "swr";

const MAX_STACK = 40;

export type TodoSuggestionUndoPayload = {
  title: string;
  due: string | null;
  priority?: number | string;
  notes?: string | null;
  category?: string | null;
  estimated_time_minutes?: number | null;
  estimated_time_hours?: number | null;
};

type CompletionFrame = { kind: "completion"; id: string; previousCompleted: number };
type RejectFrame = { kind: "reject"; chatId: string; index: number; item: TodoSuggestionUndoPayload };
type AcceptFrame = {
  kind: "accept";
  chatId: string;
  index: number;
  item: TodoSuggestionUndoPayload;
  todoId: string;
};
type AcceptBatchFrame = {
  kind: "accept-batch";
  chatId: string;
  previousSuggestions: TodoSuggestionUndoPayload[];
  todoIds: string[];
};

type Frame = CompletionFrame | RejectFrame | AcceptFrame | AcceptBatchFrame;

const stack: Frame[] = [];

export type TodoSuggestionUndoCallbacks = {
  insertSuggestionAt: (chatId: string, index: number, item: TodoSuggestionUndoPayload) => void;
  setSuggestionsForChat: (chatId: string, items: TodoSuggestionUndoPayload[]) => void;
};

let suggestionCallbacks: TodoSuggestionUndoCallbacks | null = null;

export function registerTodoSuggestionUndoCallbacks(callbacks: TodoSuggestionUndoCallbacks | null): void {
  suggestionCallbacks = callbacks;
}

/**
 * Drops pending suggestion-related frames (reject/accept/batch). Call when leaving the todo view so completion undos stay intact.
 */
export function clearTodoSuggestionUndoFrames(): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind !== "completion") {
      stack.splice(i, 1);
    }
  }
}

function pushFrame(frame: Frame): void {
  stack.push(frame);
  if (stack.length > MAX_STACK) stack.shift();
}

export function pushTodoCompletionUndo(entry: { id: string; previousCompleted: number }): void {
  pushFrame({ kind: "completion", ...entry });
}

export function pushTodoSuggestionRejectUndo(entry: {
  chatId: string;
  index: number;
  item: TodoSuggestionUndoPayload;
}): void {
  pushFrame({
    kind: "reject",
    chatId: entry.chatId,
    index: entry.index,
    item: { ...entry.item },
  });
}

export function pushTodoSuggestionAcceptUndo(entry: {
  chatId: string;
  index: number;
  item: TodoSuggestionUndoPayload;
  todoId: string;
}): void {
  pushFrame({
    kind: "accept",
    chatId: entry.chatId,
    index: entry.index,
    item: { ...entry.item },
    todoId: entry.todoId,
  });
}

export function pushTodoAcceptBatchUndo(entry: {
  chatId: string;
  previousSuggestions: TodoSuggestionUndoPayload[];
  todoIds: string[];
}): void {
  pushFrame({
    kind: "accept-batch",
    chatId: entry.chatId,
    previousSuggestions: entry.previousSuggestions.map((s) => ({ ...s })),
    todoIds: [...entry.todoIds],
  });
}

function repushFrame(frame: Frame): void {
  stack.push(frame);
}

function isEditableTarget(target: EventTarget | null): boolean {
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
    )
      return false;
    return true;
  }
  if (target.isContentEditable) return true;
  const role = target.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

let shortcutInstalled = false;

async function invalidateTodoListSwr(): Promise<void> {
  await mutate((key) => Array.isArray(key) && key[0] === "todo-list-todos");
  await mutate((key) => Array.isArray(key) && key[0] === "todo-count-by-chat");
}

/**
 * One global capture listener: Cmd+Z / Ctrl+Z undoes the last todo-related action without stealing undo from text fields.
 */
export function ensureTodoCompletionUndoShortcut(): void {
  if (typeof window === "undefined" || shortcutInstalled) return;
  shortcutInstalled = true;

  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const k = e.key;
      if (k !== "z" && k !== "Z") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;

      const frame = stack.pop();
      if (!frame) return;

      e.preventDefault();
      e.stopPropagation();

      void (async () => {
        if (frame.kind === "completion") {
          try {
            const res = await fetch(`/api/todo-list/todos/${encodeURIComponent(frame.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ completed: frame.previousCompleted }),
            });
            if (!res.ok) {
              repushFrame(frame);
              return;
            }
            await invalidateTodoListSwr();
          } catch {
            repushFrame(frame);
          }
          return;
        }

        const impl = suggestionCallbacks;
        if (!impl) {
          repushFrame(frame);
          return;
        }

        try {
          if (frame.kind === "reject") {
            impl.insertSuggestionAt(frame.chatId, frame.index, frame.item);
            return;
          }

          if (frame.kind === "accept") {
            const res = await fetch(`/api/todo-list/todos/${encodeURIComponent(frame.todoId)}`, { method: "DELETE" });
            if (!res.ok && res.status !== 404) {
              repushFrame(frame);
              return;
            }
            impl.insertSuggestionAt(frame.chatId, frame.index, frame.item);
            await invalidateTodoListSwr();
            return;
          }

          if (frame.kind === "accept-batch") {
            const remainingIds = [...frame.todoIds];
            for (let i = 0; i < remainingIds.length; i++) {
              const id = remainingIds[i];
              const res = await fetch(`/api/todo-list/todos/${encodeURIComponent(id)}`, { method: "DELETE" });
              if (!res.ok && res.status !== 404) {
                repushFrame({
                  kind: "accept-batch",
                  chatId: frame.chatId,
                  previousSuggestions: frame.previousSuggestions.map((s) => ({ ...s })),
                  todoIds: remainingIds.slice(i),
                });
                return;
              }
            }
            impl.setSuggestionsForChat(frame.chatId, frame.previousSuggestions);
            await invalidateTodoListSwr();
          }
        } catch {
          repushFrame(frame);
        }
      })();
    },
    true
  );
}
