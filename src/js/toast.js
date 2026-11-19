function node(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function toast(message, opts) {
  opts = opts || {};
  var toaster = document.querySelector(".toaster") || document.body.appendChild(node("div", "toaster"));
  var item = node("div", "toast");
  item.setAttribute("role", opts.type === "error" ? "alert" : "status");
  item.setAttribute("aria-hidden", "true");
  if (opts.type) item.setAttribute("data-type", opts.type);
  var content = node("div", "toast-content");
  var section = node("section");
  if (opts.title) section.appendChild(node("h2", "", opts.title));
  section.appendChild(node("p", "", message));
  content.appendChild(section);
  item.appendChild(content);
  toaster.appendChild(item);
  requestAnimationFrame(function () { item.setAttribute("aria-hidden", "false"); });
  setTimeout(function () {
    item.setAttribute("aria-hidden", "true");
    setTimeout(function () { item.remove(); }, 400);
  }, opts.duration || 3000);
}
