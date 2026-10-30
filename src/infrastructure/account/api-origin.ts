export function getAccountApiOrigin(): string {
  return (
    import.meta.env.VITE_CADARA_API_ORIGIN ||
    (import.meta.env.DEV ? "http://localhost:8787" : "https://api.cadara.app")
  );
}
