// Tiny DOM helpers. All document content is inserted via textContent /
// createTextNode — never innerHTML — so document text can't inject markup.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(node, event, fn, opts) {
  node.addEventListener(event, fn, opts);
  return node;
}
