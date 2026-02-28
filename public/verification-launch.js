(() => {
  const statusNode = document.getElementById("verification-status");
  const verificationUrl = document.body.dataset.verificationUrl ?? "";
  const returnPathCandidate = document.body.dataset.returnPath ?? "/";

  let safeReturnPath = "/";
  try {
    const parsed = new URL(returnPathCandidate, window.location.origin);
    if (parsed.origin === window.location.origin && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      safeReturnPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    safeReturnPath = "/";
  }

  if (!verificationUrl) {
    if (statusNode) {
      statusNode.textContent = "Verification URL is unavailable. Return to omni-connector and retry.";
    }
    return;
  }

  const popup = window.open(verificationUrl, "omni-connector-verification", "noopener,noreferrer");
  if (!popup) {
    if (statusNode) {
      statusNode.textContent = "Popup was blocked. Open the verification page, finish it, then return here.";
    }
    return;
  }

  const monitor = () => {
    if (popup.closed) {
      window.location.replace(safeReturnPath);
      return;
    }

    window.setTimeout(monitor, 700);
  };

  monitor();
})();
