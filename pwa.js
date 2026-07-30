(() => {
  const $ = (selector) => document.querySelector(selector);
  const banner = $("#installBanner");
  const installButton = $("#installApp");
  const dismissButton = $("#installDismiss");
  const helpModal = $("#installHelpModal");
  const helpClose = $("#installHelpClose");
  const helpDone = $("#installHelpDone");
  const iosSteps = $("#iosInstallSteps");
  const androidSteps = $("#androidInstallSteps");

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isMobile = isIOS || /Android/.test(navigator.userAgent);
  let installPrompt = null;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {
        // Local data remains available even if offline support cannot initialize.
      });
    });
  }

  const showBanner = () => {
    if (!isStandalone && isMobile && sessionStorage.getItem("desk.install-dismissed") !== "yes") {
      banner.hidden = false;
    }
  };

  const closeHelp = () => helpModal.classList.remove("show");
  const showHelp = () => {
    iosSteps.hidden = !isIOS;
    androidSteps.hidden = isIOS;
    helpModal.classList.add("show");
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    showBanner();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    banner.hidden = true;
    window.workbench?.toast("工作台已添加到桌面");
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      showHelp();
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") banner.hidden = true;
    installPrompt = null;
  });

  dismissButton.addEventListener("click", () => {
    banner.hidden = true;
    sessionStorage.setItem("desk.install-dismissed", "yes");
  });
  helpClose.addEventListener("click", closeHelp);
  helpDone.addEventListener("click", closeHelp);
  helpModal.addEventListener("click", (event) => {
    if (event.target === helpModal) closeHelp();
  });

  if (!isStandalone && isMobile) setTimeout(showBanner, 1400);
})();
