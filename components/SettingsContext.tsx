"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { OpenChatWith, TinderKeyboardLayout } from "@/lib/settings";
import {
  getAutoInsertFirstSuggestion,
  getOpenChatWith,
  getShiftEnterJumpsToNextChat,
  getTinderKeyboardLayout,
  getTinderMessagePreloadCount,
  setAutoInsertFirstSuggestion as persistAutoInsertFirstSuggestion,
  setOpenChatWith as persistOpenChatWith,
  setShiftEnterJumpsToNextChat as persistShiftEnterJumpsToNextChat,
  setTinderKeyboardLayout as persistTinderKeyboardLayout,
  setTinderMessagePreloadCount as persistTinderMessagePreloadCount,
} from "@/lib/settings";
import { clampTinderMessagePreloadCount } from "@/lib/chat-message-limits";

interface SettingsState {
  autoInsertFirstSuggestion: boolean;
  shiftEnterJumpsToNextChat: boolean;
  openChatWith: OpenChatWith;
  tinderKeyboardLayout: TinderKeyboardLayout;
  tinderMessagePreloadCount: number;
}

const defaultState: SettingsState = {
  autoInsertFirstSuggestion: false,
  shiftEnterJumpsToNextChat: false,
  openChatWith: "client",
  tinderKeyboardLayout: "classic",
  tinderMessagePreloadCount: 50,
};

const SettingsContext = createContext<{
  settings: SettingsState;
  setAutoInsertFirstSuggestion: (value: boolean) => void;
  setShiftEnterJumpsToNextChat: (value: boolean) => void;
  setOpenChatWith: (value: OpenChatWith) => void;
  setTinderKeyboardLayout: (value: TinderKeyboardLayout) => void;
  setTinderMessagePreloadCount: (value: number) => void;
}>({
  settings: defaultState,
  setAutoInsertFirstSuggestion: () => {},
  setShiftEnterJumpsToNextChat: () => {},
  setOpenChatWith: () => {},
  setTinderKeyboardLayout: () => {},
  setTinderMessagePreloadCount: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(() => ({
    autoInsertFirstSuggestion: getAutoInsertFirstSuggestion(),
    shiftEnterJumpsToNextChat: getShiftEnterJumpsToNextChat(),
    openChatWith: getOpenChatWith(),
    tinderKeyboardLayout: getTinderKeyboardLayout(),
    tinderMessagePreloadCount: getTinderMessagePreloadCount(),
  }));

  useEffect(() => {
    setSettings((s) => ({
      ...s,
      autoInsertFirstSuggestion: getAutoInsertFirstSuggestion(),
      shiftEnterJumpsToNextChat: getShiftEnterJumpsToNextChat(),
      openChatWith: getOpenChatWith(),
      tinderKeyboardLayout: getTinderKeyboardLayout(),
      tinderMessagePreloadCount: getTinderMessagePreloadCount(),
    }));
  }, []);

  const setAutoInsertFirstSuggestion = useCallback((value: boolean) => {
    persistAutoInsertFirstSuggestion(value);
    setSettings((s) => ({ ...s, autoInsertFirstSuggestion: value }));
  }, []);

  const setShiftEnterJumpsToNextChat = useCallback((value: boolean) => {
    persistShiftEnterJumpsToNextChat(value);
    setSettings((s) => ({ ...s, shiftEnterJumpsToNextChat: value }));
  }, []);

  const setOpenChatWith = useCallback((value: OpenChatWith) => {
    persistOpenChatWith(value);
    setSettings((s) => ({ ...s, openChatWith: value }));
  }, []);

  const setTinderKeyboardLayout = useCallback((value: TinderKeyboardLayout) => {
    persistTinderKeyboardLayout(value);
    setSettings((s) => ({ ...s, tinderKeyboardLayout: value }));
  }, []);

  const setTinderMessagePreloadCount = useCallback((value: number) => {
    persistTinderMessagePreloadCount(value);
    setSettings((s) => ({
      ...s,
      tinderMessagePreloadCount: clampTinderMessagePreloadCount(value),
    }));
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        setAutoInsertFirstSuggestion,
        setShiftEnterJumpsToNextChat,
        setOpenChatWith,
        setTinderKeyboardLayout,
        setTinderMessagePreloadCount,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
