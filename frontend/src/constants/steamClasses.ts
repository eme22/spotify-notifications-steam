// Native Steam soundtrack/music player CSS classes (Steam build 11146165, sp.css module 84241).
//
// These are CSS-module hashes, so they change with Steam updates. Keep this file as the single
// source of truth so only this file needs updating when Steam changes. The runtime check below
// logs a warning if the classes are missing from the document's stylesheets.
export const STEAM_BUILD = "11146165";

export const STEAM_PLAYER = {
  overlay: "cq_KBMhL5GruRVv8rn5Fj",
  controlBlock: "_3DLyrg7YP5cNP9HKda62qd",
  compactView: "_3XFFTliWbYxPXHJy2vuxrJ",
  floatingLayout: "P6adL1ZYIyVNXuByQu_4-",
  controlsAndVolume: "gjP9WbEr6MS7VnS1zdyvb",
  row: "HqwlEGHhcQCe1_0utna2Z",
  controls: "_2U3M1lpKcsYHqfjiz77PQs",
  progress: "P_NVQ7KUOfqYaa_SwWOpS",
  text: "zE2L2bJ9nmo_JVcTMIz55",
  iconButton: "_1iFnR7cGRa1kepep433pGx",
  active: "h782PaUbu8xm3afLFh83E",
  large: "Upr_VRmq8Pb8RWegwuVYb",
  currentTrackContainer: "_2JNXbTydmrmO1E_p6Rky9q",
  art: "_2YNlqGrvNRA-xFsBpdv551",
  details: "faBTT6jhP3FFucyUnOiBK",
  soundtrackName: "I1AqdA0Q7RqYECTKSzsXc",
  trackName: "_2mM3tnF33EicEuUrjZmiQv",
} as const;

export const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export function hasSteamPlayerClasses(): boolean {
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = (sheet as any).cssRules || (sheet as any).rules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if ((rule as any).selectorText && (rule as any).selectorText.includes(STEAM_PLAYER.overlay)) {
            return true;
          }
        }
      } catch {
        // cross-origin stylesheets are not readable
      }
    }
  } catch {}
  return false;
}