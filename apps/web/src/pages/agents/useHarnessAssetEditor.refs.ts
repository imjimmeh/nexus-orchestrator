import { useCallback, useState } from "react";

/** Manages the pluginRefs and extensionRefs lists + their error states. */
export function useAssetRefs(
  initialPluginRefs: string[],
  initialExtensionRefs: string[],
) {
  const [pluginRefs, setPluginRefs] = useState<string[]>(initialPluginRefs);
  const [extensionRefs, setExtensionRefs] =
    useState<string[]>(initialExtensionRefs);
  const [pluginRefError, setPluginRefError] = useState<string | null>(null);
  const [extensionRefError, setExtensionRefError] = useState<string | null>(
    null,
  );

  const addPluginRef = useCallback((assetId: string) => {
    const trimmed = assetId.trim();
    if (!trimmed) {
      setPluginRefError("Asset id must not be empty");
      return;
    }
    setPluginRefs((p) => (p.includes(trimmed) ? p : [...p, trimmed]));
    setPluginRefError(null);
  }, []);

  const removePluginRef = useCallback(
    (assetId: string) => setPluginRefs((p) => p.filter((id) => id !== assetId)),
    [],
  );

  const addExtensionRef = useCallback((assetId: string) => {
    const trimmed = assetId.trim();
    if (!trimmed) {
      setExtensionRefError("Asset id must not be empty");
      return;
    }
    setExtensionRefs((p) => (p.includes(trimmed) ? p : [...p, trimmed]));
    setExtensionRefError(null);
  }, []);

  const removeExtensionRef = useCallback(
    (assetId: string) =>
      setExtensionRefs((p) => p.filter((id) => id !== assetId)),
    [],
  );

  return {
    pluginRefs,
    extensionRefs,
    pluginRefError,
    extensionRefError,
    setExtensionRefs,
    addPluginRef,
    removePluginRef,
    addExtensionRef,
    removeExtensionRef,
  };
}
