import { createRoot } from "react-dom/client";
import { LAST_PAGE_KEY, resolveLastPage } from "@/core/navigation/last-page";

async function start() {
  let destination =
    window.location.pathname === "/"
      ? resolveLastPage(
          localStorage.getItem(LAST_PAGE_KEY),
          navigator.onLine,
          false,
        )
      : null;
  if (!destination && window.location.pathname === "/" && navigator.onLine) {
    const [{ hasAccountSession }, { getAccountApiOrigin }] = await Promise.all([
      import("@/infrastructure/account/account-session-presence"),
      import("@/infrastructure/account/api-origin"),
    ]);
    try {
      destination = resolveLastPage(
        null,
        true,
        await hasAccountSession(getAccountApiOrigin()),
      );
    } catch {
      // A slow or unreachable account service leaves the public landing available.
      destination = null;
    }
  }
  if (destination) {
    window.location.replace(destination);
    return;
  }
  const { Landing } = await import("./Landing");
  createRoot(document.getElementById("root")!).render(<Landing />);
}
void start();
