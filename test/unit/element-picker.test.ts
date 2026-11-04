import { beforeEach, describe, expect, test } from 'vitest';
import type { Rect } from '../../src/shared/geometry';
import {
  bestElement,
  composedParent,
  describeElement,
  pickElement,
  visibleChild,
  visibleParent,
  visibleSibling,
  type RectFn,
} from '../../src/content/element-picker';

// happy-dom has no layout, so each test assigns boxes through data-box="l t w h".
const rectOf: RectFn = (element) => {
  const box = element.getAttribute('data-box');
  if (!box) return { left: 0, top: 0, right: 0, bottom: 0 };
  const [left = 0, top = 0, boxWidth = 0, boxHeight = 0] = box.split(' ').map(Number);
  return { left, top, right: left + boxWidth, bottom: top + boxHeight } satisfies Rect;
};

const limits = { maxWidth: 1000, maxHeight: 700 };
const query = (selector: string) => document.querySelector(selector) as Element;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="page" data-box="0 0 1280 4000">
      <article id="post" role="article" data-box="0 0 800 600">
        <section id="section" data-box="10 10 700 400">
          <h2 id="heading" data-box="20 20 600 40">Heading</h2>
          <div id="wrapper" data-box="20 80 400 200">
            <div id="card" class="a b c d" data-box="20 80 400 200">
              <div id="inner" data-box="40 100 120 60"></div>
              <span id="tiny" data-box="200 100 10 5"></span>
            </div>
          </div>
          <div id="hidden" data-box="0 0 0 0"></div>
          <div id="sibling" data-box="20 290 400 80"></div>
        </section>
      </article>
      <div id="huge" data-box="0 700 1280 3000"><div id="huge-child" data-box="0 700 300 100"></div></div>
    </div>`;
});

describe('bestElement (Firefox heuristic)', () => {
  test('keeps a reasonably sized element', () => {
    document.getElementById('post')?.removeAttribute('role');
    expect(bestElement(query('#inner'), limits, rectOf)?.id).toBe('inner');
  });

  test('skips headings and walks up', () => {
    document.getElementById('post')?.removeAttribute('role');
    expect(bestElement(query('#heading'), limits, rectOf)?.id).toBe('section');
  });

  test('prefers an enclosing role=article that fits', () => {
    expect(bestElement(query('#inner'), limits, rectOf)?.id).toBe('post');
  });

  test('ignores tiny elements', () => {
    document.getElementById('post')?.removeAttribute('role');
    expect(bestElement(query('#tiny'), limits, rectOf)).toBeNull();
  });

  test('rejects elements bigger than the limits', () => {
    expect(bestElement(query('#huge'), limits, rectOf)).toBeNull();
  });
});

describe('pickElement', () => {
  test('exact mode returns the element itself', () => {
    expect(pickElement(query('#inner'), 'exact', limits, rectOf)?.id).toBe('inner');
    expect(pickElement(query('#huge'), 'exact', limits, rectOf)?.id).toBe('huge');
  });

  test('exact mode ignores zero-size elements', () => {
    expect(pickElement(query('#hidden'), 'exact', limits, rectOf)).toBeNull();
  });
});

describe('tree navigation', () => {
  test('visibleParent skips wrappers with the same box', () => {
    expect(visibleParent(query('#card'), rectOf)?.id).toBe('section');
  });

  test('visibleParent stops below <html>', () => {
    document.body.setAttribute('data-box', '0 0 1280 5000');
    expect(visibleParent(query('#page'), rectOf)?.localName).toBe('body');
    expect(visibleParent(document.body, rectOf)).toBeNull();
  });

  test('visibleChild prefers the child under the pointer', () => {
    expect(visibleChild(query('#card'), { x: 205, y: 102 }, rectOf)?.id).toBe('tiny');
    expect(visibleChild(query('#card'), null, rectOf)?.id).toBe('inner');
  });

  test('visibleChild looks through same-box wrappers', () => {
    expect(visibleChild(query('#wrapper'), null, rectOf)?.id).toBe('inner');
  });

  test('visibleSibling skips invisible siblings', () => {
    expect(visibleSibling(query('#wrapper'), 1, rectOf)?.id).toBe('sibling');
    expect(visibleSibling(query('#sibling'), -1, rectOf)?.id).toBe('wrapper');
    expect(visibleSibling(query('#heading'), -1, rectOf)).toBeNull();
  });

  test('composedParent crosses shadow roots', () => {
    const host = query('#inner');
    const root = host.attachShadow({ mode: 'open' });
    const inside = document.createElement('div');
    root.append(inside);
    expect(composedParent(inside)).toBe(host);
  });
});

describe('describeElement', () => {
  test('formats tag, id and up to three classes', () => {
    expect(describeElement(query('#card'))).toBe('div#card.a.b.c...');
    expect(describeElement(query('#heading'))).toBe('h2#heading');
  });
});
