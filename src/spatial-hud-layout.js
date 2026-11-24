import {peekValue, ResolvedBinding} from '@a2ui/web_core';

export function value(binding) {
  return binding instanceof ResolvedBinding ? binding.value : binding;
}

const defaultWidth = 1.48;

function visible(node) {
  return node.state === 'resolved' && value(peekValue(node.props).visible) !== false;
}

/** Lay out the resolved A2UI tree in display and focus order. */
export function layoutHud(root, renderLeaf) {
  if (root?.type !== 'HudPanel' || !visible(root)) return {width: defaultWidth, height: 0};

  function layout(node, x, top, width) {
    if (node.type !== 'HudPanel' && node.type !== 'HudColumn' && node.type !== 'HudRow') {
      return renderLeaf(node, x, top, width);
    }
    const props = peekValue(node.props);
    const children = (props.children ?? []).filter(visible);
    if (!children.length) return 0;
    if (node.type !== 'HudRow') {
      let height = 0;
      const gap = props.gap ?? 0;
      for (const child of children) {
        const childHeight = layout(child, x, top - height - (height ? gap : 0), width);
        if (childHeight) height += childHeight + (height ? gap : 0);
      }
      return height;
    }

    const gap = Math.min(props.gap ?? 0.04, width / children.length / 2);
    const available = width - gap * (children.length - 1);
    const weights = children.map(child => peekValue(child.props).weight ?? 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let left = x - width / 2;
    let height = 0;
    for (const [index, child] of children.entries()) {
      const cell = available * weights[index] / total;
      height = Math.max(height, layout(child, left + cell / 2, top, cell));
      left += cell + gap;
    }
    return height;
  }

  const width = peekValue(root.props).width ?? defaultWidth;
  return {width, height: layout(root, 0, 0, width)};
}
