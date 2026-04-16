import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type GlobalPreloaderContextValue = {
  start: (message?: string) => () => void;
  setMessage: (message?: string) => void;
};

const GlobalPreloaderContext = createContext<GlobalPreloaderContextValue | null>(null);

export function useGlobalPreloader(): GlobalPreloaderContextValue {
  const value = useContext(GlobalPreloaderContext);
  if (!value) {
    throw new Error("useGlobalPreloader must be used within GlobalPreloaderProvider");
  }
  return value;
}

export function GlobalPreloaderProvider({ children }: { children: React.ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const nextId = useRef(1);
  const activeIds = useRef(new Set<number>());

  const start = useCallback((nextMessage?: string) => {
    const id = nextId.current++;
    activeIds.current.add(id);
    setActiveCount((c) => c + 1);
    if (nextMessage !== undefined) setMessage(nextMessage);

    return () => {
      if (!activeIds.current.has(id)) return;
      activeIds.current.delete(id);
      setActiveCount((c) => Math.max(0, c - 1));
    };
  }, []);

  const value = useMemo<GlobalPreloaderContextValue>(
    () => ({ start, setMessage }),
    [start]
  );

  return (
    <GlobalPreloaderContext.Provider value={value}>
      {children}
      {activeCount > 0 ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70">
          <div className="flex flex-col items-center gap-3">
            <div className="please-wait-spinner" aria-label="Loading">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
            {message ? (
              <p className="text-sm font-medium text-foreground">{message}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </GlobalPreloaderContext.Provider>
  );
}

