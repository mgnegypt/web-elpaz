/* Runs before any stylesheet or module so the very first paint is already in the right theme.
   Same-origin, blocking, and defensive about private-mode / unavailable localStorage. */
(function () {
  var STORAGE_KEY = "elbaz-theme";
  var theme = null;

  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (error) {
    /* localStorage can throw in private mode or when storage is disabled */
  }

  if (!theme) {
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      theme = "light";
    }
  }

  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
})();
