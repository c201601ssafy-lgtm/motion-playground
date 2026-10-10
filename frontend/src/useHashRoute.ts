import { useEffect, useState } from "react";

export type Route = "lab" | "record";

function parse(): Route {
  return window.location.hash === "#/record" ? "record" : "lab";
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
