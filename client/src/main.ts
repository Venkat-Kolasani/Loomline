const statusNode = document.querySelector("#status");

if (!(statusNode instanceof HTMLElement)) {
  throw new Error("Expected #status element in scaffold shell.");
}

const statusEl: HTMLElement = statusNode;

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      statusEl.textContent = `Health check failed (${response.status}).`;
      return;
    }

    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "ok" in body &&
      body.ok === true
    ) {
      statusEl.textContent = "Worker health OK — scaffold is running.";
      return;
    }

    statusEl.textContent = "Unexpected health response shape.";
  } catch {
    statusEl.textContent =
      "Could not reach /api/health. Use `npm run dev` (Wrangler) rather than Vite alone for the full Worker.";
  }
}

void checkHealth();
