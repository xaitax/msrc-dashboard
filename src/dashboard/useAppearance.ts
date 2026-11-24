import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import { APPEARANCE_KEY, applyAppearance, DARK_QUERY, readAppearance, saveAppearance, type Appearance } from "./appearance";

export function useAppearance() {
  const system = useMemo(() => matchMedia(DARK_QUERY), []);
  const [systemDark, setSystemDark] = useState(system.matches);
  const [preference, setPreference] = useState(readAppearance);

  useLayoutEffect(() => {
    const syncSystem = () => setSystemDark(system.matches);
    const syncStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === APPEARANCE_KEY || event.key === null)) {
        setPreference(readAppearance());
      }
    };
    system.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncStorage);
    syncSystem();
    setPreference(readAppearance());
    return () => {
      system.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, [system]);

  useLayoutEffect(() => applyAppearance(preference, systemDark), [preference, systemDark]);

  function choose(value: Appearance) {
    saveAppearance(value);
    setPreference(value);
  }
  return { preference, systemDark, choose };
}
