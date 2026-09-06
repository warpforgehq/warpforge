export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const IS_WIN = typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

/** Native desktop blur: macOS WindowServer blur and Windows Acrylic. Linux stays opaque. */
export const HAS_NATIVE_GLASS = IS_MAC || IS_WIN;

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
