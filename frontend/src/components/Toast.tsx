"use client";

import { useEffect, useState } from "react";

export type ToastTone = "ok" | "err";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type Listener = (toasts: ToastItem[]) => void;

let nextId = 1;
let current: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = current;
  for (const listener of listeners) listener(snapshot);
}

export function pushToast(message: string, tone: ToastTone) {
  const toast: ToastItem = { id: nextId, message, tone };
  nextId += 1;
  current = [...current, toast];
  emit();
  window.setTimeout(() => {
    current = current.filter((item) => item.id !== toast.id);
    emit();
  }, 8000);
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    setToasts(current);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`w-full rounded-lg px-4 py-3 text-sm font-semibold ${
            toast.tone === "ok" ? "bg-emerald-400 text-emerald-950" : "bg-red-400 text-red-950"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
