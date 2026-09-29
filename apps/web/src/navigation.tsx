import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

const warning = "Tienes cambios sin guardar. ¿Quieres salir y descartarlos?";
type Navigation = { url: URL; navigate: (href: string, replace?: boolean) => boolean; guard: (value: boolean) => void };
const Context = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState(() => new URL(location.href));
  const dirty = useRef(false);
  const position = useRef(Number(history.state?.hlPosition || 0));
  useEffect(() => {
    history.replaceState({ ...history.state, hlPosition: position.current }, "");
    const back = () => {
      const next = Number(history.state?.hlPosition || 0);
      if (next !== position.current && dirty.current && !window.confirm(warning)) {
        history.go(position.current - next);
        return;
      }
      position.current = next;
      setUrl(new URL(location.href));
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = ""; }
    };
    addEventListener("popstate", back);
    addEventListener("beforeunload", leave);
    return () => { removeEventListener("popstate", back); removeEventListener("beforeunload", leave); };
  }, []);
  function navigate(href: string, replace = false) {
    const next = new URL(href, location.origin);
    if (next.origin !== location.origin) return false;
    if (next.href === location.href) return true;
    if (dirty.current && !window.confirm(warning)) return false;
    if (!replace) position.current++;
    history[replace ? "replaceState" : "pushState"]({ hlPosition: position.current }, "", next);
    setUrl(next);
    return true;
  }
  return <Context.Provider value={{ url, navigate, guard: value => { dirty.current = value; } }}>{children}</Context.Provider>;
}

export function useNavigation() {
  const navigation = useContext(Context);
  if (!navigation) throw new Error("NavigationProvider is required");
  return navigation;
}

export function useUnsavedChanges(dirty: boolean) {
  const { guard } = useNavigation();
  useEffect(() => { guard(dirty); return () => guard(false); }, [dirty]);
}

export function Link({ href = "/inicio", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useNavigation();
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || props.target || props.download) return;
    if (new URL(href, location.origin).origin !== location.origin) return;
    event.preventDefault(); navigate(href);
  }}/>;
}
