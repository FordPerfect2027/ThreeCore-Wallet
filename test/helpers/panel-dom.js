export class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.textContent = "";
    this.value = "";
    this.disabled = false;
  }
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
  find(className) {
    if (this.className?.split(" ").includes(className)) return this;
    for (const child of this.children) {
      const result = child.find(className);
      if (result) return result;
    }
    return null;
  }
}


