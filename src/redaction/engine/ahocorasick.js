// Aho-Corasick multi-pattern string matching.
// Matches many known literals in a single pass over the text (design §5.1).

export class AhoCorasick {
  // needles: array of strings. Empty strings are ignored.
  constructor(needles) {
    this.needles = needles;
    this.next = [new Map()];
    this.fail = [0];
    this.out = [[]];
    for (let ni = 0; ni < needles.length; ni++) {
      const w = needles[ni];
      if (!w) continue;
      let s = 0;
      for (let k = 0; k < w.length; k++) {
        const ch = w[k];
        if (!this.next[s].has(ch)) {
          this.next.push(new Map());
          this.fail.push(0);
          this.out.push([]);
          this.next[s].set(ch, this.next.length - 1);
        }
        s = this.next[s].get(ch);
      }
      this.out[s].push(ni);
    }
    // BFS to build failure links.
    const queue = [];
    for (const [, t] of this.next[0]) {
      this.fail[t] = 0;
      queue.push(t);
    }
    while (queue.length) {
      const u = queue.shift();
      for (const [ch, v] of this.next[u]) {
        let f = this.fail[u];
        while (f !== 0 && !this.next[f].has(ch)) f = this.fail[f];
        const target = this.next[f].get(ch);
        this.fail[v] = target !== undefined && target !== v ? target : 0;
        this.out[v] = this.out[v].concat(this.out[this.fail[v]]);
        queue.push(v);
      }
    }
  }

  // Returns [{ end, needle }] — `end` is exclusive, needle is the index into
  // the constructor's needles array. Includes overlapping matches.
  search(text) {
    const results = [];
    let s = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (s !== 0 && !this.next[s].has(ch)) s = this.fail[s];
      s = this.next[s].get(ch) ?? 0;
      const outs = this.out[s];
      for (let k = 0; k < outs.length; k++) {
        results.push({ end: i + 1, needle: outs[k] });
      }
    }
    return results;
  }
}
