import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(null), 2500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message !== null && <div className="toast">{message}</div>}
    </ToastContext.Provider>
  );
}
