const base = new URL("./", location.href);
const transcript = document.querySelector("#transcript");
const status = document.querySelector("#status");
const submission = document.querySelector("#submission");
const form = document.querySelector("form");
const button = document.querySelector("button");
let receipt = null;
let active = false;
const stream = new EventSource(new URL("events", base));

stream.addEventListener("snapshot", (event) => {
  const snapshot = JSON.parse(event.data);
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100;
  document.querySelector("h1").textContent = snapshot.title;
  status.textContent =
    snapshot.status === "working"
      ? "Working"
      : snapshot.status === "idle"
        ? "Idle"
        : "Owner connection offline";
  const rows = snapshot.rows.map((row) => {
    const article = document.createElement("article");
    article.className = row.role;
    const role = document.createElement("div");
    role.className = "role";
    role.textContent = row.role;
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = row.text;
    article.append(role, text);
    return article;
  });
  transcript.replaceChildren(...rows);
  active = true;
  button.disabled = false;
  if (nearBottom) window.scrollTo(0, document.body.scrollHeight);
});
function ended() {
  active = false;
  button.disabled = true;
  transcript.replaceChildren();
  document.querySelector("h1").textContent = "Shared task";
  status.textContent = "Guest link ended or disconnected. Reload to reconnect.";
  stream.close();
}
stream.addEventListener("revoked", ended);
stream.onerror = ended;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!active) return;
  button.disabled = true;
  try {
    const response = await fetch(new URL("messages", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Too many messages. Try again in a minute."
          : "Could not submit this message.",
      );
    receipt = (await response.json()).receipt;
    form.elements.text.value = "";
    submission.textContent = "Waiting for owner approval";
  } catch (error) {
    submission.textContent = error.message;
  } finally {
    button.disabled = !active;
  }
});
setInterval(async () => {
  if (!receipt || !active) return;
  try {
    const response = await fetch(new URL(`messages/${receipt}`, base));
    if (!response.ok) return;
    const result = await response.json();
    submission.textContent =
      result.status === "sent"
        ? "Sent by the owner"
        : result.status === "dismissed"
          ? "Dismissed by the owner"
          : "Waiting for owner approval";
    if (result.status !== "pending") receipt = null;
  } catch {
    /* A disconnected link is handled by the event stream. */
  }
}, 5000);
